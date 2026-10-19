/**
 * Values and types
 *
 * SQL values and JavaScript values are not the same thing; the differences are threefold:
 *
 *   1. NULL is not "no value" but a value of its own. Any comparison with NULL yields
 *      UNKNOWN (three-valued logic); only rows whose WHERE result is TRUE are kept.
 *   2. Numbers are integers (INTEGER) or floats (REAL). In SQL, 1 and 1.0 are equal,
 *      but they display and store differently.
 *   3. Types can convert (type affinity): storing '42' into an INTEGER column
 *      converts it to the number 42.
 *
 * This file centralizes those rules so parser / executor / storage share one set of
 * definitions instead of each implementing comparison separately and drifting apart.
 */

/** Type affinities a column can declare. */
export const AFFINITY = {
  INTEGER: "INTEGER",
  REAL: "REAL",
  TEXT: "TEXT",
  BOOLEAN: "BOOLEAN",
  BLOB: "BLOB",
};

/**
 * Map the type name in CREATE TABLE to a type affinity.
 * Rules follow SQLite's affinity concept, simplified to five kinds.
 * @param {string} typeName
 */
export function affinityOf(typeName) {
  const name = String(typeName || "").toUpperCase();
  if (name === "INTEGER" || name === "INT" || name === "BIGINT") return AFFINITY.INTEGER;
  if (["REAL", "DOUBLE", "FLOAT", "NUMERIC", "DECIMAL"].includes(name)) return AFFINITY.REAL;
  if (name === "BOOLEAN" || name === "BOOL") return AFFINITY.BOOLEAN;
  if (name === "BLOB") return AFFINITY.BLOB;
  return AFFINITY.TEXT;
}

/**
 * Return the runtime type name of a value.
 * @param {unknown} value
 * @returns {"null"|"integer"|"real"|"text"}
 */
export function typeOf(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("unsupported number: " + value);
    return Number.isInteger(value) ? "integer" : "real";
  }
  if (typeof value === "boolean") return "integer"; // TRUE / FALSE count as 1 / 0
  if (typeof value === "string") return "text";
  throw new Error("unsupported value type: " + typeof value);
}

/** Whether this value is NULL. */
export function isNull(value) {
  return value === null || value === undefined;
}

/** Normalize a value to the form actually stored at runtime (boolean -> 0/1, undefined -> null). */
export function normalizeValue(value) {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("unsupported number: " + value);
  }
  return value;
}

/**
 * Convert any value to a number; return null when that is not possible.
 * This is the best-effort conversion used by arithmetic.
 * @param {unknown} value
 * @returns {number|null}
 */
export function toNumber(value) {
  if (isNull(value)) return null;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

/** Convert a value to text (NULL stays NULL). */
export function toText(value) {
  if (isNull(value)) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

/** Convert a value to boolean: NULL is false; 0 and the empty string are also false. */
export function truthy(value) {
  if (isNull(value)) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    return !(text === "" || text === "0" || text === "false");
  }
  return true;
}

/** Sort weight by type: NULL < number < text (matches SQLite ORDER BY). */
function typeRank(value) {
  if (isNull(value)) return 0;
  if (typeof value === "number" || typeof value === "boolean") return 1;
  return 2;
}

/**
 * Compare two values, returning a negative number / 0 / a positive number.
 *
 * This is the total order used for sorting:
 *   - NULL sorts first
 *   - numbers by magnitude
 *   - text lexicographically
 *   - numbers always sort before text
 *
 * Note: this is not SQL's equality test. A comparison with NULL yields UNKNOWN,
 * so use IS NULL to test for NULL.
 */
export function compareValues(a, b) {
  const left = normalizeValue(a);
  const right = normalizeValue(b);
  const rankA = typeRank(left);
  const rankB = typeRank(right);
  if (rankA !== rankB) return rankA - rankB;
  if (rankA === 0) return 0;
  if (rankA === 1) {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Evaluate an SQL comparison.
 *
 * Returns true / false or null (meaning UNKNOWN):
 *   NULL = 1         -> UNKNOWN
 *   UNKNOWN AND TRUE -> UNKNOWN
 *   WHERE keeps only rows that are TRUE
 *
 * @param {string} op "=" | "!=" | "<" | "<=" | ">" | ">="
 */
export function compare(op, a, b) {
  const left = normalizeValue(a);
  const right = normalizeValue(b);
  if (isNull(left) || isNull(right)) return null;
  const cmp = compareValues(left, right);
  switch (op) {
    case "=":
    case "==":
      return cmp === 0;
    case "!=":
    case "<>":
      return cmp !== 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    default:
      throw new Error("unsupported comparison operator: " + op);
  }
}

/** Three-valued logic AND. */
export function and3(a, b) {
  if (a === false || b === false) return false;
  if (a === null || b === null) return null;
  return true;
}

/** Three-valued logic OR. */
export function or3(a, b) {
  if (a === true || b === true) return true;
  if (a === null || b === null) return null;
  return false;
}

/** Three-valued logic NOT. */
export function not3(value) {
  if (value === null) return null;
  return !value;
}

/**
 * Convert a value for writing according to the column's type affinity.
 *
 *   INSERT INTO t (n) VALUES ('42')   -- n is INTEGER -> stored as 42
 *   INSERT INTO t (s) VALUES (42)     -- s is TEXT    -> stored as '42'
 *
 * @param {unknown} value
 * @param {string} affinity one of the AFFINITY values
 */
export function applyAffinity(value, affinity) {
  const normalized = normalizeValue(value);
  if (isNull(normalized)) return null;

  switch (affinity) {
    case AFFINITY.INTEGER: {
      const number = toNumber(normalized);
      if (number === null) return normalized; // store as-is when conversion fails (SQLite allows it too)
      return Number.isInteger(number) ? number : Math.trunc(number);
    }
    case AFFINITY.REAL: {
      const number = toNumber(normalized);
      return number === null ? normalized : number;
    }
    case AFFINITY.BOOLEAN: {
      if (typeof normalized === "string") {
        const text = normalized.trim().toLowerCase();
        if (text === "true" || text === "1") return 1;
        if (text === "false" || text === "0") return 0;
      }
      if (typeof normalized === "number") return normalized === 0 ? 0 : 1;
      return truthy(normalized) ? 1 : 0;
    }
    case AFFINITY.TEXT:
      return toText(normalized);
    case AFFINITY.BLOB:
    default:
      return normalized;
  }
}

/** Pattern characters that need escaping in a LIKE pattern. */
const REGEX_SPECIALS = "\\^$.|?*+()[]{}";

function escapeRegExp(text) {
  let out = "";
  for (const ch of text) {
    out += REGEX_SPECIALS.includes(ch) ? "\\" + ch : ch;
  }
  return out;
}

/**
 * SQL LIKE: % matches any length of text, _ matches exactly one character.
 * As in SQLite, ASCII letters are case-insensitive; other characters are case-sensitive.
 *
 * @param {string} text
 * @param {string} pattern
 */
export function likeMatch(text, pattern) {
  const source = toText(text);
  const like = toText(pattern);
  if (source === null || like === null) return null;

  let regex = "^";
  for (let i = 0; i < like.length; i++) {
    const ch = like[i];
    if (ch === "\\") {
      i += 1;
      regex += escapeRegExp(like[i] ?? "");
    } else if (ch === "%") {
      regex += "[\\s\\S]*";
    } else if (ch === "_") {
      regex += "[\\s\\S]";
    } else {
      regex += escapeRegExp(ch);
    }
  }
  regex += "$";
  return new RegExp(regex, "i").test(source);
}

/**
 * Group key for GROUP BY / DISTINCT: differing types are never treated as equal.
 * The number 1 and the string '1' get different keys.
 */
export function groupKey(values) {
  return values
    .map((value) => {
      const normalized = normalizeValue(value);
      if (isNull(normalized)) return "N";
      if (typeof normalized === "number") return "D" + String(normalized);
      return "S" + normalized;
    })
    .join(String.fromCharCode(0));
}

/** Convert a value to a string suitable for terminal display. */
export function displayValue(value) {
  const normalized = normalizeValue(value);
  if (isNull(normalized)) return "NULL";
  if (typeof normalized === "string") return normalized;
  return String(normalized);
}

/** Infer a column type from a value (used in query result metadata). */
export function inferType(value) {
  return typeOf(value);
}
