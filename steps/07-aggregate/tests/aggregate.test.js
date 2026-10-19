import test from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/database.js";

function makeDb() {
  const db = new Database();
  db.exec("CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, author TEXT, price REAL);");
  db.exec(`INSERT INTO books VALUES
    (1, 'JavaScript', 'Alice', 100),
    (2, 'Database',   'Bob',   200),
    (3, 'Operating',  'Alice', NULL),
    (4, 'SQL',        'Alice', 150),
    (5, 'Nothing',    NULL,     50);`);
  return db;
}

test("COUNT(*) and COUNT(column)", () => {
  const db = makeDb();
  assert.equal(db.query("SELECT COUNT(*) FROM books").rows[0][0], 5);
  assert.equal(db.query("SELECT COUNT(price) FROM books").rows[0][0], 4);
  assert.equal(db.query("SELECT COUNT(author) FROM books").rows[0][0], 4);
});

test("COUNT(DISTINCT ...)", () => {
  const db = makeDb();
  assert.equal(db.query("SELECT COUNT(DISTINCT author) FROM books").rows[0][0], 2);
});

test("SUM / AVG / MIN / MAX", () => {
  const db = makeDb();
  assert.equal(db.query("SELECT SUM(price) FROM books").rows[0][0], 500);
  assert.equal(db.query("SELECT AVG(price) FROM books").rows[0][0], 125);
  assert.equal(db.query("SELECT MIN(price) FROM books").rows[0][0], 50);
  assert.equal(db.query("SELECT MAX(price) FROM books").rows[0][0], 200);
  assert.equal(db.query("SELECT MIN(title), MAX(title) FROM books").rows[0][0], "Database");
});

test("with no matching rows: COUNT is 0, the others are NULL", () => {
  const db = makeDb();
  const row = db.query("SELECT COUNT(*), SUM(price), AVG(price), MIN(price) FROM books WHERE id > 99").rows[0];
  assert.deepEqual(row, [0, null, null, null]);
});

test("GROUP BY: grouped aggregates", () => {
  const db = makeDb();
  const result = db.query(`SELECT author, COUNT(*) AS n, SUM(price) AS total
    FROM books GROUP BY author ORDER BY author`);
  assert.deepEqual(result.rows, [
    [null, 1, 50],
    ["Alice", 3, 250],
    ["Bob", 1, 200],
  ]);
  assert.deepEqual(result.columns.map((c) => c.name), ["author", "n", "total"]);
});

test("GROUP BY multiple columns", () => {
  const db = makeDb();
  const result = db.query("SELECT author, price FROM books GROUP BY author, price ORDER BY author, price");
  // Alice has three prices, Bob one, NULL one -> 5 groups
  assert.equal(result.rowCount, 5);
});

test("GROUP BY an expression", () => {
  const db = makeDb();
  const result = db.query("SELECT LENGTH(title) AS len, COUNT(*) AS n FROM books GROUP BY LENGTH(title) ORDER BY len");
  // all five titles differ in length: SQL(3), Nothing(7), Database(8), Operating(9), JavaScript(10)
  assert.deepEqual(result.rows, [[3, 1], [7, 1], [8, 1], [9, 1], [10, 1]]);
});

test("HAVING filters groups", () => {
  const db = makeDb();
  const result = db.query(`SELECT author, COUNT(*) AS n FROM books GROUP BY author HAVING COUNT(*) > 1`);
  assert.deepEqual(result.rows, [["Alice", 3]]);
});

test("ORDER BY an aggregate result (alias or expression both work)", () => {
  const db = makeDb();
  const byAlias = db.query("SELECT author, COUNT(*) AS n FROM books GROUP BY author ORDER BY n DESC, author");
  assert.deepEqual(byAlias.rows, [["Alice", 3], [null, 1], ["Bob", 1]]);
  const byExpression = db.query("SELECT author FROM books GROUP BY author ORDER BY COUNT(*) DESC");
  assert.equal(byExpression.rows[0][0], "Alice");
});

test("GROUP BY with no matching rows returns 0 rows", () => {
  const db = makeDb();
  assert.equal(db.query("SELECT author, COUNT(*) FROM books WHERE id > 99 GROUP BY author").rowCount, 0);
});

test("aggregate without GROUP BY: the whole table is one group", () => {
  const db = makeDb();
  // SQLite allows this form: a non-aggregate column takes the first row of the group
  const result = db.query("SELECT author, COUNT(*) FROM books");
  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0][1], 5);
});

test("SUM reports an error on non-numeric input", () => {
  const db = makeDb();
  assert.throws(() => db.query("SELECT SUM(author) FROM books"), /numeric columns/);
});

test("aggregates cannot appear in WHERE", () => {
  const db = makeDb();
  assert.throws(() => db.query("SELECT * FROM books WHERE COUNT(*) > 1"), /aggregate function/i);
});
