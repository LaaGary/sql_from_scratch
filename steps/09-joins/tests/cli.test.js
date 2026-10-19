import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(here, "..", "bin", "sql.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sql-cli-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function runCli(args, input) {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    input,
    encoding: "utf8",
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

test("CLI: run SQL from stdin", () => {
  const { stdout, status } = runCli([], [
    "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);",
    "INSERT INTO t VALUES (1, 'Alice');",
    "SELECT * FROM t;",
    ".exit",
  ].join("\n"));
  assert.equal(status, 0);
  assert.match(stdout, /Created table t/);
  assert.match(stdout, /id\s+name/);
  assert.match(stdout, /Alice/);
});

test("CLI: data is saved when a file is given and is still there next time", () => {
  const filePath = path.join(dir, "cli.db");
  const first = runCli([filePath], "CREATE TABLE t (id INTEGER);\nINSERT INTO t VALUES (42);\n");
  assert.equal(first.status, 0);

  const second = runCli([filePath], "SELECT * FROM t;\n");
  assert.equal(second.status, 0);
  assert.match(second.stdout, /42/);
});

test("CLI: errors show position and hint without crashing", () => {
  const { stdout, stderr, status } = runCli([], "SELECT * FROM nope;\n");
  assert.equal(status, 0);
  assert.match(stderr, /SCHEMA_ERROR/);
  assert.match(stderr, /Hint/);
});
