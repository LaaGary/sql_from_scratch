#!/usr/bin/env node
/**
 * sql-from-scratch command-line interface (CLI)
 *
 * Usage:
 *   node bin/sql.js              open an in-memory database (file support arrives in chapter 10)
 *   node bin/sql.js < demo.sql   read SQL from stdin and run it (good for scripts and tests)
 *
 * Built-in commands start with a dot, e.g. .tables, .schema, .help.
 */
import { createInterface } from "node:readline/promises";
import process from "node:process";
import {
  Database, MemoryStore, SqlError, VERSION,
  execute, parseScript, parse, tokenize, describeTokens, displayValue,
} from "../src/index.js";
import { openDatabase } from "../src/node.js";
import { describeSchema } from "../src/schema.js";

const HELP = [
  "Built-in commands:",
  "  .help             show this help",
  "  .tables           list all tables",
  "  .schema [table]   show the table schema",
  "  .mode [table|json] switch the output format",
  "  .tokens <SQL>     split SQL into tokens (debugging)",
  "  .ast <SQL>        show the syntax tree (debugging)",
  "  .open <file>      open (or create) a database file",
  "  .read <file>      run the SQL in a file",
  "  .version          show the version",
  "  .exit / .quit     quit",
  "",
  "End SQL statements with a semicolon; you can enter several at once.",
].join("\n");

let db = Database.open(new MemoryStore());
let dbPath = null;
let outputMode = "table";
const isInteractive = Boolean(process.stdin.isTTY);

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

function printBanner() {
  console.log("sql-from-scratch v" + VERSION + " — an SQL database built from scratch in JavaScript");
  console.log("Type .help for commands, .exit to quit.");
}

/** Full-width characters such as Chinese, Japanese, and Korean take two terminal cells. */
function displayWidth(text) {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

function pad(text, width) {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

/** Print query results as a simple table. */
function printTable(columns, rows) {
  const header = columns.map((column) => column.name);
  const cells = rows.map((row) => row.map((value) => displayValue(value)));
  const widths = header.map((name, index) =>
    Math.max(displayWidth(name), ...cells.map((row) => displayWidth(row[index] ?? "")))
  );

  const formatRow = (values) => values.map((value, index) => pad(value, widths[index])).join("  ");
  const separator = widths.map((width) => "-".repeat(width)).join("  ");

  console.log(formatRow(header));
  console.log(separator);
  for (const row of cells) console.log(formatRow(row));
  console.log("(" + rows.length + " rows)");
}

function printResult(result) {
  if (result.type === "select") {
    console.log("");
    if (outputMode === "json") {
      const objects = result.rows.map((row) => {
        const object = {};
        result.columns.forEach((column, index) => {
          object[column.name] = row[index];
        });
        return object;
      });
      console.log(JSON.stringify(objects, null, 2));
    } else {
      printTable(result.columns, result.rows);
    }
    console.log("");
    return;
  }
  console.log(result.message);
}

function printError(error, sql) {
  if (error instanceof SqlError) {
    console.error(error.format(sql));
  } else {
    console.error(error);
  }
}

// ---------------------------------------------------------------------------
// run SQL
// ---------------------------------------------------------------------------

/** Detect an "incomplete input" syntax error; the REPL keeps waiting for more input. */
function isIncomplete(error, sql) {
  if (!(error instanceof SqlError) || error.code !== "SYNTAX_ERROR") return false;
  const message = error.message;
  if (message.includes("statement terminator") || message.includes("unterminated")) return true;
  if (error.position && error.position.offset >= sql.trimEnd().length) return true;
  return false;
}

function runStatements(statements, sql) {
  for (const ast of statements) {
    try {
      printResult(execute(db, ast));
    } catch (error) {
      printError(error, sql);
      return false;
    }
  }
  return true;
}

/** Open a database file; any existing database is closed first. */
function openDatabaseFile(filePath) {
  if (!db.closed) db.close();
  db = openDatabase(filePath);
  dbPath = filePath;
  console.log("Opened database: " + filePath + " (" + db.listTables().length + " tables)");
}

/** Close the database; the file-backed version also writes the data back. */
function closeDatabase() {
  if (db.closed) return;
  db.close();
  if (dbPath) console.log("Wrote " + dbPath);
}

function runSql(sql) {
  let statements;
  try {
    statements = parseScript(sql);
  } catch (error) {
    printError(error, sql);
    return false;
  }
  if (statements.length === 0) return true;
  return runStatements(statements, sql);
}

// ---------------------------------------------------------------------------
// built-in commands
// ---------------------------------------------------------------------------

async function runDotCommand(input) {
  const [command, ...rest] = input.split(/\s+/);
  const argument = input.slice(command.length).trim();

  switch (command.toLowerCase()) {
    case ".help":
      console.log(HELP);
      return true;
    case ".exit":
    case ".quit":
      return false;
    case ".open": {
      if (!argument) {
        console.log("Usage: .open <file>");
        return true;
      }
      try {
        openDatabaseFile(argument);
      } catch (error) {
        printError(error, argument);
      }
      return true;
    }
    case ".version":
      console.log("sql-from-scratch " + VERSION);
      return true;
    case ".tables":
      if (db.listTables().length === 0) {
        console.log("(no tables)");
      } else {
        console.log(db.listTables().join("\n"));
      }
      return true;
    case ".schema":
      if (argument) {
        try {
          console.log(describeSchema(db.getTable(argument).schema));
        } catch (error) {
          printError(error, argument);
        }
      } else if (db.listTables().length === 0) {
        console.log("(no tables)");
      } else {
        console.log(db.listTables().map((name) => describeSchema(db.getTable(name).schema)).join("\n\n"));
      }
      return true;
    case ".mode":
      if (argument === "table" || argument === "json") {
        outputMode = argument;
        console.log("Output mode: " + outputMode);
      } else {
        console.log("Current mode: " + outputMode + " (use .mode table or .mode json)");
      }
      return true;
    case ".tokens":
      try {
        console.log(describeTokens(argument));
      } catch (error) {
        printError(error, argument);
      }
      return true;
    case ".ast":
      try {
        console.log(JSON.stringify(parseScript(argument), null, 2));
      } catch (error) {
        printError(error, argument);
      }
      return true;
    case ".read": {
      const { readFileSync } = await import("node:fs");
      try {
        const sql = readFileSync(argument, "utf8");
        runSql(sql);
      } catch (error) {
        console.error("Cannot read file: " + argument);
      }
      return true;
    }
    default:
      console.error("Unknown command: " + command + " (try .help)");
      return true;
  }
}

// ---------------------------------------------------------------------------
// REPL main loop
// ---------------------------------------------------------------------------

/** Non-interactive mode: process stdin line by line and run a statement at its semicolon (good for scripts and CI). */
async function runPipedScript() {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(0, "utf8");
  let buffer = "";
  for (const line of sql.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (buffer === "" && trimmedLine.startsWith(".")) {
      const keepGoing = await runDotCommand(trimmedLine);
      if (!keepGoing) return;
      continue;
    }
    buffer = buffer === "" ? line : buffer + "\n" + line;
    if (buffer.trim() === "") {
      buffer = "";
      continue;
    }
    if (!buffer.trimEnd().endsWith(";")) continue;
    runSql(buffer.trim());
    buffer = "";
  }
  if (buffer.trim() !== "") runSql(buffer.trim());
}

async function main() {
  // command-line argument: node bin/sql.js demo.db
  const target = process.argv[2];
  if (target && !target.startsWith("-")) {
    db = openDatabase(target);
    dbPath = target;
  }

  if (!isInteractive) {
    try {
      await runPipedScript();
    } finally {
      closeDatabase();
    }
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  printBanner();
  if (dbPath) console.log("Opened database: " + dbPath + " (" + db.listTables().length + " tables)");

  let buffer = "";
  rl.on("SIGINT", () => {
    if (buffer) {
      buffer = "";
      console.log("");
      return;
    }
    rl.close();
  });

  try {
    while (true) {
      const prompt = !isInteractive ? "" : buffer ? "   ... " : "sql> ";
      let line;
      try {
        line = await rl.question(prompt);
      } catch {
        break;
      }

      if (!buffer && line.trim().startsWith(".")) {
        const keepGoing = await runDotCommand(line.trim());
        if (!keepGoing) break;
        continue;
      }

      buffer = buffer ? buffer + "\n" + line : line;
      if (buffer.trim() === "") {
        buffer = "";
        continue;
      }

      const sql = buffer.trim();
      let statements;
      try {
        statements = parseScript(sql);
      } catch (error) {
        if (!sql.endsWith(";") && isIncomplete(error, sql)) {
          continue; // statement is incomplete, read the next line
        }
        printError(error, sql);
        buffer = "";
        continue;
      }

      if (statements.length > 0) {
        runStatements(statements, sql);
      }
      buffer = "";
    }
  } finally {
    rl.close();
    closeDatabase();
    if (isInteractive) console.log("Goodbye!");
  }
}

main();
