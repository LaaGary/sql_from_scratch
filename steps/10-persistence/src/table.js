/**
 * Table: an in-memory table
 *
 * Each row is a plain object keyed by column name, plus a hidden
 * __rowid (starting at 1 and incrementing). Tables without a PRIMARY KEY still have a rowid,
 * giving UPDATE / DELETE a stable way to target a row.
 *
 * This file does three things:
 *   1. apply type affinity on write ('42' -> 42)
 *   2. apply defaults (DEFAULT)
 *   3. check constraints (NOT NULL / UNIQUE / PRIMARY KEY)
 *
 * The query itself (WHERE, ORDER BY...) lives in engine/; Table only provides scans.
 */
import { SqlError } from "./errors.js";
import { applyAffinity, groupKey, isNull, normalizeValue } from "./values.js";

export class Table {
  /**
   * @param {object} schema produced by schema.js
   * @param {{rows?: object[], nextRowid?: number}} [data]
   */
  constructor(schema, data = {}) {
    this.schema = schema;
    this.rows = new Map();
    this.nextRowid = data.nextRowid ?? 1;
    for (const row of data.rows ?? []) {
      const copy = { ...row };
      this.rows.set(copy.__rowid, copy);
      if (copy.__rowid >= this.nextRowid) this.nextRowid = copy.__rowid + 1;
    }
  }

  get name() {
    return this.schema.name;
  }

  get columns() {
    return this.schema.columns;
  }

  /** Return all rows (read-only walk; the executor does not modify these objects). */
  all() {
    return [...this.rows.values()];
  }

  size() {
    return this.rows.size;
  }

  get(rowid) {
    return this.rows.get(rowid) ?? null;
  }

  /**
   * Insert a row.
   * @param {Record<string, unknown>} values column name -> value (may be partial)
   * @returns {object} the row actually written (including __rowid)
   */
  insert(values) {
    const row = this.buildRow(values, null);
    this.checkConstraints(row, null);
    row.__rowid = this.nextRowid;
    this.nextRowid += 1;
    this.rows.set(row.__rowid, row);
    return row;
  }

  /**
   * Update a row. values only needs to contain the columns to change.
   * @param {number} rowid
   * @param {Record<string, unknown>} values
   */
  update(rowid, values) {
    const existing = this.rows.get(rowid);
    if (!existing) {
      throw new SqlError("Row to update not found (rowid = " + rowid + ")", { code: "INTERNAL_ERROR" });
    }
    const candidate = this.buildRow(values, existing);
    this.checkConstraints(candidate, rowid);
    candidate.__rowid = rowid;
    this.rows.set(rowid, candidate);
    return candidate;
  }

  /** Delete a row; returns whether anything was actually deleted. */
  delete(rowid) {
    return this.rows.delete(rowid);
  }

  /**
   * Turn "values supplied by the user" into "the row that is actually stored":
   * - columns not supplied use DEFAULT, otherwise NULL
   * - all values go through type affinity conversion
   */
  buildRow(values, existingRow) {
    const provided = new Map();
    for (const [key, value] of Object.entries(values ?? {})) {
      provided.set(key.toLowerCase(), value);
    }

    const row = {};
    for (const column of this.schema.columns) {
      const key = column.name.toLowerCase();
      let value;
      if (provided.has(key)) {
        value = provided.get(key);
      } else if (existingRow) {
        value = existingRow[column.name];
      } else {
        value = column.defaultValue;
      }
      row[column.name] = applyAffinity(value, column.affinity);
    }

    // Unknown columns must be reported explicitly, not silently ignored.
    for (const key of provided.keys()) {
      if (!this.schema.columns.some((column) => column.name.toLowerCase() === key)) {
        throw new SqlError("Table " + this.schema.name + " has no column " + key, {
          code: "SCHEMA_ERROR",
          hint: "Available columns: " + this.schema.columns.map((c) => c.name).join(", "),
        });
      }
    }

    return row;
  }

  /**
   * Check constraints. ignoreRowid is used by UPDATE to exclude the row itself.
   */
  checkConstraints(row, ignoreRowid) {
    for (const column of this.schema.columns) {
      if (column.notNull && isNull(row[column.name])) {
        throw new SqlError("Column " + column.name + " cannot be NULL (NOT NULL constraint)", {
          code: "CONSTRAINT_ERROR",
        });
      }
    }

    const uniqueSets = [];
    if (this.schema.primaryKey.length > 0) {
      uniqueSets.push({ columns: this.schema.primaryKey, label: "PRIMARY KEY" });
    }
    for (const unique of this.schema.uniques) {
      uniqueSets.push({ columns: unique, label: "UNIQUE" });
    }

    for (const { columns, label } of uniqueSets) {
      const values = columns.map((name) => row[name]);
      // UNIQUE allows multiple NULLs (SQL standard); PRIMARY KEY is already covered by NOT NULL.
      if (values.some((value) => isNull(value))) continue;
      const key = groupKey(values);
      for (const other of this.rows.values()) {
        if (other.__rowid === ignoreRowid) continue;
        const otherValues = columns.map((name) => other[name]);
        if (otherValues.some((value) => isNull(value))) continue;
        if (groupKey(otherValues) === key) {
          throw new SqlError(
            "Violates " + label + " constraint: (" + columns.join(", ") + ") = (" + values.map(formatValue).join(", ") + ") already exists",
            { code: "CONSTRAINT_ERROR" }
          );
        }
      }
    }
  }

  /** Serialize to plain data for storage or transaction snapshots. */
  toJSON() {
    return {
      schema: this.schema,
      nextRowid: this.nextRowid,
      rows: this.all(),
    };
  }
}

function formatValue(value) {
  const normalized = normalizeValue(value);
  if (normalized === null) return "NULL";
  if (typeof normalized === "string") return "'" + normalized + "'";
  return String(normalized);
}
