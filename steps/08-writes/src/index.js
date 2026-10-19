/**
 * Public API of sql-from-scratch
 *
 *   import { createDatabase } from "sql-from-scratch";
 *   const db = createDatabase();
 *   const result = db.exec("SELECT 1 + 1;")[0];
 *
 * This file exports only the "core": it never touches the filesystem, so it also works in the browser.
 * For a version that actually persists, use src/node.js (added in chapter 10).
 */
import { Database, SNAPSHOT_VERSION } from "./database.js";
import { MemoryStore } from "./storage/memory.js";

export { Database, SNAPSHOT_VERSION, MemoryStore };
export { tokenize, describeTokens, KEYWORDS } from "./tokenizer.js";
export { parse, parseScript, parseExpression, TYPE_NAMES } from "./parser.js";
export { execute } from "./engine/executor.js";
export { evaluate } from "./engine/expr.js";
export { SqlError } from "./errors.js";
export { displayValue } from "./values.js";

/** Project version. */
export const VERSION = "1.0.0";

/**
 * Create an in-memory database (nothing is persisted).
 * @returns {import("./database.js").Database}
 */
export function createDatabase() {
  return Database.open(new MemoryStore());
}
