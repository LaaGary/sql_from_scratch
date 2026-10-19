-- JOIN and aggregate example
-- Usage: node bin/sql.js examples/join.db < examples/join.sql

CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author_id INTEGER,
  price REAL
);

INSERT INTO authors (id, name) VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Carol');
INSERT INTO books (id, title, author_id, price) VALUES
  (1, 'JavaScript', 1, 320),
  (2, 'Database', 1, 680),
  (3, 'Operating Systems', 2, 450);

SELECT a.name, COUNT(*) AS books, SUM(b.price) AS total
FROM books b
JOIN authors a ON a.id = b.author_id
GROUP BY a.name
ORDER BY total DESC;

-- LEFT JOIN: Carol has no books but must still appear
SELECT a.name, b.title
FROM authors a
LEFT JOIN books b ON b.author_id = a.id
ORDER BY a.id, b.id;
