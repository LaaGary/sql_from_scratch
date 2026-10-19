import test from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/database.js";
import { SqlError } from "../src/errors.js";

const newDb = () => new Database();

test("CREATE TABLE and IF NOT EXISTS", () => {
  const db = newDb();
  const [created] = db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
  assert.equal(created.type, "command");
  assert.match(created.message, /Created table t/);

  const [again] = db.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER)");
  assert.match(again.message, /already exists, skipped/);

  assert.throws(() => db.exec("CREATE TABLE t (id INTEGER)"), /already exists/);
});

test("DROP TABLE and IF EXISTS", () => {
  const db = newDb();
  db.exec("CREATE TABLE t (id INTEGER)");
  assert.match(db.exec("DROP TABLE t")[0].message, /Dropped/);
  assert.match(db.exec("DROP TABLE IF EXISTS t")[0].message, /does not exist, skipped/);
  assert.throws(() => db.exec("DROP TABLE t"), /does not exist/);
});

test("INSERT: named columns, defaults, multiple rows", () => {
  const db = newDb();
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT DEFAULT 'unknown', score INTEGER DEFAULT 0)");
  const [result] = db.exec("INSERT INTO t (id, name) VALUES (1, 'a'), (2, 'b')");
  assert.equal(result.changes, 2);
  assert.equal(result.lastInsertRowid, 2);
  const rows = db.query("SELECT * FROM t ORDER BY id").rows;
  assert.deepEqual(rows, [[1, "a", 0], [2, "b", 0]]);
});

test("INSERT: without a column list every value must be supplied", () => {
  const db = newDb();
  db.exec("CREATE TABLE t (a INTEGER, b INTEGER)");
  assert.throws(() => db.exec("INSERT INTO t VALUES (1)"), /count and value count/);
});

test("INSERT: unknown column", () => {
  const db = newDb();
  db.exec("CREATE TABLE t (a INTEGER)");
  assert.throws(() => db.exec("INSERT INTO t (zzz) VALUES (1)"), /no column/);
});

test("INSERT: a constraint violation aborts and keeps the original data", () => {
  const db = newDb();
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  db.exec("INSERT INTO t VALUES (1)");
  assert.throws(() => db.exec("INSERT INTO t VALUES (1)"), /PRIMARY KEY/);
  assert.equal(db.query("SELECT * FROM t").rowCount, 1);
});

test("run several statements at once", () => {
  const db = newDb();
  const results = db.exec("CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1); SELECT * FROM t;");
  assert.deepEqual(results.map((r) => r.type), ["command", "command", "select"]);
  assert.deepEqual(results[2].rows, [[1]]);
});

test("a failing statement rolls back and leaves no half-applied changes", () => {
  const db = newDb();
  db.exec("CREATE TABLE t (a INTEGER PRIMARY KEY)");
  db.exec("INSERT INTO t VALUES (1)");
  assert.throws(() => db.exec("INSERT INTO t VALUES (2), (1)"), /PRIMARY KEY/);
  assert.deepEqual(db.query("SELECT * FROM t").rows, [[1]]);
  assert.throws(() => db.exec("COMMIT"), /No transaction in progress/);
});

test("JOIN and aggregates are both available", () => {
  const db = newDb();
  db.exec("CREATE TABLE a (id INTEGER)");
  db.exec("INSERT INTO a VALUES (1), (2)");
  const joined = db.query("SELECT COUNT(*) AS n FROM a JOIN a b ON a.id = b.id");
  assert.equal(joined.rows[0][0], 2);
});
