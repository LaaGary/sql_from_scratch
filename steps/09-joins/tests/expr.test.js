import test from "node:test";
import assert from "node:assert/strict";
import { parse, parseExpression } from "../src/parser.js";
import { buildTableSchema } from "../src/schema.js";
import { Table } from "../src/table.js";
import { evaluate, columnLabel, containsAggregate } from "../src/engine/expr.js";
import { SqlError } from "../src/errors.js";

const schema = buildTableSchema(parse("CREATE TABLE t (id INTEGER, name TEXT, price REAL)"));
const table = new Table(schema);
const row = [
  { alias: "t", table, values: { id: 1, name: "Alice", price: 9.5 } },
];
const evaluateSql = (sql) => evaluate(parseExpression(sql), row);

test("arithmetic and precedence", () => {
  assert.equal(evaluateSql("1 + 2 * 3"), 7);
  assert.equal(evaluateSql("(1 + 2) * 3"), 9);
  assert.equal(evaluateSql("10 / 4"), 2.5);    // this engine does real division
  assert.equal(evaluateSql("8 / 2"), 4);
  assert.equal(evaluateSql("10 % 3"), 1);
  assert.equal(evaluateSql("'3' + 4"), 7);      // strings are coerced to a number
  assert.equal(evaluateSql("1 / 0"), null);
});

test("comparison and three-valued logic", () => {
  assert.equal(evaluateSql("1 < 2"), true);
  assert.equal(evaluateSql("1 = 1.0"), true);
  assert.equal(evaluateSql("NULL = NULL"), null);
  assert.equal(evaluateSql("NULL AND TRUE"), null);
  assert.equal(evaluateSql("NULL AND FALSE"), false);
  assert.equal(evaluateSql("NULL OR TRUE"), true);
  assert.equal(evaluateSql("NOT NULL"), null);
  assert.equal(evaluateSql("NOT FALSE"), true);
});

test("IS NULL / LIKE / IN / BETWEEN", () => {
  assert.equal(evaluateSql("name IS NOT NULL"), true);
  assert.equal(evaluateSql("NULL IS NULL"), true);
  assert.equal(evaluateSql("NULL IS NOT NULL"), false);
  assert.equal(evaluateSql("name LIKE 'A%'"), true);
  assert.equal(evaluateSql("name NOT LIKE 'B%'"), true);
  assert.equal(evaluateSql("id IN (2, 3)"), false);
  assert.equal(evaluateSql("id IN (1, 2)"), true);
  assert.equal(evaluateSql("NULL IN (1, 2)"), null);
  assert.equal(evaluateSql("price BETWEEN 5 AND 10"), true);
  assert.equal(evaluateSql("price NOT BETWEEN 5 AND 10"), false);
});

test("string concatenation and scalar functions", () => {
  assert.equal(evaluateSql("name || '!'"), "Alice!");
  assert.equal(evaluateSql("UPPER(name)"), "ALICE");
  assert.equal(evaluateSql("LOWER('ABC')"), "abc");
  assert.equal(evaluateSql("LENGTH(name)"), 5);
  assert.equal(evaluateSql("ABS(-3)"), 3);
  assert.equal(evaluateSql("ROUND(3.14159, 2)"), 3.14);
  assert.equal(evaluateSql("COALESCE(NULL, NULL, 7)"), 7);
  assert.equal(evaluateSql("IFNULL(NULL, 'x')"), "x");
  assert.equal(evaluateSql("TYPEOF(price)"), "real");
  assert.equal(evaluateSql("REPLACE(name, 'A', 'a')"), "alice");
  assert.equal(evaluateSql("SUBSTR(name, 1, 3)"), "Ali");
});

test("column resolution: aliases and ambiguous columns", () => {
  assert.equal(evaluateSql("t.id"), 1);
  assert.equal(evaluateSql("id"), 1);
  assert.throws(() => evaluateSql("nosuch"), (err) => {
    assert.ok(err instanceof SqlError);
    assert.equal(err.code, "UNKNOWN_COLUMN");
    return true;
  });
});

test("an aggregate used out of context gives a comprehensible error", () => {
  assert.throws(() => evaluateSql("COUNT(*)"), /requires GROUP BY/);
});

test("columnLabel reconstructs an expression", () => {
  assert.equal(columnLabel(parseExpression("COUNT(*)")), "COUNT(*)");
  assert.equal(columnLabel(parseExpression("price * 2")), "price * 2");
  assert.equal(columnLabel(parseExpression("name LIKE 'A%'")), "name LIKE 'A%'");
  assert.equal(columnLabel(parseExpression("id IS NOT NULL")), "id IS NOT NULL");
});

test("containsAggregate finds aggregates hidden in subtrees", () => {
  assert.equal(containsAggregate(parseExpression("price + COUNT(*)")), true);
  assert.equal(containsAggregate(parseExpression("price + 1")), false);
});
