/**
 * All SQL errors are wrapped in SqlError.
 *
 * A good database error message should tell the user three things:
 *   1. where it failed (offset / line / column)
 *   2. which character is wrong (print the offending SQL snippet and point at it with ^)
 *   3. how to fix it (optional hint)
 *
 * This class is shared by the tokenizer, parser, and executor across the project.
 */
export class SqlError extends Error {
  /**
   * @param {string} message human-readable error message
   * @param {object} [options]
   * @param {string} [options.code] stable error code for programmatic checks (e.g. SYNTAX_ERROR)
   * @param {{offset:number, line:number, column:number}|null} [options.position]
   * @param {string|null} [options.hint] suggested fix
   */
  constructor(message, { code = "SQL_ERROR", position = null, hint = null } = {}) {
    super(message);
    this.name = "SqlError";
    this.code = code;
    this.position = position;
    this.hint = hint;
  }

  /**
   * Format the error as a multi-line string suitable for printing in a terminal:
   *
   *   SYNTAX_ERROR: expected ...
   *     SELECT * FROM
   *                  ^
   *   hint: ...
   */
  format(source) {
    const lines = [`${this.code}: ${this.message}`];
    if (source && this.position) {
      const { line, column } = this.position;
      const text = source.split(/\r?\n/)[line - 1] ?? "";
      const gutter = String(line).length;
      lines.push(`${" ".repeat(gutter)} |`);
      lines.push(`${line} | ${text}`);
      lines.push(`${" ".repeat(gutter)} | ${" ".repeat(Math.max(0, column - 1))}^`);
    }
    if (this.hint) lines.push(`Hint: ${this.hint}`);
    return lines.join("\n");
  }
}

/** Convenience helper for creating syntax errors. */
export function syntaxError(message, token, hint = null) {
  return new SqlError(message, {
    code: "SYNTAX_ERROR",
    position: token ? { offset: token.start, line: token.line, column: token.column } : null,
    hint,
  });
}
