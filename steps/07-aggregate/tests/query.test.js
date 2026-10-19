import test from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/database.js";
import { MemoryStore } from "../src/storage/memory.js";
import { SqlError } from "../src/errors.js";

function makeDb() {
  const db = new Database({ store: new MemoryStore() });
  db.exec("CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, price REAL, author TEXT);");
  db.exec("INSERT INTO books VALUES (1, 'JavaScript', 100, 'Alice'), (2, 'Database', 200, 'Bob'), (3, 'OS', NULL, 'Alice');");
  return db;
}

test("SELECT * returns every column and row", () => {
  const result = makeDb().query("SELECT * FROM books");
  assert.equal(result.type, "select");
  assert.deepEqual(result.columns.map((c) => c.name), ["id", "title", "price", "author"]);
  assert.equal(result.columns[0].type, "integer");
  assert.equal(result.rowCount, 3);
  assert.deepEqual(result.rows[0], [1, "JavaScript", 100, "Alice"]);
});

test("projection, aliases, and expressions", () => {
  const result = makeDb().query("SELECT title, price * 2 AS double_price FROM books WHERE id = 1");
  assert.deepEqual(result.columns.map((c) => c.name), ["title", "double_price"]);
  assert.deepEqual(result.rows, [["JavaScript", 200]]);
});

test("WHERE: AND / OR / NULL three-valued logic", () => {
  const db = makeDb();
  assert.deepEqual(db.query("SELECT id FROM books WHERE price > 100").rows, [[2]]);
  assert.deepEqual(db.query("SELECT id FROM books WHERE price > 100 OR id = 1").rows, [[1], [2]]);
  // rows whose price is NULL are not selected by price > 0
  assert.deepEqual(db.query("SELECT id FROM books WHERE price > 0").rows, [[1], [2]]);
  assert.deepEqual(db.query("SELECT id FROM books WHERE price IS NULL").rows, [[3]]);
  assert.deepEqual(db.query("SELECT id FROM books WHERE price IS NOT NULL").rows, [[1], [2]]);
});

test("ORDER BY: multiple columns, direction, position of NULLs", () => {
  const db = makeDb();
  assert.deepEqual(db.query("SELECT id FROM books ORDER BY price ASC").rows, [[3], [1], [2]]);
  assert.deepEqual(db.query("SELECT id FROM books ORDER BY price DESC").rows, [[2], [1], [3]]);
  assert.deepEqual(db.query("SELECT id FROM books ORDER BY author ASC, id DESC").rows, [[3], [1], [2]]);
});

test("ORDER BY can use output column aliases", () => {
  const result = makeDb().query("SELECT id, price * 2 AS double_price FROM books ORDER BY double_price DESC");
  assert.deepEqual(result.rows.map((row) => row[0]), [2, 1, 3]);
});

test("LIMIT and OFFSET", () => {
  const db = makeDb();
  assert.deepEqual(db.query("SELECT id FROM books ORDER BY id LIMIT 2").rows, [[1], [2]]);
  assert.deepEqual(db.query("SELECT id FROM books ORDER BY id LIMIT 2 OFFSET 1").rows, [[2], [3]]);
  assert.deepEqual(db.query("SELECT id FROM books ORDER BY id LIMIT 1, 2").rows, [[2], [3]]);
});

test("DISTINCT", () => {
  const result = makeDb().query("SELECT DISTINCT author FROM books");
  assert.equal(result.rowCount, 2);
  assert.deepEqual(result.rows.map((row) => row[0]).sort(), ["Alice", "Bob"]);
});

test("a query without FROM", () => {
  const result = makeDb().query("SELECT 1 + 1 AS answer, UPPER('sql') AS upper");
  assert.deepEqual(result.rows, [[2, "SQL"]]);
  assert.deepEqual(result.columns.map((c) => c.name), ["answer", "upper"]);
});

test("SELECT * without FROM is an error", () => {
  assert.throws(() => makeDb().query("SELECT *"), (err) => {
    assert.ok(err instanceof SqlError);
    return true;
  });
});

test("an unknown column error suggests the available columns", () => {
  assert.throws(() => makeDb().query("SELECT nope FROM books"), (err) => {
    assert.ok(err instanceof SqlError);
    assert.equal(err.code, "UNKNOWN_COLUMN");
    assert.match(err.hint, /books\./);
    return true;
  });
});

test("table.* expands only the named table's columns", () => {
  const result = makeDb().query("SELECT books.* FROM books WHERE id = 1");
  assert.equal(result.columns.length, 4);
});

test("an empty result set still has column names", () => {
  const result = makeDb().query("SELECT id, title FROM books WHERE id = 999");
  assert.equal(result.rowCount, 0);
  assert.deepEqual(result.columns.map((c) => c.name), ["id", "title"]);
});
