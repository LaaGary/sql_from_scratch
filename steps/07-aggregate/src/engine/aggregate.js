/**
 * Aggregate functions: COUNT / SUM / AVG / MIN / MAX
 *
 * The key difference from ordinary expressions: an aggregate looks at a whole group of rows, not a single row.
 * So the SELECT pipeline groups first, then computes aggregate values per group.
 *
 * A simple cache is used here: the same aggregate expression is computed only once per group,
 * even if it appears in SELECT, HAVING, and ORDER BY at the same time.
 */
import { SqlError } from "../errors.js";
import { evaluate } from "./expr.js";
import { compareValues, displayValue, groupKey, isNull, toNumber } from "../values.js";

/**
 * Compute an aggregate function over the given set of rows.
 * @param {object} call the call node from the AST
 * @param {Array} rows all rows in this group
 */
export function computeAggregate(call, rows) {
  const name = call.name.toUpperCase();

  if (name === "COUNT") {
    if (call.star) return rows.length;
    const values = distinctIfNeeded(call, aggregateValues(call, rows));
    return values.length;
  }

  const values = distinctIfNeeded(call, aggregateValues(call, rows));
  if (values.length === 0) return null; // with no non-NULL values, SUM/AVG/MIN/MAX are all NULL

  switch (name) {
    case "MIN":
      return values.reduce((best, value) => (compareValues(value, best) < 0 ? value : best));
    case "MAX":
      return values.reduce((best, value) => (compareValues(value, best) > 0 ? value : best));
    case "SUM":
    case "AVG": {
      let total = 0;
      for (const value of values) {
        const number = toNumber(value);
        if (number === null) {
          throw new SqlError(name + " only works on numeric columns, got: " + displayValue(value), {
            code: "EXECUTION_ERROR",
            hint: "Use typeof() or a WHERE condition to filter out non-numeric values first.",
          });
        }
        total += number;
      }
      return name === "SUM" ? total : total / values.length;
    }
    default:
      throw new SqlError("Unsupported aggregate function: " + name, { code: "EXECUTION_ERROR" });
  }
}

/** Evaluate the argument for each row and drop NULLs. */
function aggregateValues(call, rows) {
  const arg = call.args[0];
  const values = [];
  for (const row of rows) {
    const value = evaluate(arg, row, {});
    if (!isNull(value)) values.push(value);
  }
  return values;
}

/** Handles forms like COUNT(DISTINCT x) / SUM(DISTINCT x). */
function distinctIfNeeded(call, values) {
  if (!call.distinct) return values;
  const seen = new Map();
  for (const value of values) {
    const key = groupKey([value]);
    if (!seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()];
}

/**
 * Build an "aggregate evaluator" for evaluate() in expr.js.
 * @param {object[]} expressions aggregate expressions to compute for this group
 * @param {Array} rows the rows in the group
 */
export function createAggregateState(expressions, rows) {
  const cache = new Map();
  const get = (expr) => {
    const key = JSON.stringify(expr);
    if (!cache.has(key)) {
      cache.set(key, computeAggregate(expr, rows));
    }
    return cache.get(key);
  };
  for (const expr of expressions) get(expr);
  return { aggregate: get };
}
