/**
 * Tokenizer / Lexer
 *
 * Split a SQL string into tokens. This layer only recognizes tokens;
 * it does not understand grammar, so it is simple and easy to test:
 *
 *   SELECT name FROM books WHERE price > 100;
 *
 *   -> word(SELECT) word(name) word(FROM) word(books) word(WHERE)
 *      word(price) op(>) number(100) punct(;)
 *
 * Design notes:
 *   - each token records its position in the source string (offset/line/column),
 *     so error messages can point at the exact spot.
 *   - keywords get no special token type; they are all words, and the parser checks upper.
 *     This lets keywords be used as column names (when double-quoted) and keeps the implementation simple.
 *   - supports line comments, block comments, single-quoted strings, and double-quoted/backtick identifiers.
 */
import { SqlError } from "./errors.js";

/** Keyword table: the parser uses it to decide whether a word is a reserved word. */
export const KEYWORDS = new Set(
  `SELECT FROM WHERE GROUP BY HAVING ORDER LIMIT OFFSET
   INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE DROP
   IF NOT EXISTS PRIMARY KEY UNIQUE DEFAULT NULL AND OR AS DISTINCT
   JOIN INNER LEFT OUTER ON USING BEGIN COMMIT ROLLBACK TRANSACTION
   TRUE FALSE IS LIKE BETWEEN IN ASC DESC INTEGER INT REAL TEXT BLOB
   NUMERIC BOOLEAN CHAR VARCHAR`.split(/\s+/).filter(Boolean)
);

/** Single-character punctuation. */
const PUNCTUATION = new Set(["(", ")", ",", ";", "."]);

/** Sorted longest-first so '>=' is not split into '>' and '='. */
const OPERATORS = ["||", "<=", ">=", "<>", "!=", "==", "=", "<", ">", "+", "-", "*", "/", "%"];

/** @typedef {"word"|"number"|"string"|"punct"|"op"|"eof"} TokenType */

/**
 * @typedef {object} Token
 * @property {TokenType} type
 * @property {string} value    decoded value (strings are unquoted; words keep the original text)
 * @property {string} text     raw text (used in error messages)
 * @property {string} [upper]  uppercase form of word, for keyword comparison
 * @property {boolean} [quoted] whether the identifier is wrapped in "..." or `...`
 * @property {number} start    starting offset in the source string
 * @property {number} end      end offset (exclusive)
 * @property {number} line     1-based line number
 * @property {number} column   1-based column number
 */

/**
 * Split SQL into an array of tokens; the last token is always eof.
 * @param {string} source
 * @returns {Token[]}
 */
export function tokenize(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let lineStart = 0; // offset where the current line starts, used to compute column

  const columnAt = (offset) => offset - lineStart + 1;

  /** Advance one character and maintain the line number. */
  const advance = (count = 1) => {
    for (let k = 0; k < count; k++) {
      if (source[i] === "\n") {
        line += 1;
        lineStart = i + 1;
      }
      i += 1;
    }
  };

  const makeToken = (type, value, start, extra = {}) => ({
    type,
    value,
    text: source.slice(start, i),
    start,
    end: i,
    line: startLine,
    column: startColumn,
    ...extra,
  });

  /** Scan from the current position to end of line, skipping a -- comment. */
  const skipLineComment = () => {
    while (i < source.length && source[i] !== "\n") advance();
  };

  const skipBlockComment = (start, startLine, startColumn) => {
    advance(2); // consume /*
    while (i < source.length) {
      if (source[i] === "*" && source[i + 1] === "/") {
        advance(2);
        return;
      }
      advance();
    }
    throw new SqlError("unterminated block comment (missing */)", {
      code: "SYNTAX_ERROR",
      position: { offset: start, line: startLine, column: startColumn },
    });
  };

  let startLine = 1;
  let startColumn = 1;

  while (i < source.length) {
    const ch = source[i];

    // --- whitespace ---
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    startLine = line;
    startColumn = columnAt(i);
    const start = i;

    // --- comments ---
    if (ch === "-" && source[i + 1] === "-") {
      skipLineComment();
      continue; // comments are not tokens
    }
    if (ch === "/" && source[i + 1] === "*") {
      skipBlockComment(start, startLine, startColumn);
      continue;
    }

    // --- strings: '...', two consecutive single quotes stand for one single quote ---
    if (ch === "'") {
      advance(); // opening quote
      let value = "";
      let closed = false;
      while (i < source.length) {
        const c = source[i];
        if (c === "'") {
          if (source[i + 1] === "'") {
            value += "'";
            advance(2);
            continue;
          }
          advance(); // closing quote
          closed = true;
          break;
        }
        value += c;
        advance();
      }
      if (!closed) {
        throw new SqlError("unterminated string (missing closing quote)", {
          code: "SYNTAX_ERROR",
          position: { offset: start, line: startLine, column: startColumn },
        });
      }
      tokens.push(makeToken("string", value, start));
      continue;
    }

    // --- identifier / keyword: double-quoted or backticked forms may contain spaces ---
    if (ch === '"' || ch === "`") {
      const quote = ch;
      advance();
      let value = "";
      let closed = false;
      while (i < source.length) {
        const c = source[i];
        if (c === quote) {
          if (source[i + 1] === quote) {
            value += quote;
            advance(2);
            continue;
          }
          advance();
          closed = true;
          break;
        }
        value += c;
        advance();
      }
      if (!closed) {
        throw new SqlError(`unterminated identifier (missing ${quote})`, {
          code: "SYNTAX_ERROR",
          position: { offset: start, line: startLine, column: startColumn },
        });
      }
      tokens.push(makeToken("word", value, start, { upper: value.toUpperCase(), quoted: true }));
      continue;
    }

    // --- numbers: 12, 3.14, .5, 1e3, 2.5E-2 ---
    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
      while (isDigit(source[i])) advance();
      if (source[i] === "." ) {
        advance();
        while (isDigit(source[i])) advance();
      }
      if (source[i] === "e" || source[i] === "E") {
        const save = i;
        advance();
        if (source[i] === "+" || source[i] === "-") advance();
        if (!isDigit(source[i])) {
          i = save; // not an exponent, rewind (e.g. 1e followed by whitespace)
        } else {
          while (isDigit(source[i])) advance();
        }
      }
      tokens.push(makeToken("number", source.slice(start, i), start));
      continue;
    }

    // --- identifier / keyword ---
    if (isIdentStart(ch)) {
      while (isIdentPart(source[i])) advance();
      const value = source.slice(start, i);
      tokens.push(makeToken("word", value, start, { upper: value.toUpperCase() }));
      continue;
    }

    // --- punctuation ---
    if (PUNCTUATION.has(ch)) {
      advance();
      tokens.push(makeToken("punct", ch, start));
      continue;
    }

    // --- operators (try the two-character forms first) ---
    const two = source.slice(i, i + 2);
    if (OPERATORS.includes(two)) {
      advance(2);
      tokens.push(makeToken("op", two, start));
      continue;
    }
    if (OPERATORS.includes(ch)) {
      advance();
      tokens.push(makeToken("op", ch, start));
      continue;
    }

    // --- anything else is unrecognized ---
    throw new SqlError(`unrecognized character '${ch}'`, {
      code: "SYNTAX_ERROR",
      position: { offset: start, line: startLine, column: startColumn },
    });
  }

  tokens.push({
    type: "eof",
    value: "",
    text: "",
    start: i,
    end: i,
    line,
    column: columnAt(i),
  });
  return tokens;
}

function isDigit(ch) {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isIdentStart(ch) {
  return ch !== undefined && (ch === "_" || (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch.charCodeAt(0) > 127);
}

function isIdentPart(ch) {
  return isIdentStart(ch) || isDigit(ch) || ch === "$";
}

/**
 * Turn a chunk of SQL into a human-readable token summary; the REPL's .tokens command uses it.
 * @param {string} sql
 */
export function describeTokens(sql) {
  return tokenize(sql)
    .map((t) => {
      if (t.type === "eof") return "eof";
      const value = t.type === "string" ? JSON.stringify(t.value) : t.text;
      return `${t.type}(${value})`;
    })
    .join(" ");
}
