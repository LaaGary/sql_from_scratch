/**
 * Expression Evaluation
 *
 * WHERE conditions, SELECT columns, UPDATE values... are all expressions. This file turns
 * an AST expression into a value.
 *
 * A "row" looks like this during evaluation:
 *
 *   [
 *     { alias: "b", table: schema, values: { id: 1, title: "JS" } },
 *     { alias: "a", table: schema, values: { id: 7, name: "Alice" } }
 *   ]
 *
 * Why not just merge two tables into one object? Because JOIN can produce columns with the same name,
 * and a "source list" is needed to resolve b.id vs. a.id and to report ambiguous column names.
 *
 * This chapter supports: comparison, arithmetic, AND/OR/NOT, LIKE, IN, BETWEEN, IS NULL,
 * string concatenation, and common scalar functions. Aggregate functions (COUNT/SUM...) come in the next chapter.
 */
import { SqlError } from "../errors.js";
import {
  and3, compare, displayValue, isNull, likeMatch, not3, or3,
  toNumber, toText, truthy, typeOf,
} from "../values.js";

/** Aggregate function names; these need a group of rows, not a single row. */
export const AGGREGATE_FUNCTIONS = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);

/** Scalar functions: one value in, one value out. */
const SCALAR_FUNCTIONS = new Map([
  ["UPPER", { min: 1, max: 1, fn: (args) => (isNull(args[0]) ? null : toText(args[0]).toUpperCase()) }],
  ["LOWER", { min: 1, max: 1, fn: (args) => (isNull(args[0]) ? null : toText(args[0]).toLowerCase()) }],
  ["LENGTH", { min: 1, max: 1, fn: (args) => (isNull(args[0]) ? null : toText(args[0]).length) }],
  ["TRIM", { min: 1, max: 1, fn: (args) => (isNull(args[0]) ? null : toText(args[0]).trim()) }],
  ["ABS", { min: 1, max: 1, fn: (args) => (isNull(args[0]) ? null : Math.abs(requireNumber("ABS", args[0]))) }],
  ["ROUND", { min: 1, max: 2, fn: (args) => (isNull(args[0]) ? null : round(requireNumber("ROUND", args[0]), args[1] ?? 0)) }],
  ["COALESCE", { min: 1, max: Infinity, fn: (args) => args.find((value) => !isNull(value)) ?? null }],
  ["IFNULL", { min: 2, max: 2, fn: (args) => (isNull(args[0]) ? args[1] : args[0]) }],
  ["TYPEOF", { min: 1, max: 1, fn: (args) => typeOf(args[0]) }],
  ["REPLACE", {
    min: 3,
    max: 3,
    fn: (args) => {
      if (args.some(isNull)) return null;
      return toText(args[0]).split(toText(args[1])).join(toText(args[2]));
    },
  }],
  ["SUBSTR", {
    min: 2,
    max: 3,
    fn: (args) => {
      if (isNull(args[0])) return null;
      const text = toText(args[0]);
      const start = requireNumber("SUBSTR", args[1]);
      // SQL's SUBSTR is 1-based
      if (args.length === 3) {
        const length = requireNumber("SUBSTR", args[2]);
        return text.slice(start - 1, start - 1 + length);
      }
      return text.slice(start - 1);
    },
  }],
]);

function round(number, digits) {
  const places = digits === null || digits === undefined ? 0 : Number(digits);
  const factor = 10 ** Math.trunc(places);
  return Math.round(number * factor) / factor;
}

function requireNumber(fnName, value) {
  const number = toNumber(value);
  if (number === null) {
    throw new SqlError(fnName + " expects a number, got: " + displayValue(value), { code: "EXECUTION_ERROR" });
  }
  return number;
}

/**
 * Evaluate an expression to a value.
 *
 * @param {object} expr AST expression
 * @param {Array} row source list (see the file header); empty array when there is no FROM
 * @param {{aggregate?: (expr: object) => unknown}} [state] evaluator for aggregate functions
 * @returns {unknown}
 */
export function evaluate(expr, row, state = {}) {
  switch (expr.type) {
    case "literal":
      return normalizeLiteral(expr.value);

    case "column":
      return evaluateColumn(expr, row);

    case "star":
      throw new SqlError("Asterisk * may only appear in a SELECT column list", { code: "EXECUTION_ERROR" });

    case "unary": {
      if (expr.op === "NOT") {
        const value = evaluate(expr.expr, row, state);
        if (isNull(value)) return null;
        return !truthy(value);
      }
      const value = evaluate(expr.expr, row, state);
      if (isNull(value)) return null;
      const number = toNumber(value);
      if (number === null) {
        throw new SqlError("Unary minus expects a number, got: " + displayValue(value), { code: "EXECUTION_ERROR" });
      }
      return expr.op === "-" ? -number : number;
    }

    case "binary":
      return evaluateBinary(expr, row, state);

    case "isnull": {
      const value = evaluate(expr.expr, row, state);
      const result = isNull(value);
      return expr.not ? !result : result;
    }

    case "like": {
      const value = evaluate(expr.expr, row, state);
      const pattern = evaluate(expr.pattern, row, state);
      const matched = likeMatch(value, pattern);
      if (matched === null) return null;
      return expr.not ? !matched : matched;
    }

    case "in": {
      const value = evaluate(expr.expr, row, state);
      if (isNull(value)) return null;
      let sawNull = false;
      for (const item of expr.list) {
        const candidate = evaluate(item, row, state);
        if (isNull(candidate)) {
          sawNull = true;
          continue;
        }
        if (compare("=", value, candidate) === true) {
          return expr.not ? false : true;
        }
      }
      if (sawNull) return null; // unknown
      return expr.not ? true : false;
    }

    case "between": {
      const value = evaluate(expr.expr, row, state);
      const low = evaluate(expr.low, row, state);
      const high = evaluate(expr.high, row, state);
      const result = and3(compare(">=", value, low), compare("<=", value, high));
      if (result === null) return null;
      return expr.not ? !result : result;
    }

    case "call": {
      const name = expr.name.toUpperCase();
      if (AGGREGATE_FUNCTIONS.has(name)) {
        if (!state.aggregate) {
          throw new SqlError(
            "Aggregate function " + name + " requires GROUP BY or must apply to the whole table",
            { code: "EXECUTION_ERROR" }
          );
        }
        return state.aggregate(expr);
      }
      return evaluateCall(expr, row, state);
    }

    default:
      throw new SqlError("Cannot evaluate expression: " + expr.type, { code: "INTERNAL_ERROR" });
  }
}

function normalizeLiteral(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value ?? null;
}

/** Look up a value by column name; report a clear error if it is ambiguous or missing. */
export function evaluateColumn(expr, row) {
  const wanted = String(expr.name).toLowerCase();
  const matches = [];

  for (const source of row) {
    if (expr.table) {
      if (String(source.alias).toLowerCase() !== String(expr.table).toLowerCase()) continue;
    }
    const column = source.table.columns.find((c) => c.name.toLowerCase() === wanted);
    if (!column) continue;
    matches.push({
      source,
      value: source.values ? source.values[column.name] : null,
    });
  }

  if (matches.length === 0) {
    const hint = row.length > 0
      ? "Available columns: " + row.map((source) => source.alias + "." + source.table.columns.map((c) => c.name).join(", ")).join(" | ")
      : "This query has no FROM, so columns cannot be referenced";
    throw new SqlError(
      "Column not found: " + (expr.table ? expr.table + "." : "") + expr.name,
      { code: "UNKNOWN_COLUMN", hint }
    );
  }
  if (matches.length > 1) {
    throw new SqlError(
      "Ambiguous column: " + expr.name + " exists in " + matches.map((m) => m.source.alias).join(", "),
      { code: "AMBIGUOUS_COLUMN", hint: "Add a table alias, e.g. b." + expr.name }
    );
  }
  return matches[0].value;
}

function evaluateBinary(expr, row, state) {
  // AND / OR short-circuit: once the left side is false / true, the right side is not evaluated.
  if (expr.op === "AND" || expr.op === "OR") {
    const left = toBoolean3(evaluate(expr.left, row, state));
    if (expr.op === "AND" && left === false) return false;
    if (expr.op === "OR" && left === true) return true;
    const right = toBoolean3(evaluate(expr.right, row, state));
    return expr.op === "AND" ? and3(left, right) : or3(left, right);
  }

  const left = evaluate(expr.left, row, state);
  const right = evaluate(expr.right, row, state);

  switch (expr.op) {
    case "=":
    case "==":
    case "!=":
    case "<>":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return compare(expr.op, left, right);
    case "||": {
      if (isNull(left) || isNull(right)) return null;
      return toText(left) + toText(right);
    }
    default:
      return arithmetic(expr.op, left, right);
  }
}

/** Convert any value to true / false / null for three-valued logic. */
function toBoolean3(value) {
  if (isNull(value)) return null;
  return truthy(value);
}

/** Arithmetic: NULL propagates; strings are coerced to numbers. */
function arithmetic(op, left, right) {
  if (isNull(left) || isNull(right)) return null;
  const a = toNumber(left);
  const b = toNumber(right);
  if (a === null || b === null) {
    throw new SqlError(
      "Arithmetic requires numbers, got: " + displayValue(left) + " " + op + " " + displayValue(right),
      { code: "EXECUTION_ERROR" }
    );
  }
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      if (b === 0) return null; // division by zero -> NULL (same as SQLite)
      // Division in this engine is always real division: 10 / 4 yields 2.5.
      // (Some databases do integer division and yield 2; we chose the less surprising behavior for beginners.)
      return a / b;
    case "%":
      if (b === 0) return null;
      return a % b;
    default:
      throw new SqlError("Unsupported operator: " + op, { code: "EXECUTION_ERROR" });
  }
}

function evaluateCall(expr, row, state) {
  const name = expr.name.toUpperCase();
  const definition = SCALAR_FUNCTIONS.get(name);
  if (!definition) {
    throw new SqlError("Unsupported function: " + name, {
      code: "EXECUTION_ERROR",
      hint: "Supported functions: " + [...SCALAR_FUNCTIONS.keys()].join(", ") + ", plus aggregate functions " + [...AGGREGATE_FUNCTIONS].join(", "),
    });
  }
  if (expr.star) {
    throw new SqlError(name + " does not accept *", { code: "EXECUTION_ERROR" });
  }
  if (expr.distinct) {
    throw new SqlError("Only aggregate functions support DISTINCT", { code: "EXECUTION_ERROR" });
  }
  if (expr.args.length < definition.min || expr.args.length > definition.max) {
    const expected = definition.min === definition.max ? String(definition.min) : definition.min + "~" + definition.max;
    throw new SqlError(name + " expects " + expected + " arguments, got " + expr.args.length, {
      code: "EXECUTION_ERROR",
    });
  }
  const args = expr.args.map((arg) => evaluate(arg, row, state));
  return definition.fn(args);
}

/**
 * Column names for query results.
 * Use the alias if present; otherwise print the expression back as SQL-like text.
 */
export function columnLabel(expr) {
  switch (expr.type) {
    case "column":
      return expr.name;
    case "literal":
      if (expr.value === null) return "NULL";
      if (typeof expr.value === "string") return "'" + expr.value.replace(/'/g, "''") + "'";
      return String(expr.value);
    case "unary":
      return expr.op === "NOT" ? "NOT " + columnLabel(expr.expr) : expr.op + columnLabel(expr.expr);
    case "binary":
      return columnLabel(expr.left) + " " + expr.op + " " + columnLabel(expr.right);
    case "isnull":
      return columnLabel(expr.expr) + (expr.not ? " IS NOT NULL" : " IS NULL");
    case "like":
      return columnLabel(expr.expr) + (expr.not ? " NOT LIKE " : " LIKE ") + columnLabel(expr.pattern);
    case "in":
      return columnLabel(expr.expr) + (expr.not ? " NOT IN" : " IN") + " (" + expr.list.map(columnLabel).join(", ") + ")";
    case "between":
      return (
        columnLabel(expr.expr) + (expr.not ? " NOT BETWEEN " : " BETWEEN ") +
        columnLabel(expr.low) + " AND " + columnLabel(expr.high)
      );
    case "call":
      return expr.name + "(" + (expr.star ? "*" : expr.args.map(columnLabel).join(", ")) + ")";
    default:
      return "expr";
  }
}

/** Whether this expression (including descendants) contains an aggregate function. */
export function containsAggregate(expr) {
  if (!expr || typeof expr !== "object") return false;
  if (expr.type === "call" && AGGREGATE_FUNCTIONS.has(expr.name.toUpperCase())) return true;
  for (const value of Object.values(expr)) {
    if (Array.isArray(value)) {
      if (value.some((item) => containsAggregate(item))) return true;
    } else if (value && typeof value === "object" && containsAggregate(value)) {
      return true;
    }
  }
  return false;
}
