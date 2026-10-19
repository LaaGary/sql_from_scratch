import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "../src/database.js";
import { openDatabase } from "../src/node.js";
import { SqlError } from "../src/errors.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-tx-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("BEGIN / COMMIT: changes inside the transaction are visible", () => {
  const db = new Database();
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY);");
  db.exec("BEGIN; INSERT INTO t VALUES (1); INSERT INTO t VALUES (2);");
  assert.deepEqual(db.query("SELECT id FROM t ORDER BY id").rows, [[1], [2]]);
  assert.match(db.exec("COMMIT")[0].message, /transaction committed/);
  assert.deepEqual(db.query("SELECT id FROM t ORDER BY id").rows, [[1], [2]]);
});

test("ROLLBACK: every change inside the transaction disappears", () => {
  const db = new Database();
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY);");
  db.exec("BEGIN; INSERT INTO t VALUES (1);");
  assert.match(db.exec("ROLLBACK")[0].message, /transaction rolled back/);
  assert.deepEqual(db.query("SELECT id FROM t").rows, []);
});

test("transaction state errors: duplicate BEGIN, COMMIT/ROLLBACK with no transaction", () => {
  const db = new Database();
  assert.throws(() => db.exec("COMMIT"), (err) => {
    assert.ok(err instanceof SqlError);
    assert.equal(err.code, "TRANSACTION_ERROR");
    return true;
  });
  assert.throws(() => db.exec("ROLLBACK"), /No transaction in progress/);
  db.exec("BEGIN");
  assert.throws(() => db.exec("BEGIN"), /Already in a transaction/);
});

test("a failing statement inside a transaction rolls back only that statement", () => {
  const db = new Database();
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY);");
  db.exec("BEGIN; INSERT INTO t VALUES (1);");
  assert.throws(() => db.exec("INSERT INTO t VALUES (1)"), /PRIMARY KEY/);
  assert.deepEqual(db.query("SELECT id FROM t").rows, [[1]]);
  db.exec("ROLLBACK");
  assert.deepEqual(db.query("SELECT id FROM t").rows, []);
});

test("a transaction crosses the save boundary before close (disk)", () => {
  const filePath = path.join(dir, "tx.db");
  const db = openDatabase(filePath);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);");
  db.exec("BEGIN; INSERT INTO t VALUES (1, 'a'); COMMIT;");
  db.exec("BEGIN; INSERT INTO t VALUES (2, 'b'); ROLLBACK;");
  db.close();

  const reopened = openDatabase(filePath);
  assert.deepEqual(reopened.query("SELECT id, name FROM t").rows, [[1, "a"]]);
  assert.equal(reopened.query("SELECT COUNT(*) FROM t").rows[0][0], 1);
  reopened.close();
});

test("close without COMMIT discards the transaction (disk)", () => {
  const filePath = path.join(dir, "tx-abandon.db");
  const db = openDatabase(filePath);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY);");
  db.exec("INSERT INTO t VALUES (1);");
  db.exec("BEGIN; INSERT INTO t VALUES (2);");
  db.close(); // simulate the user closing the program outright

  const reopened = openDatabase(filePath);
  assert.deepEqual(reopened.query("SELECT id FROM t").rows, [[1]]);
  reopened.close();
});
