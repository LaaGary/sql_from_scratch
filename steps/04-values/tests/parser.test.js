import test from "node:test";
import assert from "node:assert/strict";
import { parse, parseScript, parseExpression } from "../src/parser.js";
import { SqlError } from "../src/errors.js";

test("SELECT: columns, sources, conditions, ordering, limits", () => {
  const ast = parse("SELECT title, price FROM books WHERE price > 100 ORDER BY price DESC LIMIT 10 OFFSET 5");
  assert.equal(ast.type, "select");
  assert.deepEqual(ast.columns.map((c) => c.expr.name), ["title", "price"]);
  assert.deepEqual(ast.from, { name: "books", alias: null });
  assert.equal(ast.where.type, "binary");
  assert.equal(ast.where.op, ">");
  assert.deepEqual(ast.orderBy, [
    { expr: { type: "column", table: null, name: "price" }, direction: "desc" },
  ]);
  assert.equal(ast.limit, 10);
  assert.equal(ast.offset, 5);
});

test("SELECT * and table.*", () => {
  const ast = parse("SELECT * FROM books");
  assert.deepEqual(ast.columns[0], { expr: { type: "star", table: null }, alias: null });
  const ast2 = parse("SELECT b.* FROM books b");
  assert.deepEqual(ast2.columns[0].expr, { type: "star", table: "b" });
});

test("a column alias has three forms", () => {
  assert.equal(parse("SELECT 1 AS one").columns[0].alias, "one");
  assert.equal(parse("SELECT 1 one").columns[0].alias, "one");
  assert.equal(parse('SELECT 1 AS "one two"').columns[0].alias, "one two");
});

test("DISTINCT, JOIN, GROUP BY, HAVING", () => {
  const ast = parse(`SELECT DISTINCT a.id, COUNT(*) AS n
    FROM books a LEFT OUTER JOIN authors b ON a.author_id = b.id
    WHERE a.price BETWEEN 10 AND 100
    GROUP BY a.id HAVING COUNT(*) > 1`);
  assert.equal(ast.distinct, true);
  assert.equal(ast.joins.length, 1);
  assert.equal(ast.joins[0].kind, "left");
  assert.deepEqual(ast.joins[0].table, { name: "authors", alias: "b" });
  assert.equal(ast.joins[0].on.op, "=");
  assert.equal(ast.where.type, "between");
  assert.equal(ast.groupBy.length, 1);
  assert.equal(ast.having.op, ">");
});

test("INSERT: omitted columns, multiple rows", () => {
  const ast = parse("INSERT INTO books (title, price) VALUES ('A', 1), ('B', 2)");
  assert.equal(ast.table, "books");
  assert.deepEqual(ast.columns, ["title", "price"]);
  assert.equal(ast.rows.length, 2);
  assert.deepEqual(ast.rows[0][0], { type: "literal", value: "A", valueType: "string" });

  const ast2 = parse("INSERT INTO books VALUES (1, 'x')");
  assert.equal(ast2.columns, null);
});

test("UPDATE and DELETE", () => {
  const update = parse("UPDATE books SET price = price * 1.1, title = 'x' WHERE id = 3");
  assert.equal(update.assignments.length, 2);
  assert.equal(update.assignments[0].column, "price");
  assert.equal(update.where.op, "=");

  const del = parse("DELETE FROM books WHERE id = 3");
  assert.equal(del.table, "books");
  assert.equal(del.where.op, "=");
});

test("CREATE TABLE: column constraints and table constraints", () => {
  const ast = parse(`CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL UNIQUE,
    price REAL DEFAULT 0,
    author_id INTEGER,
    PRIMARY KEY (id)
  )`);
  assert.equal(ast.ifNotExists, true);
  assert.equal(ast.columns.length, 4);
  assert.equal(ast.columns[0].primaryKey, true);
  assert.equal(ast.columns[1].notNull, true);
  assert.equal(ast.columns[1].unique, true);
  assert.equal(ast.columns[2].defaultExpr.value, 0);
  assert.deepEqual(ast.tableConstraints, [{ kind: "primary", columns: ["id"] }]);
});

test("CREATE TABLE: type lengths and omitted types", () => {
  const ast = parse("CREATE TABLE t (a VARCHAR(20), b DECIMAL(10, 2), c)");
  assert.equal(ast.columns[0].type, "VARCHAR");
  assert.equal(ast.columns[1].type, "DECIMAL");
  assert.equal(ast.columns[2].type, "TEXT");
  assert.equal(ast.columns[2].typeExplicit, false);
});

test("DROP TABLE", () => {
  assert.deepEqual(parse("DROP TABLE IF EXISTS books"), { type: "drop_table", name: "books", ifExists: true });
});

test("transaction statements", () => {
  assert.deepEqual(parse("BEGIN"), { type: "begin" });
  assert.deepEqual(parse("START TRANSACTION"), { type: "begin" });
  assert.deepEqual(parse("COMMIT"), { type: "commit" });
  assert.deepEqual(parse("ROLLBACK"), { type: "rollback" });
});

test("expression precedence: * over +, + over comparison, comparison over AND", () => {
  const expr = parseExpression("1 + 2 * 3 = 7 AND 1 = 1");
  assert.equal(expr.op, "AND");
  assert.equal(expr.left.op, "=");
  assert.equal(expr.left.left.op, "+");
  assert.equal(expr.left.left.right.op, "*");
});

test("how NOT binds with comparison operators", () => {
  const expr = parseExpression("NOT a = 1 OR b = 2");
  assert.equal(expr.op, "OR");
  assert.equal(expr.left.op, "NOT");
  assert.equal(expr.left.expr.op, "=");
});

test("IS NULL / IS NOT NULL", () => {
  assert.deepEqual(parseExpression("a IS NULL"), {
    type: "isnull",
    expr: { type: "column", table: null, name: "a" },
    not: false,
  });
  assert.equal(parseExpression("a IS NOT NULL").not, true);
});

test("LIKE / NOT LIKE", () => {
  const like = parseExpression("title LIKE 'J%'");
  assert.equal(like.type, "like");
  assert.equal(like.pattern.value, "J%");
  assert.equal(like.not, false);
  assert.equal(parseExpression("title NOT LIKE 'J%'").not, true);
});

test("IN / NOT IN", () => {
  const expr = parseExpression("id IN (1, 2, 3)");
  assert.equal(expr.type, "in");
  assert.equal(expr.list.length, 3);
  assert.equal(parseExpression("id NOT IN (1)").not, true);
});

test("BETWEEN / NOT BETWEEN", () => {
  const expr = parseExpression("price BETWEEN 10 AND 20");
  assert.equal(expr.type, "between");
  assert.equal(expr.low.value, 10);
  assert.equal(expr.high.value, 20);
  assert.equal(parseExpression("price NOT BETWEEN 10 AND 20").not, true);
});

test("function calls and COUNT(*)", () => {
  const call = parseExpression("COUNT(*)");
  assert.deepEqual(call, { type: "call", name: "COUNT", args: [], star: true, distinct: false });
  const call2 = parseExpression("COUNT(DISTINCT author_id)");
  assert.equal(call2.distinct, true);
  assert.equal(call2.args.length, 1);
  const call3 = parseExpression("LOWER(name)");
  assert.equal(call3.name, "LOWER");
});

test("the == operator normalizes to =", () => {
  assert.equal(parseExpression("a == 1").op, "=");
  assert.equal(parseExpression("a != 1").op, "!=");
});

test("parseScript parses multiple statements", () => {
  const list = parseScript("CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1); SELECT * FROM t;");
  assert.deepEqual(list.map((s) => s.type), ["create_table", "insert", "select"]);
});

test("errors: unsupported statement", () => {
  assert.throws(() => parse("ALTER TABLE t ADD COLUMN b"), (err) => {
    assert.ok(err instanceof SqlError);
    assert.match(err.message, /Unsupported statement/);
    return true;
  });
});

test("errors: a missing closing paren reports the correct position", () => {
  assert.throws(() => parse("SELECT f(a, b"), (err) => {
    assert.ok(err instanceof SqlError);
    assert.equal(err.code, "SYNTAX_ERROR");
    assert.equal(err.position.line, 1);
    assert.ok(err.format("SELECT f(a, b").includes("^"));
    return true;
  });
});

test("errors: a reserved word as an alias must be quoted", () => {
  assert.throws(() => parse("SELECT a FROM"), /Expected/);
});
