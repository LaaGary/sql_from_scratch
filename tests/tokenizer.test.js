import test from "node:test";
import assert from "node:assert/strict";
import { tokenize, describeTokens } from "../src/tokenizer.js";
import { SqlError } from "../src/errors.js";

const types = (sql) => tokenize(sql).map((t) => t.type);
const values = (sql) => tokenize(sql).filter((t) => t.type !== "eof").map((t) => t.value);

test("an empty string yields only eof", () => {
  const tokens = tokenize("");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].type, "eof");
});

test("a basic SELECT tokenizes into the right tokens", () => {
  assert.deepEqual(values("SELECT name FROM books"), ["SELECT", "name", "FROM", "books"]);
  assert.deepEqual(types("SELECT name FROM books"), ["word", "word", "word", "word", "eof"]);
});

test("keywords are case-insensitive and upper is always uppercase", () => {
  const tokens = tokenize("select SeLeCt from");
  assert.equal(tokens[0].upper, "SELECT");
  assert.equal(tokens[1].upper, "SELECT");
  assert.equal(tokens[2].upper, "FROM");
});

test("numbers: integer, decimal, exponent", () => {
  const tokens = tokenize("1 3.14 .5 2.5e3 1E-2");
  assert.deepEqual(tokens.slice(0, -1).map((t) => t.value), ["1", "3.14", ".5", "2.5e3", "1E-2"]);
  assert.ok(tokens.slice(0, -1).every((t) => t.type === "number"));
});

test("strings support single-quote escapes", () => {
  const tokens = tokenize("'it''s ok'");
  assert.equal(tokens[0].type, "string");
  assert.equal(tokens[0].value, "it's ok");
  assert.equal(tokens[0].text, "'it''s ok'");
});

test("double quotes and backticks can wrap whitespace and keywords", () => {
  const tokens = tokenize('"my column" `from`');
  assert.equal(tokens[0].value, "my column");
  assert.equal(tokens[0].quoted, true);
  assert.equal(tokens[1].value, "from");
  assert.equal(tokens[1].quoted, true);
});

test("line and block comments are ignored", () => {
  assert.deepEqual(values("SELECT 1 -- this is a comment\nFROM t"), ["SELECT", "1", "FROM", "t"]);
  assert.deepEqual(values("SELECT /* multi-line\ncomment */ 2"), ["SELECT", "2"]);
});

test("operators are matched longest first", () => {
  assert.deepEqual(values("a >= b <> c != d || e"), ["a", ">=", "b", "<>", "c", "!=", "d", "||", "e"]);
});

test("punctuation", () => {
  assert.deepEqual(values("f(a, b);"), ["f", "(", "a", ",", "b", ")", ";"]);
});

test("token positions are correct (line, column, offset)", () => {
  const tokens = tokenize("SELECT 1\n  FROM t");
  const from = tokens[2];
  assert.equal(from.value, "FROM");
  assert.equal(from.line, 2);
  assert.equal(from.column, 3);
  assert.equal(from.start, 11);
});

test("an unterminated string throws SqlError with a position", () => {
  assert.throws(() => tokenize("SELECT 'abc"), (err) => {
    assert.ok(err instanceof SqlError);
    assert.equal(err.code, "SYNTAX_ERROR");
    assert.equal(err.position.line, 1);
    assert.equal(err.position.column, 8);
    return true;
  });
});

test("an unterminated block comment throws SqlError", () => {
  assert.throws(() => tokenize("SELECT /* abc"), /unterminated block comment/);
});

test("an unrecognized character throws SqlError", () => {
  assert.throws(() => tokenize("SELECT @x"), /unrecognized character/);
});

test("describeTokens produces a readable summary", () => {
  assert.equal(describeTokens("SELECT 1;"), 'word(SELECT) number(1) punct(;) eof');
});
