/**
 * SELECT Execution Pipeline
 *
 * A SELECT goes through these stages in order:
 *
 *   FROM     find the table and wrap each row as a "source list"
 *   JOIN     attach rows from other tables (chapter 9)
 *   WHERE    keep only rows whose condition is TRUE
 *   GROUP BY groups rows and computes aggregates (chapter 7)
 *   HAVING   filter groups
 *   SELECT   compute the output columns
 *   DISTINCT remove duplicate output rows
 *   ORDER BY sort
 *   LIMIT    take the first N rows
 *
 * This chapter completes FROM / WHERE / SELECT / DISTINCT / ORDER BY / LIMIT.
 * Queries without FROM (e.g. SELECT 1 + 1) must work too, so the source list may be empty.
 */
import { SqlError } from "../errors.js";
import { columnLabel, containsAggregate, evaluate } from "./expr.js";
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
  if (ast.groupBy.length > 0 || ast.having || ast.columns.some((item) => containsAggregate(item.expr))) {
    throw new SqlError("GROUP BY / aggregate functions are not implemented yet (arrive in chapter 7)", { code: "NOT_SUPPORTED" });
  }

  const sources = buildSources(db, ast);
  const rows = scan(db, sources);
  const filtered = applyWhere(ast, rows);
  const defs = buildProjection(ast, sources);
  const labels = defs.map((def) => def.label);
  const state = {};

  let projected = filtered.map((row) => ({
    row,
    labels,
    values: projectRow(defs, row, state),
  }));

  if (ast.distinct) {
    projected = dedupe(projected);
  }

  if (ast.orderBy.length > 0) {
    projected = sortRows(projected, ast.orderBy, state);
  }

  projected = applyLimit(projected, ast);

  return {
    type: "select",
    columns: describeColumns(defs, projected),
    rows: projected.map((item) => item.values),
    rowCount: projected.length,
  };
}

/** Build the source list: [{ alias, table }]. */
function buildSources(db, ast) {
  if (!ast.from) return [];
  const alias = ast.from.alias ?? ast.from.name;
  const table = db.getTable(ast.from.name);
  return [{ alias, table }];
}

/** Scan the table, turning each row into a source entry. */
function* scan(db, sources) {
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
  if (!ast.where) return [...rows];
  const result = [];
  for (const row of rows) {
    const value = evaluate(ast.where, row, {});
    // Three-valued logic: keep only TRUE (NULL / UNKNOWN count as not satisfied)
    if (truthy(value)) result.push(row);
  }
  return result;
}

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

function projectRow(defs, row, state) {
  return defs.map((def) => {
    if (def.kind === "source-column") {
      const source = row.find((item) => item.alias === def.alias);
      if (!source || !source.values) return null;
      return source.values[def.columnName] ?? null;
    }
    return evaluate(def.expr, row, state);
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

/**
 * Sorting. ORDER BY accepts source columns or output column aliases:
 *
 *   SELECT price * 2 AS double FROM books ORDER BY double DESC
 */
function sortRows(projected, orderBy, state) {
  const decorated = projected.map((item) => ({
    ...item,
    keys: orderBy.map((order) => orderValue(order.expr, item, state)),
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

function orderValue(expr, item, state) {
  // Check for an output column alias first (SQL allows aliases in ORDER BY).
  if (expr.type === "column" && !expr.table) {
    const index = item.labels.findIndex(
      (label) => label.toLowerCase() === expr.name.toLowerCase()
    );
    if (index >= 0) return item.values[index];
  }
  return evaluate(expr, item.row, state);
}

function applyLimit(projected, ast) {
  const offset = ast.offset ?? 0;
  const limit = ast.limit;
  if (limit === null && offset === 0) return projected;
  const start = offset;
  const end = limit === null ? projected.length : offset + limit;
  return projected.slice(start, end);
}
