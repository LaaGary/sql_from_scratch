import test from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/database.js";

function makeDb() {
  const db = new Database();
  db.exec("CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, price REAL, stock INTEGER DEFAULT 0);");
  db.exec("INSERT INTO books VALUES (1, 'JS', 100, 5), (2, 'DB', 200, 3), (3, 'OS', 150, 0);");
  return db;
}

test("UPDATE: targeted rows, expressions, old-value semantics", () => {
  const db = makeDb();
  const [result] = db.exec("UPDATE books SET price = price * 2 WHERE id = 1");
  assert.equal(result.changes, 1);
  assert.deepEqual(db.query("SELECT price FROM books WHERE id = 1").rows, [[200]]);

  // every assignment in one UPDATE sees the old value
  const db2 = makeDb();
  db2.exec("UPDATE books SET price = 1, stock = stock + 10 WHERE id = 2");
  assert.deepEqual(db2.query("SELECT price, stock FROM books WHERE id = 2").rows, [[1, 13]]);
});

test("UPDATE without WHERE touches every row", () => {
  const db = makeDb();
  const [result] = db.exec("UPDATE books SET stock = 0");
  assert.equal(result.changes, 3);
  assert.deepEqual(db.query("SELECT DISTINCT stock FROM books").rows, [[0]]);
});

test("UPDATE leaves rows that fail WHERE untouched", () => {
  const db = makeDb();
  const [result] = db.exec("UPDATE books SET stock = 99 WHERE price > 120");
  assert.equal(result.changes, 2); // both 200 and 150 exceed 120
  assert.deepEqual(db.query("SELECT id, stock FROM books ORDER BY id").rows, [[1, 5], [2, 99], [3, 99]]);
});

test("a constraint violation in UPDATE reverts the whole statement", () => {
  const db = makeDb();
  assert.throws(() => db.exec("UPDATE books SET id = 1 WHERE id >= 2"), /PRIMARY KEY/);
  assert.deepEqual(db.query("SELECT id FROM books ORDER BY id").rows, [[1], [2], [3]]);
});

test("UPDATE on a missing column or table", () => {
  const db = makeDb();
  assert.throws(() => db.exec("UPDATE books SET nope = 1"), /no column/);
  assert.throws(() => db.exec("UPDATE nope SET a = 1"), /does not exist/);
});

test("DELETE: conditional and full delete", () => {
  const db = makeDb();
  const [result] = db.exec("DELETE FROM books WHERE price >= 150");
  assert.equal(result.changes, 2);
  assert.deepEqual(db.query("SELECT id FROM books").rows, [[1]]);

  const [all] = db.exec("DELETE FROM books");
  assert.equal(all.changes, 1);
  assert.equal(db.query("SELECT * FROM books").rowCount, 0);
  assert.equal(db.query("SELECT COUNT(*) FROM books").rows[0][0], 0);
});

test("rowids are not reused after DELETE", () => {
  const db = new Database();
  db.exec("CREATE TABLE t (a TEXT)");
  db.exec("INSERT INTO t VALUES ('x')");
  db.exec("DELETE FROM t");
  db.exec("INSERT INTO t VALUES ('y')");
  assert.equal(db.query("SELECT * FROM t").rows.length, 1);
});
