/**
 * Database: the facade of the whole engine
 *
 * It keeps track of "which tables exist" and is responsible for:
 *   - creating / dropping tables
 *   - loading from the storage backend and writing snapshots back to it
 *   - later (chapter 6) providing exec() to run SQL
 *
 * All database state lives in memory: it is read from store.load() on open, and after writes
 * store.save() is called to persist it. This is a teaching simplification, but the interface matches a real database
 * exactly: the storage layer is replaceable (MemoryStore / DiskStore).
 */
import { MemoryStore } from "./storage/memory.js";
import { parseScript } from "./parser.js";
import { execute } from "./engine/executor.js";
import { Table } from "./table.js";
import { SqlError } from "./errors.js";

/** Create a simple command result object. */
function command(message) {
  return { type: "command", message, changes: 0, lastInsertRowid: null };
}

/** Version of the current snapshot format; lets us detect format changes later. */
export const SNAPSHOT_VERSION = 1;

export class Database {
  /**
   * @param {{store?: {load:Function, save:Function, close?:Function}}} [options]
   */
  constructor(options = {}) {
    this.store = options.store ?? new MemoryStore();
    /** @type {Map<string, Table>} key is the lowercase table name */
    this.tables = new Map();
    this.closed = false;
    this.inTransaction = false;
    this.transactionBackup = null;
  }

  /**
   * Open a database: create a Database and load existing data from the store.
   * @param {{load:Function, save:Function, close?:Function}} [store]
   */
  static open(store = new MemoryStore()) {
    const db = new Database({ store });
    const snapshot = store.load();
    if (snapshot) db.loadSnapshot(snapshot);
    return db;
  }

  /** Find a table by name (case-insensitive); returns undefined if not found. */
  findTable(name) {
    return this.tables.get(String(name).toLowerCase());
  }

  /** Find a table by name; throws if not found. */
  getTable(name) {
    const table = this.findTable(name);
    if (!table) {
      throw new SqlError("Table does not exist: " + name, {
        code: "SCHEMA_ERROR",
        hint: this.listTables().length > 0 ? "Existing tables: " + this.listTables().join(", ") : "There are no tables yet",
      });
    }
    return table;
  }

  hasTable(name) {
    return this.tables.has(String(name).toLowerCase());
  }

  listTables() {
    return [...this.tables.values()].map((table) => table.name);
  }

  /** Create a table (the schema is produced by schema.js). */
  createTable(schema) {
    if (this.hasTable(schema.name)) {
      throw new SqlError("Table already exists: " + schema.name, { code: "SCHEMA_ERROR" });
    }
    const table = new Table(schema);
    this.tables.set(schema.name.toLowerCase(), table);
    return table;
  }

  /** Drop a table; returns whether anything was actually dropped. */
  dropTable(name) {
    return this.tables.delete(String(name).toLowerCase());
  }

  /** Export a snapshot of the whole database (plain data, JSON-serializable). */
  snapshot() {
    return {
      version: SNAPSHOT_VERSION,
      tables: [...this.tables.values()].map((table) => table.toJSON()),
    };
  }

  /** Restore the whole database from a snapshot. */
  loadSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.tables)) {
      throw new SqlError("Invalid database file format", { code: "STORAGE_ERROR" });
    }
    this.tables.clear();
    for (const data of snapshot.tables) {
      const table = new Table(data.schema, { rows: data.rows, nextRowid: data.nextRowid });
      this.tables.set(table.name.toLowerCase(), table);
    }
  }

  /** Write the current state back to the storage backend. */
  save() {
    this.store.save(this.snapshot());
  }

  /**
   * Execute a SQL string (possibly multiple statements) and return an array of results.
   * @param {string} sql
   * @returns {object[]}
   */
  exec(sql) {
    const statements = parseScript(sql);
    const results = [];

    for (const ast of statements) {
      // Transaction control statements are handled by Database itself, not the executor.
      if (ast.type === "begin") {
        if (this.inTransaction) {
          throw new SqlError("Already in a transaction; cannot BEGIN again", { code: "TRANSACTION_ERROR" });
        }
        this.inTransaction = true;
        this.transactionBackup = this.snapshot();
        results.push(command("transaction started"));
        continue;
      }
      if (ast.type === "commit") {
        if (!this.inTransaction) {
          throw new SqlError("No transaction in progress to COMMIT", { code: "TRANSACTION_ERROR" });
        }
        this.save();
        this.inTransaction = false;
        this.transactionBackup = null;
        results.push(command("transaction committed"));
        continue;
      }
      if (ast.type === "rollback") {
        if (!this.inTransaction) {
          throw new SqlError("No transaction in progress to ROLLBACK", { code: "TRANSACTION_ERROR" });
        }
        this.loadSnapshot(this.transactionBackup);
        this.inTransaction = false;
        this.transactionBackup = null;
        results.push(command("transaction rolled back"));
        continue;
      }

      // Each statement is all-or-nothing: take a snapshot first, restore it on failure.
      const before = this.snapshot();
      try {
        results.push(execute(this, ast));
        // Autocommit: not every store needs it (the in-memory one does not).
        if (!this.inTransaction && this.store.persistent) this.save();
      } catch (error) {
        this.loadSnapshot(before);
        throw error;
      }
    }
    return results;
  }

  /**
   * Execute a single statement and return the first result (handy for tests and small tools).
   * @param {string} sql
   */
  query(sql) {
    return this.exec(sql)[0];
  }

  /** Close the database: save first, then close the store. Uncommitted transactions are discarded. */
  close() {
    if (this.closed) return;
    if (this.inTransaction) {
      // Transactions without COMMIT are discarded (ROLLBACK semantics).
      this.loadSnapshot(this.transactionBackup);
      this.inTransaction = false;
      this.transactionBackup = null;
    }
    this.save();
    this.store.close?.();
    this.closed = true;
  }
}
