/**
 * Table Schema
 *
 * The parser only reports what CREATE TABLE wrote; this file turns that into
 * the structure used at runtime and rejects obvious mistakes up front:
 *
 *   - duplicate column names (case-insensitive)
 *   - PRIMARY KEY declared twice
 *   - table-level constraint referencing a missing column
 *   - DEFAULT is not a constant (the teaching version only supports constant defaults)
 *
 * The resulting schema is a plain object that can be JSON-serialized and stored in a file (used in chapter 10).
 */
import { SqlError } from "./errors.js";
import { affinityOf, normalizeValue } from "./values.js";

/**
 * Convert a CREATE TABLE AST into a schema.
 * @param {object} ast the create_table node produced by the parser
 */
export function buildTableSchema(ast) {
  const seen = new Set();
  const columns = [];

  for (const def of ast.columns) {
    const key = def.name.toLowerCase();
    if (seen.has(key)) {
      throw new SqlError("Duplicate column name: " + def.name, { code: "SCHEMA_ERROR" });
    }
    seen.add(key);

    const affinity = affinityOf(def.type);
    const column = {
      name: def.name,
      type: def.type,
      affinity,
      notNull: Boolean(def.notNull),
      primaryKey: Boolean(def.primaryKey),
      unique: Boolean(def.unique),
      defaultExpr: def.defaultExpr,
      defaultValue: defaultValueOf(def),
    };
    if (column.primaryKey) column.notNull = true; // PRIMARY KEY implies NOT NULL
    columns.push(column);
  }

  const primaryKey = [];
  const uniques = [];

  for (const column of columns) {
    if (column.primaryKey) primaryKey.push(column.name);
    if (column.unique) uniques.push([column.name]);
  }

  for (const constraint of ast.tableConstraints ?? []) {
    for (const name of constraint.columns) {
      if (!columns.some((column) => column.name.toLowerCase() === name.toLowerCase())) {
        throw new SqlError("Constraint references a missing column: " + name, { code: "SCHEMA_ERROR" });
      }
    }
    if (constraint.kind === "primary") {
      if (primaryKey.length > 0) {
        throw new SqlError("PRIMARY KEY may only be declared once", { code: "SCHEMA_ERROR" });
      }
      for (const name of constraint.columns) {
        const column = columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
        column.notNull = true;
        primaryKey.push(column.name);
      }
    } else {
      uniques.push(constraint.columns.map((name) => canonicalName(columns, name)));
    }
  }

  return {
    name: ast.name,
    columns,
    primaryKey,
    uniques,
  };
}

function defaultValueOf(def) {
  if (!def.defaultExpr) return null;
  return evaluateConstant(def.defaultExpr);
}

/** Evaluate the constant expression after DEFAULT; only literals and signs are accepted. */
export function evaluateConstant(expr) {
  if (expr.type === "literal") {
    return normalizeValue(expr.value);
  }
  if (expr.type === "unary" && (expr.op === "-" || expr.op === "+")) {
    const value = evaluateConstant(expr.expr);
    if (typeof value !== "number") {
      throw new SqlError("DEFAULT only supports numeric constants", { code: "SCHEMA_ERROR" });
    }
    return expr.op === "-" ? -value : value;
  }
  throw new SqlError("DEFAULT currently supports constants only", {
    code: "SCHEMA_ERROR",
    hint: "For example DEFAULT 0 or DEFAULT 'unknown'.",
  });
}

/** Find a column by name (case-insensitive); returns null if not found. */
export function findColumn(schema, name) {
  const key = String(name).toLowerCase();
  return schema.columns.find((column) => column.name.toLowerCase() === key) ?? null;
}

/** Map a user-written name to the canonical name in the schema. */
export function canonicalName(columns, name) {
  const key = String(name).toLowerCase();
  const column = columns.find((c) => c.name.toLowerCase() === key);
  if (!column) {
    throw new SqlError("Column does not exist: " + name, { code: "SCHEMA_ERROR" });
  }
  return column.name;
}

/** Short schema description used by the .schema command. */
export function describeSchema(schema) {
  const lines = ["CREATE TABLE " + schema.name + " ("];
  const parts = schema.columns.map((column) => {
    let part = "  " + column.name + " " + column.type;
    if (column.primaryKey) part += " PRIMARY KEY";
    if (column.notNull && !column.primaryKey) part += " NOT NULL";
    if (column.unique) part += " UNIQUE";
    if (column.defaultExpr) part += " DEFAULT " + formatConstant(column.defaultValue);
    return part;
  });
  const constraints = [];
  if (schema.primaryKey.length > 1) {
    constraints.push("  PRIMARY KEY (" + schema.primaryKey.join(", ") + ")");
  }
  return lines.concat(parts, constraints).join(",\n") + "\n);";
}

function formatConstant(value) {
  if (typeof value === "string") return "'" + value.replace(/'/g, "''") + "'";
  return String(value);
}
