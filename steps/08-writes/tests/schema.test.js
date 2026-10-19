import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/parser.js";
import { buildTableSchema, findColumn, describeSchema } from "../src/schema.js";
import { SqlError } from "../src/errors.js";

const schemaOf = (sql) => buildTableSchema(parse(sql));

test("schema: columns, affinity, primary key, and defaults", () => {
  const schema = schemaOf(`CREATE TABLE books (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL UNIQUE,
    price REAL DEFAULT 0,
    in_stock BOOLEAN DEFAULT 1
  )`);
  assert.equal(schema.name, "books");
  assert.deepEqual(schema.primaryKey, ["id"]);
  assert.deepEqual(schema.uniques, [["title"]]);
  assert.equal(schema.columns[0].affinity, "INTEGER");
  assert.equal(schema.columns[1].affinity, "TEXT");
  assert.equal(schema.columns[2].affinity, "REAL");
  assert.equal(schema.columns[2].defaultValue, 0);
  assert.equal(schema.columns[3].defaultValue, 1);
  assert.equal(schema.columns[0].notNull, true); // a primary key implies NOT NULL
});

test("schema: table-level PRIMARY KEY and UNIQUE", () => {
  const schema = schemaOf(`CREATE TABLE order_items (
    order_id INTEGER,
    line_no INTEGER,
    sku TEXT,
    PRIMARY KEY (order_id, line_no),
    UNIQUE (order_id, sku)
  )`);
  assert.deepEqual(schema.primaryKey, ["order_id", "line_no"]);
  assert.deepEqual(schema.uniques, [["order_id", "sku"]]);
  assert.equal(schema.columns[0].notNull, true);
  assert.equal(schema.columns[1].notNull, true);
  assert.equal(schema.columns[2].notNull, false);
});

test("schema: duplicate column names are an error", () => {
  assert.throws(() => schemaOf("CREATE TABLE t (a INTEGER, A TEXT)"), (err) => {
    assert.ok(err instanceof SqlError);
    assert.match(err.message, /Duplicate/);
    return true;
  });
});

test("schema: PRIMARY KEY cannot be declared twice", () => {
  assert.throws(
    () => schemaOf("CREATE TABLE t (a INTEGER PRIMARY KEY, b INTEGER, PRIMARY KEY (a))"),
    /may only be declared once/
  );
});

test("schema: a constraint points at a column that does not exist", () => {
  assert.throws(() => schemaOf("CREATE TABLE t (a INTEGER, PRIMARY KEY (zzz))"), /missing column/);
});

test("schema: DEFAULT accepts constants only", () => {
  assert.throws(() => schemaOf("CREATE TABLE t (a INTEGER DEFAULT 1 + 2)"), /constants only/);
});

test("schema: findColumn is case-insensitive", () => {
  const schema = schemaOf("CREATE TABLE t (Title TEXT)");
  assert.equal(findColumn(schema, "title").name, "Title");
  assert.equal(findColumn(schema, "nope"), null);
});

test("schema: describeSchema rebuilds approximate SQL", () => {
  const sql = describeSchema(schemaOf("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT 'x')"));
  assert.match(sql, /CREATE TABLE t/);
  assert.match(sql, /id INTEGER PRIMARY KEY/);
  assert.match(sql, /name TEXT NOT NULL DEFAULT 'x'/);
});
