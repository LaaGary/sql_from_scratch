import test from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/database.js";
import { SqlError } from "../src/errors.js";

function makeDb() {
  const db = new Database();
  db.exec("CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT);");
  db.exec("CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, author_id INTEGER, price REAL);");
  db.exec("INSERT INTO authors VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Carol');");
  db.exec("INSERT INTO books VALUES (1, 'JS', 1, 100), (2, 'DB', 1, 200), (3, 'OS', 2, 150);");
  return db;
}

test("INNER JOIN: keep only rows present on both sides", () => {
  const db = makeDb();
  const result = db.query(`SELECT books.title, authors.name
    FROM books JOIN authors ON books.author_id = authors.id
    ORDER BY books.id`);
  assert.deepEqual(result.rows, [["JS", "Alice"], ["DB", "Alice"], ["OS", "Bob"]]);
  assert.deepEqual(result.columns.map((c) => c.name), ["title", "name"]);
});

test("LEFT JOIN: keep rows with no right match, filling columns with NULL", () => {
  const db = makeDb();
  const result = db.query(`SELECT authors.name, books.title
    FROM authors LEFT JOIN books ON books.author_id = authors.id
    ORDER BY authors.id, books.id`);
  assert.deepEqual(result.rows, [
    ["Alice", "JS"],
    ["Alice", "DB"],
    ["Bob", "OS"],
    ["Carol", null],
  ]);
});

test("JOIN + WHERE + aggregate + GROUP BY", () => {
  const db = makeDb();
  const result = db.query(`SELECT authors.name, COUNT(*) AS n, SUM(books.price) AS total
    FROM books JOIN authors ON books.author_id = authors.id
    GROUP BY authors.name
    ORDER BY total DESC`);
  assert.deepEqual(result.rows, [["Alice", 2, 300], ["Bob", 1, 150]]);
});

test("multiple JOINs", () => {
  const db = makeDb();
  db.exec("CREATE TABLE reviews (book_id INTEGER, stars INTEGER);");
  db.exec("INSERT INTO reviews VALUES (1, 5), (1, 4), (2, 3);");
  const result = db.query(`SELECT books.title, COUNT(*) AS reviews
    FROM books
    JOIN authors ON books.author_id = authors.id
    JOIN reviews ON reviews.book_id = books.id
    GROUP BY books.title
    ORDER BY reviews DESC, books.title`);
  assert.deepEqual(result.rows, [["JS", 2], ["DB", 1]]);
});

test("identically named columns in a JOIN must be qualified", () => {
  const db = makeDb();
  assert.throws(() => db.query("SELECT id FROM books JOIN authors ON books.author_id = authors.id"), (err) => {
    assert.ok(err instanceof SqlError);
    assert.equal(err.code, "AMBIGUOUS_COLUMN");
    return true;
  });
});

test("duplicate table aliases are an error", () => {
  const db = makeDb();
  assert.throws(() => db.query("SELECT * FROM books JOIN books ON books.id = books.id"), /Duplicate table alias/);
});

test("a JOIN without ON is a cross join", () => {
  const db = makeDb();
  const result = db.query("SELECT COUNT(*) FROM authors JOIN books");
  assert.equal(result.rows[0][0], 9);
});

test("a self join requires an alias", () => {
  const db = makeDb();
  const result = db.query(`SELECT a.title AS first, b.title AS second
    FROM books a JOIN books b ON a.id < b.id`);
  assert.equal(result.rowCount, 3);
});
