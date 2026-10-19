-- Quick-start example: create a table, insert data, query it
-- Usage: node bin/sql.js examples/demo.db < examples/demo.sql

CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  price REAL DEFAULT 0,
  published INTEGER
);

INSERT INTO books (id, title, author, price, published) VALUES
  (1, 'JavaScript: The Good Parts', 'Douglas Crockford', 320, 2008),
  (2, 'Designing Data-Intensive Applications', 'Martin Kleppmann', 680, 2017),
  (3, 'SQL Antipatterns', 'Bill Karwin', 450, 2010),
  (4, 'Refactoring: Improving the Design of Existing Code', 'Martin Fowler', 650, 2018);

SELECT id, title, author, price
FROM books
WHERE price >= 450
ORDER BY price DESC;

SELECT author, COUNT(*) AS n, SUM(price) AS total
FROM books
GROUP BY author
ORDER BY total DESC;
