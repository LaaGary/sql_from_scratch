import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/parser.js";
import { buildTableSchema } from "../src/schema.js";
import { Table } from "../src/table.js";
import { SqlError } from "../src/errors.js";

const tableOf = (sql, data) => new Table(buildTableSchema(parse(sql)), data);

test("insert: rowid starts at 1 and increments", () => {
  const table = tableOf("CREATE TABLE t (name TEXT)");
  assert.equal(table.insert({ name: "a" }).__rowid, 1);
  assert.equal(table.insert({ name: "b" }).__rowid, 2);
  assert.equal(table.size(), 2);
});

test("insert: type affinity is applied", () => {
  const table = tableOf("CREATE TABLE t (n INTEGER, r REAL, s TEXT, b BOOLEAN)");
  const row = table.insert({ n: "42", r: "3.5", s: 42, b: "true" });
  assert.equal(row.n, 42);
  assert.equal(row.r, 3.5);
  assert.equal(row.s, "42");
  assert.equal(row.b, 1);
});

test("insert: DEFAULT and NULL are applied", () => {
  const table = tableOf("CREATE TABLE t (a TEXT DEFAULT 'x', b INTEGER)");
  const row = table.insert({ b: 1 });
  assert.equal(row.a, "x");
  assert.equal(row.b, 1);
  assert.equal(table.insert({}).a, "x");
});

test("insert: an unknown column is an error", () => {
  const table = tableOf("CREATE TABLE t (a INTEGER)");
  assert.throws(() => table.insert({ zzz: 1 }), (err) => {
    assert.ok(err instanceof SqlError);
    assert.match(err.message, /no column/);
    return true;
  });
});

test("NOT NULL constraint", () => {
  const table = tableOf("CREATE TABLE t (a INTEGER NOT NULL)");
  assert.throws(() => table.insert({}), /cannot be NULL/);
});

test("PRIMARY KEY and UNIQUE constraints", () => {
  const table = tableOf("CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT UNIQUE)");
  table.insert({ id: 1, email: "a@x" });
  assert.throws(() => table.insert({ id: 1, email: "b@x" }), /PRIMARY KEY/);
  assert.throws(() => table.insert({ id: 2, email: "a@x" }), /UNIQUE/);
  // UNIQUE permits multiple NULLs
  table.insert({ id: 3, email: null });
  table.insert({ id: 4, email: null });
  assert.equal(table.size(), 3);
});

test("composite UNIQUE: only the whole value tuple counts as a duplicate", () => {
  const table = tableOf("CREATE TABLE t (a INTEGER, b INTEGER, UNIQUE (a, b))");
  table.insert({ a: 1, b: 1 });
  table.insert({ a: 1, b: 2 });
  assert.throws(() => table.insert({ a: 1, b: 1 }), /UNIQUE/);
});

test("update: partial columns, constraints applied, the row itself excluded", () => {
  const table = tableOf("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
  const row = table.insert({ id: 1, name: "a" });
  table.insert({ id: 2, name: "b" });
  const updated = table.update(row.__rowid, { name: "a2" });
  assert.equal(updated.name, "a2");
  assert.equal(updated.id, 1);
  // writing a row's own value back does not violate UNIQUE
  table.update(row.__rowid, { id: 1, name: "a2" });
  assert.throws(() => table.update(row.__rowid, { id: 2 }), /PRIMARY KEY/);
});

test("delete", () => {
  const table = tableOf("CREATE TABLE t (a INTEGER)");
  const row = table.insert({ a: 1 });
  assert.equal(table.delete(row.__rowid), true);
  assert.equal(table.delete(row.__rowid), false);
  assert.equal(table.size(), 0);
});

test("toJSON / rebuild: the data survives the round trip", () => {
  const table = tableOf("CREATE TABLE t (a INTEGER)");
  table.insert({ a: 1 });
  table.insert({ a: 2 });
  const data = JSON.parse(JSON.stringify(table.toJSON()));
  const copy = new Table(data.schema, { rows: data.rows, nextRowid: data.nextRowid });
  assert.deepEqual(copy.all(), table.all());
  assert.equal(copy.insert({ a: 3 }).__rowid, 3);
});
