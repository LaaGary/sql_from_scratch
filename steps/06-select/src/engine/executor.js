/**
 * Executor: dispatch AST nodes to the corresponding executors
 *
 * Every statement node the parser produces maps to an execution function here.
 * This file is intentionally thin so it is obvious which statements are supported.
 */
import { SqlError } from "../errors.js";
import { executeSelect } from "./query.js";
import { executeCreateTable, executeDropTable, executeInsert } from "./write.js";

/**
 * Execute one statement and return a result object.
 *
 * Result for SELECT:
 *   { type: "select", columns: [{name, type}], rows: [[...]], rowCount }
 *
 * Results for other statements:
 *   { type: "command", message, changes, lastInsertRowid }
 *
 * @param {import("../database.js").Database} db
 * @param {object} ast
 */
export function execute(db, ast) {
  switch (ast.type) {
    case "select":
      return executeSelect(db, ast);
    case "insert":
      return executeInsert(db, ast);
    case "create_table":
      return executeCreateTable(db, ast);
    case "drop_table":
      return executeDropTable(db, ast);
    case "update":
    case "delete":
      throw new SqlError("UPDATE / DELETE is not implemented yet (arrives in chapter 8)", { code: "NOT_SUPPORTED" });
    case "begin":
    case "commit":
    case "rollback":
      throw new SqlError("Transactions are not implemented yet (added in chapter 10)", { code: "NOT_SUPPORTED" });
    default:
      throw new SqlError("Cannot execute statement: " + ast.type, { code: "INTERNAL_ERROR" });
  }
}
