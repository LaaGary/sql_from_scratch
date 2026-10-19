import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/node.js";
import { Pager } from "../src/storage/disk.js";
import {
  PAGE_SIZE, appendHeapCell, createHeaderPage, createHeapPage, heapCells,
  heapFreeBytes, parseHeaderPage, setPageNext,
} from "../src/storage/page.js";
import { crc32, journalPath, recoverJournal, writeJournal } from "../src/storage/journal.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-from-scratch-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const file = (name) => path.join(dir, name);

test("heap page: writing and reading cells", () => {
  const page = createHeapPage();
  assert.equal(heapCells(page).length, 0);
  assert.ok(appendHeapCell(page, Buffer.from("hello")));
  assert.ok(appendHeapCell(page, Buffer.from("world")));
  assert.deepEqual(heapCells(page).map((cell) => cell.toString()), ["hello", "world"]);
  assert.ok(heapFreeBytes(page) < PAGE_SIZE);
});

test("header page: write then parse", () => {
  const header = createHeaderPage({ pageCount: 7, catalogRoot: 1, catalogLength: 100, freeListRoot: 0 });
  const parsed = parseHeaderPage(header);
  assert.equal(parsed.pageCount, 7);
  assert.equal(parsed.catalogRoot, 1);
  assert.equal(parseHeaderPage(Buffer.alloc(PAGE_SIZE)), null);
});

test("Pager: write pages, flush, and another Pager can read them", () => {
  const filePath = file("pager.db");
  const pager = new Pager(filePath);
  pager.open();
  const page = createHeapPage();
  appendHeapCell(page, Buffer.from("x"));
  pager.writePage(0, page);
  pager.flush();
  pager.close();

  const reader = new Pager(filePath);
  reader.open();
  assert.deepEqual(heapCells(reader.readPage(0)).map((cell) => cell.toString()), ["x"]);
  reader.close();
});

test("DiskStore: tables and data persist across processes", () => {
  const filePath = file("basic.db");
  const db = openDatabase(filePath);
  db.exec("CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT NOT NULL, price REAL DEFAULT 0);");
  db.exec("INSERT INTO books (id, title, price) VALUES (1, 'JS', 100), (2, 'DB', 200);");
  db.close();

  const reopened = openDatabase(filePath);
  assert.deepEqual(reopened.listTables(), ["books"]);
  const result = reopened.query("SELECT id, title, price FROM books ORDER BY id");
  assert.deepEqual(result.rows, [[1, "JS", 100], [2, "DB", 200]]);
  assert.equal(reopened.query("SELECT COUNT(*) FROM books").rows[0][0], 2);
  reopened.close();
});

test("DiskStore: schema constraints and defaults are saved too", () => {
  const filePath = file("schema.db");
  const db = openDatabase(filePath);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT 'x', email TEXT UNIQUE);");
  db.exec("INSERT INTO t (id) VALUES (1)");
  db.close();

  const reopened = openDatabase(filePath);
  assert.deepEqual(reopened.query("SELECT id, name, email FROM t").rows, [[1, "x", null]]);
  assert.throws(() => reopened.exec("INSERT INTO t (id) VALUES (1)"), /PRIMARY KEY/);
  reopened.close();
});

test("DiskStore: repeated saves do not grow the file without bound", () => {
  const filePath = file("growth.db");
  const db = openDatabase(filePath);
  db.exec("CREATE TABLE t (id INTEGER, text TEXT);");
  for (let i = 0; i < 40; i++) {
    db.exec("INSERT INTO t (id, text) VALUES (" + i + ", '" + "x".repeat(50) + "')");
  }
  db.close();
  const size = fs.statSync(filePath).size;
  assert.ok(size < PAGE_SIZE * 40, "file size should be bounded by page reuse; actual: " + size);
});

test("DiskStore: an empty database can be opened", () => {
  const filePath = file("empty.db");
  const db = openDatabase(filePath);
  assert.deepEqual(db.listTables(), []);
  db.close();
  const reopened = openDatabase(filePath);
  assert.deepEqual(reopened.listTables(), []);
  reopened.close();
});

test("journal: a valid journal is replayed", () => {
  const filePath = file("journal.db");
  fs.writeFileSync(filePath, Buffer.alloc(PAGE_SIZE * 2));
  const page = Buffer.alloc(PAGE_SIZE);
  page.write("NEWDATA");
  writeJournal(filePath, new Map([[1, page]]), PAGE_SIZE);
  assert.ok(fs.existsSync(journalPath(filePath)));

  assert.equal(recoverJournal(filePath, PAGE_SIZE), true);
  assert.equal(fs.existsSync(journalPath(filePath)), false);
  assert.equal(fs.readFileSync(filePath).subarray(PAGE_SIZE, PAGE_SIZE + 7).toString(), "NEWDATA");
});

test("journal: a journal without COMMIT is discarded and the database stays as it was", () => {
  const filePath = file("journal-torn.db");
  fs.writeFileSync(filePath, Buffer.alloc(PAGE_SIZE * 2));
  const page = Buffer.alloc(PAGE_SIZE);
  page.write("NEWDATA");
  writeJournal(filePath, new Map([[1, page]]), PAGE_SIZE);

  // simulate "power loss mid-write": truncate part of the journal
  const journal = fs.readFileSync(journalPath(filePath));
  fs.writeFileSync(journalPath(filePath), journal.subarray(0, journal.length - 20));

  assert.equal(recoverJournal(filePath, PAGE_SIZE), false);
  assert.equal(fs.existsSync(journalPath(filePath)), false);
  const pageAfter = fs.readFileSync(filePath).subarray(PAGE_SIZE, PAGE_SIZE + 7);
  assert.deepEqual([...pageAfter], [0, 0, 0, 0, 0, 0, 0]);
});

test("crc32: same content, same value; one changed byte differs", () => {
  const a = Buffer.from("hello");
  const b = Buffer.from("hellp");
  assert.equal(crc32(a), crc32(Buffer.from("hello")));
  assert.notEqual(crc32(a), crc32(b));
});
