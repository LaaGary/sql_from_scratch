#!/usr/bin/env node
/**
 * Tutorial site build script
 *
 * Assemble the content of docs/content/*.html with the code snapshots in steps/ into
 * docs/chapters/*.html and docs/reference.html, and also generate:
 *
 *   docs/assets/toc.js        chapter list (used by search, progress, and the roadmap)
 *   docs/assets/sql-engine.js browser build of the engine (used by the playground)
 *
 * Usage:
 *   node tools/build-docs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const DOCS = path.join(ROOT, "docs");
const STEPS = path.join(ROOT, "steps");

// ---------------------------------------------------------------------------
// chapter config
// ---------------------------------------------------------------------------

const CHAPTERS = [
  {
    n: 1,
    file: "ch01.html",
    short: "Orientation and skeleton",
    title: "Draw the map first: what parts is a database made of?",
    summary: "Break an SQL database into its six main parts, then build the project skeleton and a command-line REPL.",
    minutes: 25,
    learn: ["the overall architecture of a database engine", "the directory layout of the project", "writing a REPL loop in Node.js"],
  },
  {
    n: 2,
    file: "ch02.html",
    short: "Lexing",
    title: "Cut SQL into tokens: the tokenizer",
    summary: "Write a lexer from scratch that handles strings, numbers, comments, and operators, and remembers positions.",
    minutes: 45,
    learn: ["what lexing does", "finite-state scanning", "how error positions (line / column) are computed"],
  },
  {
    n: 3,
    file: "ch03.html",
    short: "Parsing",
    title: "Make statements stand up: the parser and the syntax tree",
    summary: "Parse CREATE / INSERT / SELECT with recursive descent, implementing expression precedence and an AST.",
    minutes: 60,
    learn: ["recursive descent and precedence climbing", "designing the AST", "how to write syntax error messages"],
  },
  {
    n: 4,
    file: "ch04.html",
    short: "Values and types",
    title: "NULL is not 0: values, types, and comparison",
    summary: "Integers, reals, text, and NULL; three-valued logic, type affinity, and LIKE.",
    minutes: 40,
    learn: ["SQL three-valued logic", "type affinity", "LIKE and string comparison"],
  },
  {
    n: 5,
    file: "ch05.html",
    short: "Storage layer",
    title: "Where the data lives: schema, tables, and storage backends",
    summary: "Build the table schema, row model, and constraint checks, plus a swappable storage backend interface.",
    minutes: 55,
    learn: ["schema and column constraints", "rowid and how rows are represented", "abstracting storage behind an interface"],
  },
  {
    n: 6,
    file: "ch06.html",
    short: "SELECT pipeline",
    title: "Actually getting rows back: the SELECT execution pipeline",
    summary: "Wire together expression evaluation, scan, filter, projection, sort, and LIMIT so the CLI can really query.",
    minutes: 70,
    learn: ["each stage of the query pipeline", "expression evaluation and column resolution", "connecting the engine to the CLI"],
  },
  {
    n: 7,
    file: "ch07.html",
    short: "Aggregates and grouping",
    title: "Turn many rows into one number: aggregates and GROUP BY",
    summary: "COUNT / SUM / AVG / MIN / MAX, grouping, HAVING, and caching of aggregate state.",
    minutes: 50,
    learn: ["the semantics of aggregate functions", "how grouping is implemented", "table-wide aggregates vs. GROUP BY"],
  },
  {
    n: 8,
    file: "ch08.html",
    short: "Update and delete",
    title: "Make the data move: UPDATE / DELETE and statement atomicity",
    summary: "Row-by-row rewriting, WHERE filtering, old-value semantics, and rolling back the whole statement on failure.",
    minutes: 40,
    learn: ["how UPDATE executes", "old values versus new values", "statement-level atomicity"],
  },
  {
    n: 9,
    file: "ch09.html",
    short: "JOIN",
    title: "Connect two tables: JOIN and nested loops",
    summary: "INNER / LEFT JOIN, ON conditions, ambiguous-column errors, and why JOIN is slow.",
    minutes: 45,
    learn: ["nested-loop JOIN", "NULL padding in LEFT JOIN", "JOIN performance and the motivation for indexes"],
  },
  {
    n: 10,
    file: "ch10.html",
    short: "Persistence and transactions",
    title: "Data outlives the process: pages, journal, and transactions",
    summary: "4096-byte pages, slotted pages, the catalog, a CRC32 journal, and crash recovery.",
    minutes: 80,
    learn: ["the page-based storage format", "how the catalog relates to the heap", "journal and roll-forward recovery", "BEGIN / COMMIT / ROLLBACK"],
  },
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function stepDir(stepNumber) {
  const prefix = pad(Number(stepNumber));
  const entry = fs.readdirSync(STEPS).find((name) => name.startsWith(prefix + "-"));
  if (!entry) throw new Error("no code snapshot for step " + stepNumber);
  return path.join(STEPS, entry);
}

function resolveFile(relPath, stepNumber) {
  const base = stepNumber ? stepDir(stepNumber) : ROOT;
  const full = path.join(base, relPath);
  if (!fs.existsSync(full)) {
    throw new Error("file not found: " + relPath + (stepNumber ? " (step " + stepNumber + ")" : ""));
  }
  return full;
}

// ---------------------------------------------------------------------------
// syntax highlighting
// ---------------------------------------------------------------------------

const KEYWORDS = new Set((
  "import export from default const let var function return if else for while do switch case break continue " +
  "class extends new this super try catch finally throw async await yield typeof instanceof in of void delete " +
  "null undefined true false"
).split(" "));

const TYPES = new Set(["Buffer", "Map", "Set", "Promise", "Error", "Array", "Object", "String", "Number", "Boolean", "Uint32Array", "BigInt"]);

function highlight(code) {
  let out = "";
  let i = 0;

  const push = (className, text) => {
    out += className ? '<span class="' + className + '">' + escapeHtml(text) + "</span>" : escapeHtml(text);
  };

  while (i < code.length) {
    const rest = code.slice(i);

    // block comment
    if (rest.startsWith("/*")) {
      const end = code.indexOf("*/", i + 2);
      const text = end === -1 ? code.slice(i) : code.slice(i, end + 2);
      push("tk-com", text);
      i += text.length;
      continue;
    }

    // line comment
    if (rest.startsWith("//")) {
      const end = code.indexOf("\n", i);
      const text = end === -1 ? code.slice(i) : code.slice(i, end);
      push("tk-com", text);
      i += text.length;
      continue;
    }

    const ch = code[i];

    // strings (including template strings)
    if (ch === '"' || ch === "'" || ch === "\u0060") {
      let end = i + 1;
      while (end < code.length) {
        if (code[end] === "\\") { end += 2; continue; }
        if (code[end] === ch) { end += 1; break; }
        end += 1;
      }
      push("tk-str", code.slice(i, end));
      i = end;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch) && !/[A-Za-z_$0-9]/.test(code[i - 1] || "")) {
      let end = i;
      while (end < code.length && /[0-9a-fA-FxX._eE+-]/.test(code[end])) {
        if ((code[end] === "+" || code[end] === "-") && !/[eE]/.test(code[end - 1])) break;
        end += 1;
      }
      push("tk-num", code.slice(i, end));
      i = end;
      continue;
    }

    // identifier
    if (/[A-Za-z_$]/.test(ch)) {
      let end = i;
      while (end < code.length && /[A-Za-z0-9_$]/.test(code[end])) end += 1;
      const word = code.slice(i, end);
      const after = code.slice(end).trimStart();
      let className = "tk-ident";
      if (KEYWORDS.has(word)) className = "tk-kw";
      else if (TYPES.has(word)) className = "tk-type";
      else if (after.startsWith("(")) className = "tk-fn";
      push(className, word);
      i = end;
      continue;
    }

    // operator
    if ("+-*/%=<>!&|^~?:.,;()[]{}".includes(ch)) {
      push("tk-op", ch);
      i += 1;
      continue;
    }

    // everything else (whitespace, Chinese comments, etc.)
    push(null, ch);
    i += 1;
  }

  return out;
}

// ---------------------------------------------------------------------------
// file blocks and diff
// ---------------------------------------------------------------------------

function renderFileBlock(filePath, displayPath, stepNumber, title) {
  const full = resolveFile(filePath, stepNumber);
  const code = fs.readFileSync(full, "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "");
  const lines = code.split("\n").length;
  const name = title || displayPath;
  const meta = "JavaScript · " + lines + " lines" + (stepNumber ? " · step " + stepNumber : "");
  return (
    '<div class="file">' +
    '<div class="file__head">' +
    '<span class="file__name">' + escapeHtml(name) + "</span>" +
    '<span class="file__meta">' + escapeHtml(meta) + "</span>" +
    "</div>" +
    '<pre class="code"><code>' + highlight(code) + "</code></pre>" +
    "</div>"
  );
}

function renderDiff(filePath, fromStep, toStep, title) {
  const before = fs.readFileSync(resolveFile(filePath, fromStep), "utf8").replace(/\r\n/g, "\n").split("\n");
  const after = fs.readFileSync(resolveFile(filePath, toStep), "utf8").replace(/\r\n/g, "\n").split("\n");
  const lines = diffLines(before, after);
  let html = '<div class="diff"><pre class="code code--diff"><code>';
  for (const line of lines) {
    const prefix = line.type === "add" ? "+ " : line.type === "del" ? "- " : "  ";
    const className = line.type === "add" ? "d-add" : line.type === "del" ? "d-del" : "d-ctx";
    html += '<span class="' + className + '">' + escapeHtml(prefix + line.text) + "</span>\n";
  }
  html += "</code></pre></div>";
  return html;
}

/** Line-by-line diff using LCS. */
function diffLines(before, after) {
  const n = before.length;
  const m = after.length;
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const result = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      result.push({ type: "ctx", text: before[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ type: "del", text: before[i] });
      i++;
    } else {
      result.push({ type: "add", text: after[j] });
      j++;
    }
  }
  while (i < n) result.push({ type: "del", text: before[i++] });
  while (j < m) result.push({ type: "add", text: after[j++] });
  return result;
}

/** Expand the include / diff comments in the content. */
function expandContent(content, chapter) {
  return content
    .replace(/<!--\s*include\s+(\S+?)(?:\s+step=(\d+))?(?:\s+title="([^"]*)")?\s*-->/g, (match, filePath, step, title) => {
      return renderFileBlock(filePath, filePath, step ? Number(step) : chapter.n, title);
    })
    .replace(/<!--\s*diff\s+(\S+?)\s+from=(\d+)\s+to=(\d+)(?:\s+title="([^"]*)")?\s*-->/g, (match, filePath, from, to, title) => {
      const block = renderDiff(filePath, Number(from), Number(to), title);
      const label = '<p class="diff__label">' + escapeHtml(title || filePath + ": step " + from + " → step " + to) + "</p>";
      return label + block;
    });
}

// ---------------------------------------------------------------------------
// layout assembly
// ---------------------------------------------------------------------------

function renderNav(prefix) {
  const items = CHAPTERS.map((chapter) => (
    '<li class="toc-item"><a class="toc-link" href="' + prefix + "chapters/" + chapter.file + '">' +
    '<span class="toc-num">' + pad(chapter.n) + "</span>" +
    '<span class="toc-title">' + escapeHtml(chapter.short) + "</span></a></li>"
  )).join("");
  return '<ol class="toc-list">' + items + "</ol>";
}

function pagerLink(direction, chapter, prefix) {
  if (!chapter) return "";
  const label = direction === "prev" ? "Previous chapter" : "Next chapter";
  return (
    '<a class="pager-link pager-link--' + direction + '" href="' + prefix + "chapters/" + chapter.file + '">' +
    '<span class="pager-link__meta">' + label + "</span>" +
    '<span class="pager-link__title">Chapter ' + chapter.n + " · " + escapeHtml(chapter.short) + "</span></a>"
  );
}

function buildPage(options) {
  const layout = fs.readFileSync(path.join(DOCS, "_layout.html"), "utf8");
  const replacements = {
    "{{PAGE_KIND}}": options.kind,
    "{{TITLE}}": escapeHtml(options.title),
    "{{DESCRIPTION}}": escapeHtml(options.description),
    "{{NAV}}": renderNav(options.prefix),
    "{{CONTENT}}": options.content,
    "{{PREV}}": options.prev || "",
    "{{NEXT}}": options.next || "",
    "{{CHAPTER_TITLE}}": escapeHtml(options.chapterTitle || ""),
    "{{PREV_URL}}": options.prevUrl || "",
    "{{NEXT_URL}}": options.nextUrl || "",
  };
  let html = layout;
  for (const [token, value] of Object.entries(replacements)) {
    html = html.split(token).join(value);
  }
  // add the asset prefix last so relative paths in the content are not rewritten by mistake
  html = html.split("{{ASSET_PREFIX}}").join(options.prefix);
  const leftover = html.match(/\{\{[A-Z_]+\}\}/g) || [];
  if (leftover.length > 0) {
    throw new Error("layout has unreplaced placeholders: " + leftover.join(", "));
  }
  return html;
}

// ---------------------------------------------------------------------------
// main flow
// ---------------------------------------------------------------------------

function main() {
  const chaptersDir = path.join(DOCS, "chapters");
  fs.mkdirSync(chaptersDir, { recursive: true });

  // 1. toc.js
  const toc = CHAPTERS.map((chapter) => ({
    n: chapter.n,
    slug: "ch" + pad(chapter.n),
    title: "Chapter " + chapter.n + " · " + chapter.short,
    summary: chapter.summary,
    href: "chapters/" + chapter.file,
    minutes: chapter.minutes,
  }));
  fs.writeFileSync(
    path.join(DOCS, "assets", "toc.js"),
    "window.SQL_TOC = " + JSON.stringify(toc, null, 2) + ";\n"
  );

  // 2. chapter page
  for (const chapter of CHAPTERS) {
    const contentFile = path.join(DOCS, "content", "ch" + pad(chapter.n) + ".html");
    if (!fs.existsSync(contentFile)) throw new Error("missing content: " + contentFile);
    const content = expandContent(fs.readFileSync(contentFile, "utf8"), chapter);
    const prev = chapter.n > 1 ? CHAPTERS[chapter.n - 2] : null;
    const next = chapter.n < CHAPTERS.length ? CHAPTERS[chapter.n] : null;
    const prefix = "../";
    const html = buildPage({
      kind: "chapter",
      prefix,
      title: "Chapter " + chapter.n + " · " + chapter.short + " — Building an SQL database engine from scratch",
      description: chapter.summary,
      chapterTitle: "Chapter " + chapter.n + " · " + chapter.short,
      content,
      prev: pagerLink("prev", prev, prefix),
      next: pagerLink("next", next, prefix),
      prevUrl: prev ? prefix + "chapters/" + prev.file : "",
      nextUrl: next ? prefix + "chapters/" + next.file : "",
    });
    fs.writeFileSync(path.join(chaptersDir, chapter.file), html);
  }

  // 3. reference page
  const referenceContent = expandContent(
    fs.readFileSync(path.join(DOCS, "content", "reference.html"), "utf8"),
    { n: 10 }
  );
  const last = CHAPTERS[CHAPTERS.length - 1];
  const reference = buildPage({
    kind: "reference",
    prefix: "",
    title: "SQL syntax reference — Building an SQL database engine from scratch",
    description: "Quick reference for the SQL syntax, functions, error codes, and CLI commands this teaching database supports.",
    chapterTitle: "Appendix · syntax reference",
    content: referenceContent,
    prev: pagerLink("prev", last, ""),
    next: "",
    prevUrl: "chapters/" + last.file,
    nextUrl: "",
  });
  fs.writeFileSync(path.join(DOCS, "reference.html"), reference);

  // 4. browser build of the engine
  const bundle = buildEngineBundle();
  fs.writeFileSync(path.join(DOCS, "assets", "sql-engine.js"), bundle);

  console.log("Build complete:");
  console.log("  docs/chapters/*.html  " + CHAPTERS.length + " pages");
  console.log("  docs/reference.html");
  console.log("  docs/assets/toc.js");
  console.log("  docs/assets/sql-engine.js  " + Math.round(bundle.length / 1024) + " KB");
}

// ---------------------------------------------------------------------------
// bundle the browser build of the engine
// ---------------------------------------------------------------------------

const ENGINE_MODULES = [
  "src/values.js",
  "src/errors.js",
  "src/tokenizer.js",
  "src/parser.js",
  "src/table.js",
  "src/schema.js",
  "src/storage/memory.js",
  "src/engine/expr.js",
  "src/engine/aggregate.js",
  "src/engine/query.js",
  "src/engine/write.js",
  "src/engine/executor.js",
  "src/database.js",
];

function moduleId(currentModule, specifier) {
  const base = path.posix.dirname(currentModule);
  let resolved = path.posix.normalize(path.posix.join(base, specifier));
  if (!resolved.endsWith(".js")) resolved += ".js";
  return resolved;
}

function transformModule(moduleIdValue, source) {
  const exported = [];
  let code = source.replace(/^import\s+\{([\s\S]*?)\}\s+from\s+["']([^"']+)["'];?/gm, (match, names, specifier) => {
    return "const {" + names + '} = __require("' + moduleId(moduleIdValue, specifier) + '");';
  });
  code = code.replace(/^import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["'];?/gm, (match, name, specifier) => {
    return 'const ' + name + ' = __require("' + moduleId(moduleIdValue, specifier) + '");';
  });
  code = code.replace(/^export\s+(function|class|const|let|var)\s+([A-Za-z0-9_$]+)/gm, (match, kind, name) => {
    exported.push(name);
    return kind + " " + name;
  });
  if (/^import\s/m.test(code) || /^export\s/m.test(code)) {
    throw new Error("unhandled import/export left in module: " + moduleIdValue);
  }
  const footer = exported.map((name) => "__exports." + name + " = " + name + ";").join("\n");
  return '__define("' + moduleIdValue + '", function (__exports) {\n' + code + "\n" + footer + "\n});";
}

function buildEngineBundle() {
  const parts = [];
  parts.push("/* sql-engine.js: generated by tools/build-docs.mjs; do not edit by hand. */");
  parts.push("(function (global) {");
  parts.push('"use strict";');
  parts.push("var __modules = Object.create(null);");
  parts.push("var __cache = Object.create(null);");
  parts.push("function __define(id, factory) { __modules[id] = factory; }");
  parts.push("function __require(id) {");
  parts.push("  if (__cache[id]) return __cache[id];");
  parts.push('  if (!__modules[id]) throw new Error("module not found: " + id);');
  parts.push("  var exports = {};");
  parts.push("  __cache[id] = exports;");
  parts.push("  __modules[id](exports);");
  parts.push("  return exports;");
  parts.push("}");

  for (const module of ENGINE_MODULES) {
    const source = fs.readFileSync(path.join(ROOT, module), "utf8").replace(/\r\n/g, "\n");
    parts.push(transformModule(module, source));
  }

  parts.push(
    "var DatabaseModule = __require(\"src/database.js\");\n" +
    "var MemoryModule = __require(\"src/storage/memory.js\");\n" +
    "var TokenizerModule = __require(\"src/tokenizer.js\");\n" +
    "var ParserModule = __require(\"src/parser.js\");\n" +
    "var ExecutorModule = __require(\"src/engine/executor.js\");\n" +
    "var ErrorsModule = __require(\"src/errors.js\");\n" +
    "var ValuesModule = __require(\"src/values.js\");\n" +
    "\n" +
    "function createRawDatabase() { return DatabaseModule.Database.open(new MemoryModule.MemoryStore()); }\n" +
    "function wrapDatabase(raw) {\n" +
    "  return {\n" +
    "    exec: function (sql) { var results = raw.exec(sql); return results[results.length - 1]; },\n" +
    "    execScript: function (sql) { return { results: raw.exec(sql) }; },\n" +
    "    tables: function () {\n" +
    "      return raw.listTables().map(function (name) {\n" +
    "        var table = raw.getTable(name);\n" +
    "        return { name: name, columns: table.columns.map(function (column) { return { name: column.name, type: column.type }; }) };\n" +
    "      });\n" +
    "    },\n" +
    "    raw: raw\n" +
    "  };\n" +
    "}\n" +
    "\n" +
    "global.SqlEngine = {\n" +
    "  VERSION: \"1.0.0\",\n" +
    "  createDatabase: function () { return wrapDatabase(createRawDatabase()); },\n" +
    "  execScript: function (sql) { var raw = createRawDatabase(); try { return { results: raw.exec(sql) }; } finally { raw.tables.clear(); } },\n" +
    "  tokenize: TokenizerModule.tokenize,\n" +
    "  parseScript: ParserModule.parseScript,\n" +
    "  execute: ExecutorModule.execute,\n" +
    "  SqlError: ErrorsModule.SqlError,\n" +
    "  displayValue: ValuesModule.displayValue,\n" +
    "  Database: DatabaseModule.Database,\n" +
    "  MemoryStore: MemoryModule.MemoryStore\n" +
    "};\n" +
    "})(typeof window !== \"undefined\" ? window : globalThis);\n"
  );

  return parts.join("\n");
}

main();
