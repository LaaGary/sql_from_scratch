/**
 * Parser
 *
 * The tokenizer only splits text into tokens; the parser decides whether these tokens form
 * a valid SQL statement and emits an abstract syntax tree (AST) that is easy for code to consume.
 *
 * This uses recursive descent: each grammar rule is a function,
 * and the functions call each other. Expression precedence uses precedence
 * climbing to avoid one function layer per precedence level.
 *
 * For example:
 *   SELECT title FROM books WHERE price > 100 ORDER BY title
 *
 * becomes:
 *   {
 *     type: "select",
 *     columns: [{ expr: { type: "column", name: "title" }, alias: null }],
 *     from: { name: "books", alias: null },
 *     joins: [],
 *     where: { type: "binary", op: ">", left: {...}, right: {...} },
 *     groupBy: [], having: null,
 *     orderBy: [{ expr: {...}, direction: "asc" }],
 *     limit: null, offset: null, distinct: false
 *   }
 *
 * The AST uses only plain objects, with no tokens or classes, so it can be
 * JSON.stringify'd directly, which makes debugging, serialization, and tests easy.
 */
import { tokenize, KEYWORDS } from "./tokenizer.js";
import { syntaxError, SqlError } from "./errors.js";

/** Type names allowed in SQL. */
export const TYPE_NAMES = new Set([
  "INTEGER", "INT", "BIGINT", "REAL", "DOUBLE", "FLOAT",
  "TEXT", "VARCHAR", "CHAR", "STRING",
  "BOOLEAN", "BOOL", "NUMERIC", "DECIMAL", "BLOB",
]);

/** Two-character concatenation operator (||) and comparison operators. */
const COMPARISON_OPS = new Set(["=", "==", "!=", "<>", "<", "<=", ">", ">="]);

/**
 * Parse a single SQL statement; the trailing semicolon is optional.
 * @param {string} sql
 * @returns {object} AST
 */
export function parse(sql) {
  const parser = new Parser(tokenize(sql), sql);
  const statement = parser.parseStatement();
  parser.consumeOptionalSemicolon();
  parser.expectEnd();
  return statement;
}

/**
 * Parse multiple statements (separated by semicolons) and return an array of ASTs.
 * @param {string} sql
 * @returns {object[]}
 */
export function parseScript(sql) {
  const parser = new Parser(tokenize(sql), sql);
  const statements = [];
  while (!parser.atEnd()) {
    statements.push(parser.parseStatement());
    parser.consumeOptionalSemicolon();
  }
  return statements;
}

/**
 * Parse a single expression; handy for tests and debugging.
 * @param {string} sql
 */
export function parseExpression(sql) {
  const parser = new Parser(tokenize(sql), sql);
  const expr = parser.parseExpr();
  parser.expectEnd();
  return expr;
}

class Parser {
  /**
   * @param {import("./tokenizer.js").Token[]} tokens
   * @param {string} source
   */
  constructor(tokens, source) {
    this.tokens = tokens;
    this.source = source;
    this.pos = 0;
  }

  // ---------------------------------------------------------------------
  // Basic helpers
  // ---------------------------------------------------------------------

  peek(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  next() {
    const token = this.peek();
    if (token.type !== "eof") this.pos += 1;
    return token;
  }

  atEnd() {
    return this.peek().type === "eof";
  }

  /** Whether the current token is the given keyword (case-insensitive). */
  isKeyword(word) {
    const token = this.peek();
    return token.type === "word" && !token.quoted && token.upper === word;
  }

  /** Whether the current token is the given operator or punctuation. */
  isSymbol(symbol) {
    const token = this.peek();
    return (token.type === "op" || token.type === "punct") && token.value === symbol;
  }

  matchKeyword(...words) {
    for (const word of words) {
      if (this.isKeyword(word)) {
        this.next();
        return true;
      }
    }
    return false;
  }

  matchSymbol(...symbols) {
    for (const symbol of symbols) {
      if (this.isSymbol(symbol)) {
        this.next();
        return true;
      }
    }
    return false;
  }

  expectKeyword(word, hint = null) {
    if (!this.isKeyword(word)) {
      throw this.error(`Expected ${word}, but saw ${this.describeToken()}`, hint);
    }
    return this.next();
  }

  expectSymbol(symbol, hint = null) {
    if (!this.isSymbol(symbol)) {
      throw this.error(`Expected '${symbol}', but saw ${this.describeToken()}`, hint);
    }
    return this.next();
  }

  describeToken() {
    const token = this.peek();
    if (token.type === "eof") return "end of statement";
    return `'${token.text}'`;
  }

  error(message, hint = null) {
    return syntaxError(message, this.peek(), hint);
  }

  /** Read an identifier (used for column names, table names, and aliases). */
  expectIdentifier(what = "identifier") {
    const token = this.peek();
    const isIdentifier =
      token.type === "word" &&
      (token.quoted || !KEYWORDS.has(token.upper) || TYPE_NAMES.has(token.upper));
    if (!isIdentifier) {
      throw this.error(`Expected ${what}, but saw ${this.describeToken()}`, "If the name is a reserved word, wrap it in double quotes, e.g. \"order\"");
    }
    this.next();
    return token.value;
  }

  consumeOptionalSemicolon() {
    this.matchSymbol(";");
  }

  expectEnd() {
    if (!this.atEnd()) {
      throw this.error(`Statement already ended, but found ${this.describeToken()}`);
    }
  }

  // ---------------------------------------------------------------------
  // Statements
  // ---------------------------------------------------------------------

  parseStatement() {
    const token = this.peek();
    if (token.type === "word" && !token.quoted) {
      switch (token.upper) {
        case "SELECT":
          return this.parseSelect();
        case "INSERT":
          return this.parseInsert();
        case "UPDATE":
          return this.parseUpdate();
        case "DELETE":
          return this.parseDelete();
        case "CREATE":
          return this.parseCreate();
        case "DROP":
          return this.parseDrop();
        case "BEGIN":
        case "COMMIT":
        case "ROLLBACK":
        case "START":
        case "END":
          return this.parseTransaction();
      }
    }
    throw this.error(`Unsupported statement: ${this.describeToken()}`, "Supported: SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, DROP TABLE, BEGIN, COMMIT, ROLLBACK.");
  }

  parseTransaction() {
    const token = this.next();
    switch (token.upper) {
      case "BEGIN":
        this.matchKeyword("TRANSACTION");
        return { type: "begin" };
      case "START":
        this.expectKeyword("TRANSACTION");
        return { type: "begin" };
      case "COMMIT":
        this.matchKeyword("TRANSACTION");
        return { type: "commit" };
      case "ROLLBACK":
        this.matchKeyword("TRANSACTION");
        return { type: "rollback" };
      case "END":
        this.matchKeyword("TRANSACTION");
        return { type: "commit" };
      default:
        throw this.error(`Unsupported transaction command: ${token.text}`);
    }
  }

  // ---------------------------------------------------------------------
  // SELECT
  // ---------------------------------------------------------------------

  parseSelect() {
    this.expectKeyword("SELECT");
    const distinct = this.matchKeyword("DISTINCT");
    this.matchKeyword("ALL");

    const columns = [this.parseSelectItem()];
    while (this.matchSymbol(",")) {
      columns.push(this.parseSelectItem());
    }

    let from = null;
    const joins = [];
    if (this.matchKeyword("FROM")) {
      from = this.parseTableRef();
      while (true) {
        const kind = this.parseJoinKind();
        if (!kind) break;
        const table = this.parseTableRef();
        let on = null;
        if (this.matchKeyword("ON")) {
          on = this.parseExpr();
        } else if (this.isKeyword("USING") || this.isKeyword("NATURAL")) {
          throw this.error("USING / NATURAL JOIN is not supported yet; use ON instead");
        }
        joins.push({ kind, table, on });
      }
    }

    const where = this.matchKeyword("WHERE") ? this.parseExpr() : null;

    let groupBy = [];
    if (this.matchKeyword("GROUP")) {
      this.expectKeyword("BY");
      groupBy = this.parseExprList();
    }

    const having = this.matchKeyword("HAVING") ? this.parseExpr() : null;

    let orderBy = [];
    if (this.matchKeyword("ORDER")) {
      this.expectKeyword("BY");
      orderBy = [];
      do {
        orderBy.push(this.parseOrderItem());
      } while (this.matchSymbol(","));
    }

    let limit = null;
    let offset = null;
    if (this.matchKeyword("LIMIT")) {
      limit = this.parseNonNegativeInteger("LIMIT");
      if (this.matchKeyword("OFFSET")) {
        offset = this.parseNonNegativeInteger("OFFSET");
      }
      // Also supports MySQL's LIMIT offset, count
      if (this.matchSymbol(",")) {
        offset = limit;
        limit = this.parseNonNegativeInteger("LIMIT");
      }
    } else if (this.matchKeyword("OFFSET")) {
      offset = this.parseNonNegativeInteger("OFFSET");
    }

    if (this.peek().type === "word" && !this.peek().quoted && this.peek().upper === "RETURNING") {
      throw this.error("RETURNING is not supported yet");
    }

    return { type: "select", distinct, columns, from, joins, where, groupBy, having, orderBy, limit, offset };
  }

  parseSelectItem() {
    if (this.matchSymbol("*")) {
      return { expr: { type: "star", table: null }, alias: null };
    }
    // Supports table.*
    if (this.peek().type === "word" && this.peek(1).value === "." && this.peek(2).value === "*") {
      const table = this.expectIdentifier("table name");
      this.expectSymbol(".");
      this.expectSymbol("*");
      return { expr: { type: "star", table }, alias: null };
    }
    const expr = this.parseExpr();
    let alias = null;
    if (this.matchKeyword("AS")) {
      alias = this.expectIdentifier("alias");
    } else if (this.canStartAlias()) {
      alias = this.next().value;
    }
    return { expr, alias };
  }

  /** Implicit alias without AS: the next token is an identifier and not a keyword that continues the statement. */
  canStartAlias() {
    const token = this.peek();
    if (token.type !== "word") return false;
    if (token.quoted) return true;
    // Reserved words cannot be aliases; any other word is treated as an implicit alias.
    return !KEYWORDS.has(token.upper);
  }

  parseOrderItem() {
    const expr = this.parseExpr();
    let direction = "asc";
    if (this.matchKeyword("ASC")) direction = "asc";
    else if (this.matchKeyword("DESC")) direction = "desc";
    return { expr, direction };
  }

  parseTableRef() {
    const name = this.expectIdentifier("table name");
    let alias = null;
    if (this.matchKeyword("AS")) {
      alias = this.expectIdentifier("alias");
    } else if (this.peek().type === "word" && (this.peek().quoted || !KEYWORDS.has(this.peek().upper))) {
      alias = this.next().value;
    }
    return { name, alias };
  }

  parseJoinKind() {
    if (this.matchKeyword("JOIN")) return "inner";
    if (this.matchKeyword("INNER")) {
      this.expectKeyword("JOIN");
      return "inner";
    }
    if (this.matchKeyword("LEFT")) {
      this.matchKeyword("OUTER");
      this.expectKeyword("JOIN");
      return "left";
    }
    if (this.matchKeyword("OUTER")) {
      this.expectKeyword("JOIN");
      return "inner";
    }
    return null;
  }

  parseNonNegativeInteger(what) {
    const token = this.peek();
    if (token.type !== "number" || !/^\d+$/.test(token.value)) {
      throw this.error(`${what} requires a non-negative integer`, "e.g. LIMIT 10");
    }
    this.next();
    const value = Number(token.value);
    if (!Number.isSafeInteger(value)) throw this.error(`${what} value is too large`);
    return value;
  }

  parseExprList() {
    const list = [this.parseExpr()];
    while (this.matchSymbol(",")) list.push(this.parseExpr());
    return list;
  }

  // ---------------------------------------------------------------------
  // INSERT / UPDATE / DELETE
  // ---------------------------------------------------------------------

  parseInsert() {
    this.expectKeyword("INSERT");
    this.expectKeyword("INTO");
    const table = this.expectIdentifier("table name");

    let columns = null;
    if (this.matchSymbol("(")) {
      columns = [this.expectIdentifier("column name")];
      while (this.matchSymbol(",")) columns.push(this.expectIdentifier("column name"));
      this.expectSymbol(")");
    }

    if (!this.matchKeyword("VALUES")) {
      throw this.error("INSERT must be followed by VALUES", "INSERT ... SELECT is not supported yet");
    }

    const rows = [];
    do {
      this.expectSymbol("(");
      const row = [this.parseExpr()];
      while (this.matchSymbol(",")) row.push(this.parseExpr());
      this.expectSymbol(")");
      rows.push(row);
    } while (this.matchSymbol(","));

    return { type: "insert", table, columns, rows };
  }

  parseUpdate() {
    this.expectKeyword("UPDATE");
    const table = this.expectIdentifier("table name");
    this.expectKeyword("SET");
    const assignments = [];
    do {
      const column = this.expectIdentifier("column name");
      this.expectSymbol("=");
      assignments.push({ column, value: this.parseExpr() });
    } while (this.matchSymbol(","));
    const where = this.matchKeyword("WHERE") ? this.parseExpr() : null;
    return { type: "update", table, assignments, where };
  }

  parseDelete() {
    this.expectKeyword("DELETE");
    this.expectKeyword("FROM");
    const table = this.expectIdentifier("table name");
    const where = this.matchKeyword("WHERE") ? this.parseExpr() : null;
    return { type: "delete", table, where };
  }

  // ---------------------------------------------------------------------
  // CREATE TABLE / DROP TABLE
  // ---------------------------------------------------------------------

  parseCreate() {
    this.expectKeyword("CREATE");
    if (this.matchKeyword("TABLE")) {
      return this.parseCreateTable();
    }
    if (this.isKeyword("INDEX") || this.isKeyword("UNIQUE")) {
      throw this.error("Indexes are not supported yet; try adding them after chapter 11", "Indexes make a good extension exercise: implement them with a hash table first, then a B-tree.");
    }
    throw this.error("Only TABLE is supported after CREATE");
  }

  parseCreateTable() {
    const ifNotExists = this.matchKeyword("IF") ? (this.expectKeyword("NOT"), this.expectKeyword("EXISTS"), true) : false;
    const name = this.expectIdentifier("table name");
    this.expectSymbol("(");

    const columns = [];
    const tableConstraints = [];

    do {
      if (this.isKeyword("PRIMARY") || this.isKeyword("UNIQUE") || this.isKeyword("CONSTRAINT")) {
        if (this.matchKeyword("CONSTRAINT")) {
          this.expectIdentifier("constraint name");
        }
        if (this.matchKeyword("PRIMARY")) {
          this.expectKeyword("KEY");
          this.expectSymbol("(");
          const cols = [this.expectIdentifier("column name")];
          while (this.matchSymbol(",")) cols.push(this.expectIdentifier("column name"));
          this.expectSymbol(")");
          tableConstraints.push({ kind: "primary", columns: cols });
          continue;
        }
        if (this.matchKeyword("UNIQUE")) {
          this.expectSymbol("(");
          const cols = [this.expectIdentifier("column name")];
          while (this.matchSymbol(",")) cols.push(this.expectIdentifier("column name"));
          this.expectSymbol(")");
          tableConstraints.push({ kind: "unique", columns: cols });
          continue;
        }
      }
      columns.push(this.parseColumnDef());
    } while (this.matchSymbol(","));

    this.expectSymbol(")");
    if (columns.length === 0 && tableConstraints.length === 0) {
      throw this.error("CREATE TABLE requires at least one column");
    }
    return { type: "create_table", name, ifNotExists, columns, tableConstraints };
  }

  parseColumnDef() {
    const name = this.expectIdentifier("column name");

    // The type is optional; it defaults to TEXT when omitted.
    let type = "TEXT";
    let typeExplicit = false;
    if (this.peek().type === "word" && (this.peek().quoted || TYPE_NAMES.has(this.peek().upper))) {
      type = this.next().value.toUpperCase();
      typeExplicit = true;
      // Length arguments such as VARCHAR(100) / DECIMAL(10, 2) are consumed but not used yet.
      if (this.matchSymbol("(")) {
        this.parseNonNegativeInteger("type length");
        if (this.matchSymbol(",")) this.parseNonNegativeInteger("decimal digits");
        this.expectSymbol(")");
      }
    }

    let notNull = false;
    let primaryKey = false;
    let unique = false;
    let defaultExpr = null;

    // Column constraints may appear in any order and any number.
    while (true) {
      if (this.matchKeyword("NOT")) {
        this.expectKeyword("NULL");
        notNull = true;
        continue;
      }
      if (this.matchKeyword("NULL")) {
        notNull = false;
        continue;
      }
      if (this.matchKeyword("PRIMARY")) {
        this.expectKeyword("KEY");
        primaryKey = true;
        this.matchKeyword("AUTOINCREMENT");
        continue;
      }
      if (this.matchKeyword("UNIQUE")) {
        unique = true;
        continue;
      }
      if (this.matchKeyword("DEFAULT")) {
        defaultExpr = this.parseExpr();
        continue;
      }
      break;
    }

    return { name, type, typeExplicit, notNull, primaryKey, unique, defaultExpr };
  }

  parseDrop() {
    this.expectKeyword("DROP");
    this.expectKeyword("TABLE");
    const ifExists = this.matchKeyword("IF") ? (this.expectKeyword("EXISTS"), true) : false;
    const name = this.expectIdentifier("table name");
    return { type: "drop_table", name, ifExists };
  }

  // ---------------------------------------------------------------------
  // Expressions
  // ---------------------------------------------------------------------

  parseExpr(minPrecedence = 0) {
    let left = this.parseUnary();
    while (true) {
      const token = this.peek();
      const precedence = this.peekBinaryPrecedence();
      if (precedence === null || precedence < minPrecedence) break;

      // Keyword-style predicates: IS [NOT] NULL, [NOT] LIKE, [NOT] IN, [NOT] BETWEEN
      if (token.type === "word" && !token.quoted) {
        if (token.upper === "IS") {
          this.next();
          const not = this.matchKeyword("NOT");
          if (!this.matchKeyword("NULL")) {
            throw this.error("Only NULL or NOT NULL is supported after IS");
          }
          left = { type: "isnull", expr: left, not };
          continue;
        }
        if (token.upper === "LIKE" || token.upper === "IN" || token.upper === "BETWEEN") {
          this.next();
          left = this.parseKeywordComparison(left, token.upper, false);
          continue;
        }
        if (token.upper === "NOT") {
          const nextWord = this.peek(1);
          if (nextWord.type === "word" && ["LIKE", "IN", "BETWEEN"].includes(nextWord.upper)) {
            this.next(); // NOT
            const kind = this.next().upper;
            left = this.parseKeywordComparison(left, kind, true);
            continue;
          }
          break;
        }
      }

      // General binary operators: AND, OR, comparison, arithmetic, string concatenation
      this.next();
      const right = this.parseExpr(precedence + 1);
      let op = token.value;
      if (token.type === "word") op = token.upper;
      if (op === "==") op = "=";
      left = { type: "binary", op, left, right };
    }
    return left;
  }

  /** Parse LIKE / IN / BETWEEN; not indicates a preceding NOT. */
  parseKeywordComparison(left, kind, not) {
    // Operands must bind tighter than comparison so a following AND is not swallowed.
    const operandPrecedence = 5;
    if (kind === "LIKE") {
      const pattern = this.parseExpr(operandPrecedence);
      return { type: "like", expr: left, pattern, not };
    }
    if (kind === "IN") {
      this.expectSymbol("(");
      const list = [this.parseExpr()];
      while (this.matchSymbol(",")) list.push(this.parseExpr());
      this.expectSymbol(")", "Unbalanced parentheses in IN");
      return { type: "in", expr: left, list, not };
    }
    const low = this.parseExpr(operandPrecedence);
    this.expectKeyword("AND", "BETWEEN syntax is expr BETWEEN low AND high");
    const high = this.parseExpr(operandPrecedence);
    return { type: "between", expr: left, low, high, not };
  }

  /** Return the binary operator precedence of the current token; null if it is not an operator. */
  peekBinaryPrecedence() {
    const token = this.peek();
    if (token.type === "word" && !token.quoted) {
      switch (token.upper) {
        case "OR": return 1;
        case "AND": return 2;
        case "IS": return 4;
        case "LIKE": return 4;
        case "IN": return 4;
        case "BETWEEN": return 4;
        case "NOT": {
          const nextWord = this.peek(1);
          return nextWord.type === "word" && ["LIKE", "IN", "BETWEEN"].includes(nextWord.upper) ? 4 : null;
        }
        default: return null;
      }
    }
    if (token.type !== "op") return null;
    if (COMPARISON_OPS.has(token.value)) return 4;
    if (token.value === "||") return 5;
    if (token.value === "+" || token.value === "-") return 6;
    if (token.value === "*" || token.value === "/" || token.value === "%") return 7;
    return null;
  }

  parseUnary() {
    if (this.isKeyword("NOT")) {
      this.next();
      // NOT binds looser than comparison: NOT a = 1 parses as NOT (a = 1).
      return { type: "unary", op: "NOT", expr: this.parseExpr(3) };
    }
    if (this.matchSymbol("-")) {
      return { type: "unary", op: "-", expr: this.parseUnary() };
    }
    if (this.matchSymbol("+")) {
      return { type: "unary", op: "+", expr: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.peek();

    // Parentheses
    if (this.matchSymbol("(")) {
      const expr = this.parseExpr();
      this.expectSymbol(")", "Unbalanced parentheses");
      return expr;
    }

    // Numbers
    if (token.type === "number") {
      this.next();
      return { type: "literal", value: parseNumber(token.value), valueType: "number" };
    }

    // Strings
    if (token.type === "string") {
      this.next();
      return { type: "literal", value: token.value, valueType: "string" };
    }

    if (token.type === "word" && !token.quoted) {
      if (token.upper === "NULL") {
        this.next();
        return { type: "literal", value: null, valueType: "null" };
      }
      if (token.upper === "TRUE" || token.upper === "FALSE") {
        this.next();
        return { type: "literal", value: token.upper === "TRUE", valueType: "boolean" };
      }
      // Function calls, e.g. COUNT(*), LOWER(name)
      if (this.peek(1).type === "punct" && this.peek(1).value === "(") {
        return this.parseCall();
      }
    }

    // Column reference: name or table.name
    if (token.type === "word") {
      const first = this.expectIdentifier("column name");
      if (this.matchSymbol(".")) {
        if (this.isSymbol("*")) {
          this.next();
          return { type: "star", table: first };
        }
        const column = this.expectIdentifier("column name");
        return { type: "column", table: first, name: column };
      }
      return { type: "column", table: null, name: first };
    }

    throw this.error(`Expected an expression, but saw ${this.describeToken()}`);
  }

  parseCall() {
    const name = this.expectIdentifier("function name").toUpperCase();
    this.expectSymbol("(");

    let star = false;
    let distinct = false;
    const args = [];

    if (this.matchSymbol("*")) {
      star = true;
      this.expectSymbol(")", "Unbalanced parentheses in COUNT");
    } else if (!this.matchSymbol(")")) {
      distinct = this.matchKeyword("DISTINCT");
      args.push(this.parseExpr());
      while (this.matchSymbol(",")) args.push(this.parseExpr());
      this.expectSymbol(")");
    }

    if (star && name !== "COUNT") {
      throw this.error("Only COUNT may use COUNT(*)");
    }

    const node = { type: "call", name, args, star, distinct };
    if (this.isSymbol("(")) {
      throw this.error("Unexpected extra parentheses after the function");
    }
    return node;
  }
}

function parseNumber(text) {
  if (/^\d+$/.test(text) && Number.isSafeInteger(Number(text))) return Number(text);
  return Number(text);
}
