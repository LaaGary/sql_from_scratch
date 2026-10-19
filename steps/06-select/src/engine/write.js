/**
 * Execution of write statements: CREATE TABLE, DROP TABLE, INSERT
 *
 * Actual data changes are handled by Table (src/table.js); this file only:
 *   1. finds the target table from the AST
 *   2. evaluates AST expressions to values
 *   3. builds the object Table.insert() expects
 *   4. returns a uniform execution result
 *
 * UPDATE / DELETE arrive in chapter 8.
 */
import { SqlError } from "../errors.js";
import { buildTableSchema, findColumn } from "../schema.js";
import { evaluate } from "./expr.js";

/** Create a uniform "command result" object. */
export function commandResult(message, { changes = 0, lastInsertRowid = null } = {}) {
  return { type: "command", message, changes, lastInsertRowid };
}

export function executeCreateTable(db, ast) {
  if (db.hasTable(ast.name)) {
    if (ast.ifNotExists) {
      return commandResult("Table " + ast.name + " already exists, skipped");
    }
    throw new SqlError("Table already exists: " + ast.name, {
      code: "SCHEMA_ERROR",
      hint: "Use CREATE TABLE IF NOT EXISTS if you do not want an error.",
    });
  }
  const schema = buildTableSchema(ast);
  db.createTable(schema);
  return commandResult(
    "Created table " + schema.name + " (" + schema.columns.length + " columns)"
  );
}

export function executeDropTable(db, ast) {
  if (!db.hasTable(ast.name)) {
    if (ast.ifExists) return commandResult("Table " + ast.name + " does not exist, skipped");
    throw new SqlError("Table does not exist: " + ast.name, {
      code: "SCHEMA_ERROR",
      hint: db.listTables().length > 0 ? "Existing tables: " + db.listTables().join(", ") : null,
    });
  }
  db.dropTable(ast.name);
  return commandResult("Dropped table " + ast.name);
}

export function executeInsert(db, ast) {
  const table = db.getTable(ast.table);

  // Decide which columns to write: use an explicit column list if given, otherwise all columns (in schema order).
  const columns = ast.columns
    ? ast.columns.map((name) => {
        const column = findColumn(table.schema, name);
        if (!column) {
          throw new SqlError("Table " + table.name + " has no column " + name, {
            code: "SCHEMA_ERROR",
            hint: "Available columns: " + table.columns.map((column) => column.name).join(", "),
          });
        }
        return column.name;
      })
    : table.columns.map((column) => column.name);

  const seen = new Set();
  for (const name of columns) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new SqlError("Duplicate column in INSERT column list: " + name, { code: "SYNTAX_ERROR" });
    }
    seen.add(key);
  }

  let changes = 0;
  let lastInsertRowid = null;

  for (const valueExprs of ast.rows) {
    if (valueExprs.length !== columns.length) {
      throw new SqlError(
        "Column count and value count differ: " + columns.length + " columns, " + valueExprs.length + " values",
        { code: "SYNTAX_ERROR" }
      );
    }
    const values = {};
    for (let i = 0; i < columns.length; i++) {
      // INSERT values cannot reference columns, so the source list is empty.
      values[columns[i]] = evaluate(valueExprs[i], [], {});
    }
    const row = table.insert(values);
    changes += 1;
    lastInsertRowid = row.__rowid;
  }

  return commandResult("Inserted " + changes + " rows into " + table.name, {
    changes,
    lastInsertRowid,
  });
}
