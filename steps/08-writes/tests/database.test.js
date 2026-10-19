import test from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/database.js";
import { MemoryStore } from "../src/storage/memory.js";
import { parse } from "../src/parser.js";
import { buildTableSchema } from "../src/schema.js";
import { SqlError } from "../src/errors.js";

test("create, list, and drop tables", () => {
  const db = new Database();
  db.createTable(buildTableSchema(parse("CREATE TABLE books (id INTEGER PRIMARY KEY)")));
  db.createTable(buildTableSchema(parse("CREATE TABLE authors (id INTEGER PRIMARY KEY)")));
  assert.deepEqual(db.listTables().sort(), ["authors", "books"]);
  assert.ok(db.hasTable("BOOKS"));
  assert.equal(db.getTable("books").name, "books");
  assert.equal(db.dropTable("books"), true);
  assert.equal(db.hasTable("books"), false);
});

test("creating a table with an existing name is an error", () => {
  const db = new Database();
  db.createTable(buildTableSchema(parse("CREATE TABLE t (a INTEGER)")));
  assert.throws(() => db.createTable(buildTableSchema(parse("CREATE TABLE t (a INTEGER)"))), /already exists/);
});

test("fetching a missing table is an error that lists the existing tables", () => {
  const db = new Database();
  db.createTable(buildTableSchema(parse("CREATE TABLE books (id INTEGER)")));
  assert.throws(() => db.getTable("nope"), (err) => {
    assert.ok(err instanceof SqlError);
    assert.match(err.hint, /books/);
    return true;
  });
});

test("a snapshot can be saved to the store and opened again", () => {
  const store = new MemoryStore();
  const db = new Database({ store });
  db.createTable(buildTableSchema(parse("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")));
  db.getTable("t").insert({ id: 1, name: "a" });
  db.save();

  const reopened = Database.open(store);
  assert.deepEqual(reopened.listTables(), ["t"]);
  const rows = reopened.getTable("t").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "a");
});

test("close saves automatically", () => {
  const store = new MemoryStore();
  const db = new Database({ store });
  db.createTable(buildTableSchema(parse("CREATE TABLE t (id INTEGER)")));
  db.close();
  assert.ok(store.load());
  assert.deepEqual(store.load().tables.map((t) => t.schema.name), ["t"]);
});

test("an empty database can be saved and loaded", () => {
  const store = new MemoryStore();
  const db = new Database({ store });
  db.save();
  const reopened = Database.open(store);
  assert.deepEqual(reopened.listTables(), []);
});
