/* ==========================================================================
   SQL playground - editor / run / result rendering
   Depends on window.SqlEngine from docs/assets/sql-engine.js (may be missing
   before the build runs). When the engine is absent we show a friendly hint
   instead of throwing console errors.
   API:
     window.SqlEngine.createDatabase() -> db
     db.exec(sql) -> { type, columns, rows, rowCount } | { type:"command", message, changes, lastInsertRowid }
     db.execScript(sql) -> { results:[...] }
     db.tables() -> [{ name, columns:[{name,type}] }]
   ========================================================================== */
(function () {
  "use strict";

  var MAX_ROWS = 500;
  var HISTORY_LIMIT = 20;

  var SAMPLES = {
    books: {
      label: "books sample",
      sql: [
        "-- Create a table, insert rows, and query it",
        "CREATE TABLE books (",
        "  id INTEGER PRIMARY KEY,",
        "  title TEXT NOT NULL,",
        "  author TEXT,",
        "  price INTEGER,",
        "  published INTEGER",
        ");",
        "",
        "INSERT INTO books (id, title, author, price, published) VALUES",
        "  (1, 'Database System Concepts', 'Silberschatz', 680, 2019),",
        "  (2, 'SQL Antipatterns', 'Bill Karwin', 520, 2010),",
        "  (3, 'Designing Data-Intensive Applications', 'Martin Kleppmann', 820, 2017),",
        "  (4, 'Refactoring', 'Martin Fowler', 650, 2018);",
        "",
        "SELECT id, title, author, price",
        "FROM books",
        "WHERE price < 700",
        "ORDER BY price DESC;"
      ].join("\n")
    },
    groupby: {
      label: "GROUP BY aggregate",
      sql: [
        "-- Aggregation: order count and revenue per region",
        "CREATE TABLE sales (",
        "  id INTEGER PRIMARY KEY,",
        "  region TEXT NOT NULL,",
        "  amount INTEGER",
        ");",
        "",
        "INSERT INTO sales (id, region, amount) VALUES",
        "  (1, 'Taipei', 1200), (2, 'Taipei', 800), (3, 'Hsinchu', 450),",
        "  (4, 'Taichung', 980), (5, 'Taichung', 640), (6, 'Kaohsiung', 1500);",
        "",
        "SELECT region,",
        "       COUNT(*) AS orders,",
        "       SUM(amount) AS total",
        "FROM sales",
        "GROUP BY region",
        "ORDER BY total DESC;"
      ].join("\n")
    },
    join: {
      label: "JOIN sample",
      sql: [
        "-- Inner join: customers and their orders",
        "CREATE TABLE customers (",
        "  id INTEGER PRIMARY KEY,",
        "  name TEXT NOT NULL",
        ");",
        "",
        "CREATE TABLE orders (",
        "  id INTEGER PRIMARY KEY,",
        "  customer_id INTEGER,",
        "  total INTEGER",
        ");",
        "",
        "INSERT INTO customers (id, name) VALUES",
        "  (1, 'Alice'), (2, 'Bob'), (3, 'Carol');",
        "",
        "INSERT INTO orders (id, customer_id, total) VALUES",
        "  (1, 1, 300), (2, 1, 450), (3, 2, 120), (4, 3, 900), (5, NULL, 50);",
        "",
        "SELECT c.name,",
        "       COUNT(o.id) AS order_count,",
        "       SUM(o.total) AS spent",
        "FROM customers c",
        "JOIN orders o ON o.customer_id = c.id",
        "GROUP BY c.name",
        "ORDER BY spent DESC;"
      ].join("\n")
    }
  };

  var editor = document.getElementById("pg-editor");
  var runBtn = document.getElementById("pg-run");
  var clearBtn = document.getElementById("pg-clear");
  var clearResultsBtn = document.getElementById("pg-clear-results");
  var resultsEl = document.getElementById("pg-results");
  var statusEl = document.getElementById("pg-status");
  var historyEl = document.getElementById("pg-history");
  var tablesBody = document.getElementById("pg-tables-body");
  var tablesCount = document.getElementById("pg-tables-count");
  var engineState = document.getElementById("pg-engine-state");
  var engineWarn = document.getElementById("pg-engine-warn");
  var sampleButtons = Array.prototype.slice.call(document.querySelectorAll(".pg-sample"));

  if (!editor || !resultsEl) return;

  var db = null;
  var history = [];

  /* ---------- Helpers ---------- */
  function escapeHTML(text) {
    return String(text === null || text === undefined ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function firstLine(text) {
    var line = String(text || "").split(/\r?\n/).filter(function (part) {
      return part.trim() && part.trim().indexOf("--") !== 0;
    })[0];
    return (line || String(text || "")).trim().slice(0, 90);
  }

  function now() {
    if (window.performance && typeof window.performance.now === "function") return window.performance.now();
    return Date.now();
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.classList.remove("is-ok", "is-error");
    if (kind === "ok") statusEl.classList.add("is-ok");
    else if (kind === "error") statusEl.classList.add("is-error");
    statusEl.textContent = "";
    var span = document.createElement("span");
    span.textContent = text;
    statusEl.appendChild(span);
  }

  function showEngineWarning(message) {
    if (!engineWarn) return;
    if (message) {
      engineWarn.innerHTML = message;
      engineWarn.hidden = false;
    } else {
      engineWarn.hidden = true;
    }
  }

  function setEngineState(text) {
    if (engineState) engineState.textContent = "engine: " + text;
  }

  function getDb() {
    if (!window.SqlEngine || typeof window.SqlEngine.createDatabase !== "function") {
      throw new Error("Engine not loaded: run node tools/build-docs.mjs to generate assets/sql-engine.js, then reload.");
    }
    if (!db) {
      db = window.SqlEngine.createDatabase();
      setEngineState("in-memory");
    }
    return db;
  }

  /* ---------- Error position ---------- */
  function errorPosition(err, sql) {
    var candidates = [err && err.position, err && err.pos, err && err.offset, err && err.index];
    var pos = null;
    for (var i = 0; i < candidates.length; i += 1) {
      var value = candidates[i];
      if (typeof value === "number" && isFinite(value) && value >= 0) { pos = value; break; }
      if (typeof value === "string" && /^\d+$/.test(value)) { pos = parseInt(value, 10); break; }
    }
    if (pos === null && err && typeof err.message === "string") {
      var m = err.message.match(/position\s*[:=]?\s*(\d+)/i) || err.message.match(/\bat\s+(\d+)/i);
      if (m) pos = parseInt(m[1], 10);
    }
    if (pos === null || !sql) return null;
    var before = String(sql).slice(0, pos);
    var lines = before.split(/\r?\n/);
    var line = lines.length;
    var col = lines[lines.length - 1].length + 1;
    var at = sql.charAt(pos);
    return {
      pos: pos,
      line: line,
      col: col,
      token: at ? at : "EOF"
    };
  }

  /* ---------- Result rendering ---------- */
  function buildTable(result) {
    var columns = Array.isArray(result.columns) ? result.columns : [];
    columns = columns.map(function (column) {
      if (column && typeof column === "object") {
        return { name: column.name !== undefined ? column.name : "?", type: column.type || "" };
      }
      return { name: String(column), type: "" };
    });
    var rows = Array.isArray(result.rows) ? result.rows : [];
    if (!columns.length && rows.length && Array.isArray(rows[0])) {
      columns = rows[0].map(function (_, index) { return { name: "col" + (index + 1), type: "" }; });
    }

    var wrap = document.createElement("div");
    wrap.className = "pg-result__body";

    if (!columns.length) {
      var empty = document.createElement("p");
      empty.textContent = "Query succeeded but returned no columns.";
      wrap.appendChild(empty);
      return wrap;
    }

    var table = document.createElement("table");
    table.className = "pg-table";
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    columns.forEach(function (column) {
      var th = document.createElement("th");
      th.textContent = column.name;
      if (column.type) {
        var type = document.createElement("span");
        type.className = "pg-coltype";
        type.textContent = " " + column.type;
        th.appendChild(type);
      }
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    var visible = rows.slice(0, MAX_ROWS);
    visible.forEach(function (row) {
      var values = row;
      if (!Array.isArray(values)) {
        values = columns.map(function (column) {
          return row && typeof row === "object" ? row[column.name] : row;
        });
      }
      var tr = document.createElement("tr");
      columns.forEach(function (column, index) {
        var td = document.createElement("td");
        var value = values[index];
        if (value === null || value === undefined) {
          var nullEl = document.createElement("span");
          nullEl.className = "pg-null";
          nullEl.textContent = "NULL";
          td.appendChild(nullEl);
        } else if (typeof value === "number") {
          td.textContent = String(value);
          td.className = "pg-num";
        } else if (typeof value === "boolean") {
          td.textContent = value ? "true" : "false";
        } else if (typeof value === "object") {
          td.textContent = JSON.stringify(value);
        } else {
          td.textContent = String(value);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);

    if (rows.length > MAX_ROWS) {
      var more = document.createElement("p");
      more.className = "pg-table__more";
      more.textContent = "Showing the first " + MAX_ROWS + " of " + rows.length + " rows.";
      wrap.appendChild(more);
    }
    return wrap;
  }

  function buildResultCard(result, sql, index, statement) {
    var type = result && result.type ? String(result.type) : (result && Array.isArray(result.rows) ? "select" : "command");
    var source = statement || sql;
    var card = document.createElement("div");
    card.className = "pg-result";

    var head = document.createElement("div");
    head.className = "pg-result__head";

    var tag = document.createElement("span");
    tag.className = "pg-result__tag";
    tag.textContent = type;
    head.appendChild(tag);

    var number = document.createElement("span");
    number.className = "pg-result__idx";
    number.textContent = "#" + (index + 1);
    head.appendChild(number);

    var snippet = document.createElement("span");
    snippet.className = "pg-result__sql";
    snippet.title = source;
    snippet.textContent = firstLine(source) || "SQL";
    head.appendChild(snippet);

    var meta = document.createElement("span");
    meta.className = "pg-result__meta";
    if (type === "select" || Array.isArray(result && result.rows)) {
      var count = result && typeof result.rowCount === "number"
        ? result.rowCount
        : (Array.isArray(result && result.rows) ? result.rows.length : 0);
      meta.textContent = count + " row" + (count === 1 ? "" : "s");
      card.appendChild(buildTable(result || {}));
    } else {
      if (result && typeof result.changes === "number") meta.textContent = result.changes + " row" + (result.changes === 1 ? "" : "s") + " affected";
      else meta.textContent = "#" + (index + 1);
      var body = document.createElement("div");
      body.className = "pg-result__body";
      var message = document.createElement("p");
      message.className = "pg-command-msg";
      var pieces = [];
      if (result && result.message) pieces.push(String(result.message));
      else pieces.push("Statement executed");
      if (result && typeof result.changes === "number") pieces.push("changes " + result.changes);
      if (result && result.lastInsertRowid !== undefined && result.lastInsertRowid !== null) {
        pieces.push("lastInsertRowid " + result.lastInsertRowid);
      }
      message.textContent = pieces.join(" \u00b7 ");
      body.appendChild(message);
      card.appendChild(body);
    }
    head.appendChild(meta);
    card.insertBefore(head, card.firstChild);
    return card;
  }

  function renderResults(results, sql, statements) {
    resultsEl.innerHTML = "";
    if (!results || !results.length) {
      var empty = document.createElement("p");
      empty.className = "pg-empty";
      empty.textContent = "Execution finished with no results.";
      resultsEl.appendChild(empty);
      return;
    }
    var pairs = Array.isArray(statements) && statements.length === results.length ? statements : null;
    results.forEach(function (result, index) {
      resultsEl.appendChild(buildResultCard(result, sql, index, pairs ? pairs[index] : null));
    });
  }

  function renderError(err, sql) {
    resultsEl.innerHTML = "";
    var card = document.createElement("div");
    card.className = "pg-result pg-result--error";

    var head = document.createElement("div");
    head.className = "pg-result__head";
    var tag = document.createElement("span");
    tag.className = "pg-result__tag";
    tag.textContent = "error";
    head.appendChild(tag);
    var snippet = document.createElement("span");
    snippet.className = "pg-result__sql";
    snippet.textContent = firstLine(sql) || "SQL";
    head.appendChild(snippet);
    card.appendChild(head);

    var body = document.createElement("div");
    body.className = "pg-result__body";
    var box = document.createElement("div");
    box.className = "pg-error";
    box.textContent = err && err.message ? err.message : String(err);
    var position = errorPosition(err, sql);
    if (position) {
      var posLine = document.createElement("span");
      posLine.className = "pg-error__pos";
      posLine.textContent = "SQL position: line " + position.line + ", column " + position.col + " (offset " + position.pos + ", at \u201c" + position.token + "\u201d)";
      box.appendChild(posLine);
    }
    if (err && (err.code || err.sqlState)) {
      var code = document.createElement("span");
      code.className = "pg-error__pos";
      code.textContent = "Error code: " + (err.code || err.sqlState);
      box.appendChild(code);
    }
    body.appendChild(box);
    card.appendChild(body);
    resultsEl.appendChild(card);
  }

  /* ---------- Execution ---------- */
  function splitStatements(sql) {
    var statements = [];
    var current = "";
    var quote = null;
    var text = String(sql);
    for (var i = 0; i < text.length; i += 1) {
      var ch = text.charAt(i);
      if (quote) {
        current += ch;
        if (ch === quote) {
          if (text.charAt(i + 1) === quote) { current += text.charAt(i + 1); i += 1; }
          else quote = null;
        }
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; current += ch; continue; }
      if (ch === "-" && text.charAt(i + 1) === "-") {
        var lineEnd = text.indexOf("\n", i);
        if (lineEnd === -1) lineEnd = text.length;
        current += text.slice(i, lineEnd);
        i = lineEnd - 1;
        continue;
      }
      if (ch === ";") {
        if (current.trim()) statements.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    if (current.trim()) statements.push(current.trim());
    return statements;
  }

  function execute() {
    var sql = editor.value;
    if (!sql || !sql.trim()) {
      setStatus("Enter some SQL before running.", "error");
      return;
    }
    var started = now();
    try {
      var database = getDb();
      var results = [];
      var statements = splitStatements(sql);
      if (typeof database.execScript === "function") {
        var payload = database.execScript(sql);
        if (payload && Array.isArray(payload.results)) results = payload.results;
        else if (Array.isArray(payload)) results = payload;
        else if (payload) results = [payload];
      } else if (typeof database.exec === "function") {
        if (!statements.length) throw new Error("No statements to execute.");
        statements.forEach(function (statement) { results.push(database.exec(statement)); });
      } else {
        throw new Error("Database object exposes neither exec() nor execScript().");
      }

      renderResults(results, sql, statements);
      var rowCount = results.reduce(function (sum, result) {
        if (result && result.type === "select" && typeof result.rowCount === "number") return sum + result.rowCount;
        if (result && Array.isArray(result.rows)) return sum + result.rows.length;
        return sum;
      }, 0);
      var elapsed = Math.max(0, now() - started);
      setStatus(results.length + (results.length === 1 ? " result" : " results") + " \u00b7 " + rowCount + (rowCount === 1 ? " row" : " rows") + " \u00b7 " + elapsed.toFixed(1) + " ms", "ok");
      showEngineWarning(null);
    } catch (err) {
      renderError(err, sql);
      var message = err && err.message ? err.message : String(err);
      setStatus("Error: " + message, "error");
      if (!window.SqlEngine) {
        showEngineWarning("Engine bundle not generated yet: run <code>node tools/build-docs.mjs</code> then reload and <code>assets/sql-engine.js</code> will appear here. You can still read and write SQL in the editor.");
      }
    }
    addHistory(sql);
    refreshTables();
  }

  /* ---------- History ---------- */
  function renderHistory() {
    if (!historyEl) return;
    historyEl.innerHTML = "";
    if (!history.length) {
      var empty = document.createElement("li");
      empty.className = "pg-history__empty";
      empty.textContent = "No history yet";
      historyEl.appendChild(empty);
      return;
    }
    history.forEach(function (entry) {
      var li = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = entry.label;
      button.title = entry.sql;
      button.addEventListener("click", function () {
        editor.value = entry.sql;
        editor.focus();
        setStatus("History SQL restored, press Run to execute it again.", null);
      });
      li.appendChild(button);
      historyEl.appendChild(li);
    });
  }

  function addHistory(sql) {
    var trimmed = String(sql || "").trim();
    if (!trimmed) return;
    if (history.length && history[0].sql === trimmed) return;
    history.unshift({ sql: trimmed, label: firstLine(trimmed) || "SQL" });
    if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
    renderHistory();
  }

  /* ---------- Tables ---------- */
  function refreshTables() {
    if (!tablesBody) return;
    var tables = null;
    try {
      if (db && typeof db.tables === "function") tables = db.tables();
    } catch (err) {
      tables = null;
    }
    tablesBody.innerHTML = "";
    if (!tables || !tables.length) {
      var empty = document.createElement("span");
      empty.className = "pg-chip";
      empty.textContent = window.SqlEngine ? "No tables yet" : "Engine not loaded";
      tablesBody.appendChild(empty);
      if (tablesCount) tablesCount.textContent = "0 tables";
      return;
    }
    if (tablesCount) tablesCount.textContent = tables.length + (tables.length === 1 ? " table" : " tables");
    tables.forEach(function (table) {
      var chip = document.createElement("span");
      chip.className = "pg-chip";
      var name = document.createElement("b");
      name.textContent = table && table.name ? table.name : "?";
      chip.appendChild(name);
      var columns = table && Array.isArray(table.columns) ? table.columns : [];
      var detail = document.createElement("span");
      detail.textContent = columns.length ? " (" + columns.map(function (column) {
        return column && column.name ? column.name : "?";
      }).join(", ") + ")" : "";
      chip.appendChild(detail);
      tablesBody.appendChild(chip);
    });
  }

  /* ---------- Editor helpers ---------- */
  function insertText(text) {
    var start = editor.selectionStart;
    var end = editor.selectionEnd;
    var value = editor.value;
    editor.value = value.slice(0, start) + text + value.slice(end);
    var caret = start + text.length;
    editor.selectionStart = caret;
    editor.selectionEnd = caret;
    editor.focus();
  }

  function loadSample(key) {
    var sample = SAMPLES[key];
    if (!sample) return;
    editor.value = sample.sql;
    editor.focus();
    editor.selectionStart = editor.selectionEnd = editor.value.length;
    setStatus("Loaded \u201c" + sample.label + "\u201d. Press Run or Ctrl/Cmd + Enter.", null);
  }

  /* ---------- Wiring ---------- */
  editor.addEventListener("keydown", function (event) {
    if (event.key === "Tab") {
      event.preventDefault();
      insertText("  ");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === "Enter" || event.key === "NumpadEnter")) {
      event.preventDefault();
      execute();
    }
  });

  if (runBtn) runBtn.addEventListener("click", execute);

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      editor.value = "";
      editor.focus();
      setStatus("Editor cleared.", null);
    });
  }

  if (clearResultsBtn) {
    clearResultsBtn.addEventListener("click", function () {
      resultsEl.innerHTML = "";
      var empty = document.createElement("p");
      empty.className = "pg-empty";
      empty.textContent = "Run SQL on the left and the results will appear here.";
      resultsEl.appendChild(empty);
      setStatus("Results cleared.", null);
    });
  }

  sampleButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      loadSample(button.getAttribute("data-sample"));
    });
  });

  /* ---------- Init ---------- */
  editor.value = SAMPLES.books.sql;
  renderHistory();
  refreshTables();
  if (window.SqlEngine && typeof window.SqlEngine.createDatabase === "function") {
    setEngineState("ready");
    showEngineWarning(null);
    setStatus("Ready \u00b7 Ctrl / Cmd + Enter to run", null);
  } else {
    setEngineState("missing");
    showEngineWarning("Engine bundle not generated yet: run <code>node tools/build-docs.mjs</code> then reload and <code>assets/sql-engine.js</code> will appear here. You can still read and write SQL in the editor.");
    setStatus("Engine not loaded: run node tools/build-docs.mjs, then reload.", "error");
  }
})();
