/**
 * SELECT Execution Pipeline
 *
 * A SELECT goes through these stages in order:
 *
 *   FROM     find the table and wrap each row as a "source list"
 *   JOIN     attach rows from other tables (chapter 9)
 *   WHERE    keep only rows whose condition is TRUE
 *   GROUP BY group rows (with aggregates but no GROUP BY, the whole table is one group)
 *   HAVING   filter groups
 *   SELECT   compute the output columns
 *   DISTINCT remove duplicate output rows
 *   ORDER BY sort
 *   LIMIT    take the first N rows
 *
 * The unit of query execution is a "unit": it holds a representative row and the group's aggregate state.
 * Without grouping, each row is its own unit and the aggregate state is empty.
 */
import { SqlError } from "../errors.js";
import { AGGREGATE_FUNCTIONS, columnLabel, evaluate } from "./expr.js";
import { createAggregateState } from "./aggregate.js";
import { compareValues, groupKey, isNull, truthy, typeOf } from "../values.js";

/**
 * Execute SELECT and return the query result.
 * @param {import("../database.js").Database} db
 * @param {object} ast the select node from the parser
 */
export function executeSelect(db, ast) {
  if (ast.joins.length > 0) {
    throw new SqlError("JOIN is not implemented yet (arrives in chapter 9)", { code: "NOT_SUPPORTED" });
  }

  const sources = buildSources(db, ast);
  const rawRows = [...scan(sources)];
  const filtered = applyWhere(ast, rawRows);

  const aggregateExpressions = collectAggregateExpressions(ast);
  const isGrouped = ast.groupBy.length > 0 || aggregateExpressions.length > 0;

  let units = isGrouped
    ? buildGroups(ast, filtered, aggregateExpressions)
    : filtered.map((row) => ({ row, state: {} }));

  if (ast.having) {
    units = units.filter((unit) => truthy(evaluate(ast.having, unit.row, unit.state)));
  }

  const defs = buildProjection(ast, sources);
  const labels = defs.map((def) => def.label);

  let projected = units.map((unit) => ({
    unit,
    row: unit.row,
    labels,
    values: projectUnit(defs, unit),
  }));

  if (ast.distinct) projected = dedupe(projected);
  if (ast.orderBy.length > 0) projected = sortRows(projected, ast.orderBy);
  projected = applyLimit(projected, ast);

  return {
    type: "select",
    columns: describeColumns(defs, projected),
    rows: projected.map((item) => item.values),
    rowCount: projected.length,
  };
}

// ---------------------------------------------------------------------------
// Sources and scanning
// ---------------------------------------------------------------------------

/** Build the source list: [{ alias, table }]. */
function buildSources(db, ast) {
  if (!ast.from) return [];
  const alias = ast.from.alias ?? ast.from.name;
  return [{ alias, table: db.getTable(ast.from.name) }];
}

/**
 * Scan the table, turning each row into a source entry.
 * A query without FROM (SELECT 1 + 1) produces one row with an empty source list.
 */
function* scan(sources) {
  if (sources.length === 0) {
    yield [];
    return;
  }
  const [source] = sources;
  for (const values of source.table.all()) {
    yield [{ alias: source.alias, table: source.table, values }];
  }
}

function applyWhere(ast, rows) {
  if (!ast.where) return rows;
  const result = [];
  for (const row of rows) {
    // Three-valued logic: keep only TRUE (NULL / UNKNOWN count as not satisfied)
    if (truthy(evaluate(ast.where, row, {}))) result.push(row);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Grouping and aggregation
// ---------------------------------------------------------------------------

/** Collect all aggregate expressions in SELECT / HAVING / ORDER BY (deduplicated). */
function collectAggregateExpressions(ast) {
  const found = new Map();
  const visit = (node) => {
    if (node && typeof node === "object" && node.type === "call" && AGGREGATE_FUNCTIONS.has(node.name.toUpperCase())) {
      found.set(JSON.stringify(node), node);
    }
  };
  walk(ast.columns.map((item) => item.expr), visit);
  walk(ast.having, visit);
  walk(ast.orderBy.map((order) => order.expr), visit);
  return [...found.values()];
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  visit(node);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") walk(value, visit);
  }
}

/**
 * Group rows according to GROUP BY.
 * With aggregates but no GROUP BY (e.g. SELECT COUNT(*) FROM books),
 * the whole table is one group; even with no rows, emit an empty group so COUNT(*) is 0.
 */
function buildGroups(ast, rows, aggregateExpressions) {
  const groups = [];

  if (ast.groupBy.length === 0) {
    groups.push({ row: rows[0] ?? [], rows });
  } else {
    const index = new Map();
    for (const row of rows) {
      const keyValues = ast.groupBy.map((expr) => evaluate(expr, row, {}));
      const key = groupKey(keyValues);
      let group = index.get(key);
      if (!group) {
        group = { row, rows: [] };
        index.set(key, group);
        groups.push(group);
      }
      group.rows.push(row);
    }
  }

  for (const group of groups) {
    group.state = createAggregateState(aggregateExpressions, group.rows);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Output columns
// ---------------------------------------------------------------------------

/**
 * Determine the output columns. SELECT * expands into multiple column definitions;
 * other expressions use their alias or a derived name.
 */
function buildProjection(ast, sources) {
  const defs = [];
  for (const item of ast.columns) {
    if (item.expr.type === "star") {
      const targets = item.expr.table
        ? sources.filter((source) => source.alias.toLowerCase() === item.expr.table.toLowerCase())
        : sources;
      if (targets.length === 0) {
        throw new SqlError("Table not found: " + (item.expr.table ?? "(no FROM)"), {
          code: "SCHEMA_ERROR",
          hint: "SELECT * requires FROM.",
        });
      }
      for (const source of targets) {
        for (const column of source.table.columns) {
          defs.push({
            kind: "source-column",
            alias: source.alias,
            columnName: column.name,
            label: column.name,
          });
        }
      }
      continue;
    }
    defs.push({
      kind: "expression",
      expr: item.expr,
      label: item.alias ?? columnLabel(item.expr),
    });
  }
  if (defs.length === 0) {
    throw new SqlError("SELECT requires at least one column", { code: "SYNTAX_ERROR" });
  }
  return defs;
}

function projectUnit(defs, unit) {
  return defs.map((def) => {
    if (def.kind === "source-column") {
      const source = unit.row.find((item) => item.alias === def.alias);
      if (!source || !source.values) return null;
      return source.values[def.columnName] ?? null;
    }
    return evaluate(def.expr, unit.row, unit.state);
  });
}

/** Output column name and type (the type comes from the first non-NULL value). */
function describeColumns(defs, projected) {
  return defs.map((def, index) => {
    let type = "null";
    for (const item of projected) {
      if (!isNull(item.values[index])) {
        type = typeOf(item.values[index]);
        break;
      }
    }
    return { name: def.label, type };
  });
}

function dedupe(projected) {
  const seen = new Set();
  const result = [];
  for (const item of projected) {
    const key = groupKey(item.values);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sorting and LIMIT
// ---------------------------------------------------------------------------

/**
 * Sorting. ORDER BY accepts source columns, output column aliases, or aggregate functions:
 *
 *   SELECT author, COUNT(*) AS n FROM books GROUP BY author ORDER BY n DESC
 */
function sortRows(projected, orderBy) {
  const decorated = projected.map((item) => ({
    ...item,
    keys: orderBy.map((order) => orderValue(order.expr, item)),
  }));

  decorated.sort((left, right) => {
    for (let i = 0; i < orderBy.length; i++) {
      const direction = orderBy[i].direction === "desc" ? -1 : 1;
      const compared = compareValues(left.keys[i], right.keys[i]);
      if (compared !== 0) return compared * direction;
    }
    return 0;
  });

  return decorated;
}

function orderValue(expr, item) {
  // Check for an output column alias first (SQL allows aliases in ORDER BY).
  if (expr.type === "column" && !expr.table) {
    const index = item.labels.findIndex((label) => label.toLowerCase() === expr.name.toLowerCase());
    if (index >= 0) return item.values[index];
  }
  return evaluate(expr, item.row, item.unit.state);
}

function applyLimit(projected, ast) {
  const offset = ast.offset ?? 0;
  const limit = ast.limit;
  if (limit === null && offset === 0) return projected;
  const end = limit === null ? projected.length : offset + limit;
  return projected.slice(offset, end);
}
