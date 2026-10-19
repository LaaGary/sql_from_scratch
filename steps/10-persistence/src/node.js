/**
 * Node.js-only entry point: filesystem-dependent features live here.
 *
 * The core (src/index.js) deliberately avoids the filesystem, so the same code can be bundled
 * and run in the browser (the playground on the tutorial site uses the core build).
 */
import { Database } from "./database.js";
import { DiskStore } from "./storage/disk.js";

export { Database, DiskStore };
export { MemoryStore } from "./storage/memory.js";

/**
 * Open (or create) a database stored on disk.
 * @param {string} path e.g. demo.db
 */
export function openDatabase(path) {
  return Database.open(new DiskStore(path));
}
