#!/usr/bin/env node
/**
 * tools/serve.mjs — zero-dependency Node.js static server
 *
 * Usage:
 *   node tools/serve.mjs            # http://localhost:8080/docs/
 *   node tools/serve.mjs 3000       # custom port
 *   node tools/serve.mjs --help
 *
 * The root is always the parent of this file (that is SQL/), so /docs/ is the tutorial site.
 * Depends on no npm packages; only node: built-in modules.
 */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PORT = 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
  ".db": "application/octet-stream"
};

function printHelp() {
  const text = [
    "Usage: node tools/serve.mjs [port] [options]",
    "",
    "Zero-dependency static server; the root is SQL/ (the parent of this file).",
    "",
    "Options:",
    "  port              port to listen on, default 8080",
    "  -h, --help        show this help",
    "",
    "Examples:",
    "  node tools/serve.mjs",
    "  node tools/serve.mjs 3000",
    "",
    "Open after starting:",
    "  http://localhost:8080/docs/",
    "  http://localhost:8080/docs/playground.html",
    "",
    "Features:",
    "  · correct Content-Type (html/css/js/mjs/json/svg/png/ico ...)",
    "  · directories use index.html automatically",
    "  · path traversal (../) is always rejected with 403",
    "  · a custom 404 page when a file is missing",
    "  · no-store caching for development: edit a file and refresh"
  ].join("\n");
  process.stdout.write(text + "\n");
}

function parseArgs(argv) {
  const options = { port: DEFAULT_PORT, help: false };
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--port=")) {
      options.port = Number.parseInt(arg.slice("--port=".length), 10);
      continue;
    }
    if (/^\d+$/.test(arg)) {
      options.port = Number.parseInt(arg, 10);
      continue;
    }
    if (arg.startsWith("-")) {
      options.unknown = arg;
      continue;
    }
    options.unknownPath = arg;
  }
  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    options.port = DEFAULT_PORT;
  }
  return options;
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PAGE_STYLE = [
  "html{color-scheme:dark light}",
  "body{margin:0;min-height:100vh;display:grid;place-items:center;",
  "background:#0a0e13;color:#dfe7ee;",
  "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
  ".box{max-width:640px;padding:2.4rem 2rem;border:1px solid #2b3b4c;",
  "border-left:2px solid #43d9a3;background:#0f1620;border-radius:5px}",
  "h1{margin:0 0 .6rem;font-family:Georgia,'Noto Serif TC',serif;font-size:1.6rem;",
  "font-weight:600;color:#f4f8fb}",
  "p{margin:.35rem 0;line-height:1.7;color:#93a3b3}",
  "code{color:#43d9a3}",
  "a{color:#43d9a3;text-decoration:underline;text-underline-offset:2px}",
  "a:hover{color:#f4f8fb}"
].join("");

function errorPage(status, title, message, target) {
  const label = status === 404 ? "NOT FOUND" : status === 403 ? "FORBIDDEN" : "ERROR";
  return [
    "<!doctype html>",
    '<html lang="zh-Hant-TW">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>" + status + " " + htmlEscape(title) + "</title>",
    "<style>" + PAGE_STYLE + "</style>",
    "</head>",
    "<body>",
    '  <main class="box">',
    '    <p style="margin:0 0 .8rem;font-size:.7rem;letter-spacing:.2em;color:#67798a">' + status + " / " + label + "</p>",
    "    <h1>" + htmlEscape(title) + "</h1>",
    "    <p>" + htmlEscape(message) + "</p>",
    '    <p style="margin-top:1.2rem">Path: <code>' + htmlEscape(target || "/") + "</code></p>",
    '    <p><a href="/docs/">Back to the tutorial site</a> · <a href="/">Server root</a></p>',
    "  </main>",
    "</body>",
    "</html>"
  ].join("\n");
}

function sendError(res, status, title, message, target, method) {
  const body = Buffer.from(errorPage(status, title, message, target), "utf8");
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  if (method === "HEAD") res.end();
  else res.end(body);
}

function resolveSafePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return { error: "bad-request" };
  }
  if (decoded.includes("\0")) return { error: "bad-request" };
  const clean = decoded.replace(/\\/g, "/");
  const normalized = path.posix.normalize(clean);
  if (normalized.split("/").includes("..")) return { error: "forbidden" };
  const absolute = path.resolve(ROOT, "." + (normalized.startsWith("/") ? normalized : "/" + normalized));
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (absolute !== ROOT && !absolute.startsWith(rootWithSep)) return { error: "forbidden" };
  return { absolute };
}

async function statPath(target) {
  try {
    return await fsp.stat(target);
  } catch {
    return null;
  }
}

async function handleRequest(req, res) {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
    res.end("405 Method Not Allowed");
    return;
  }

  let requestUrl;
  try {
    requestUrl = new URL(req.url || "/", "http://localhost");
  } catch {
    sendError(res, 400, "Bad request", "This URL cannot be parsed.", req.url, method);
    return;
  }

  let pathname = requestUrl.pathname;
  if (pathname === "") pathname = "/";

  const resolved = resolveSafePath(pathname);
  if (resolved.error === "bad-request") {
    sendError(res, 400, "Bad request", "The URL contains invalid encoding.", pathname, method);
    return;
  }
  if (resolved.error === "forbidden") {
    sendError(res, 403, "Access denied", "Path traversal detected; this path is not accessible.", pathname, method);
    return;
  }

  let target = resolved.absolute;
  let info = await statPath(target);

  if (info && info.isDirectory()) {
    if (!pathname.endsWith("/")) {
      const location = pathname + "/" + (requestUrl.search || "");
      res.writeHead(301, { Location: location, "Cache-Control": "no-store" });
      res.end();
      return;
    }
    const indexPath = path.join(target, "index.html");
    const indexInfo = await statPath(indexPath);
    if (!indexInfo || !indexInfo.isFile()) {
      sendError(res, 404, "Not found", "This directory has no index.html.", pathname, method);
      return;
    }
    target = indexPath;
    info = indexInfo;
  }

  if (!info || !info.isFile()) {
    sendError(res, 404, "Not found", "No file corresponds to this path.", pathname, method);
    return;
  }

  const extension = path.extname(target).toLowerCase();
  const contentType = MIME[extension] || "application/octet-stream";
  const headers = {
    "Content-Type": contentType,
    "Content-Length": info.size,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };

  res.writeHead(200, headers);
  if (method === "HEAD") {
    res.end();
    return;
  }

  const stream = fs.createReadStream(target);
  stream.on("error", () => {
    if (!res.headersSent) {
      sendError(res, 500, "Read failed", "The server cannot read this file.", pathname, method);
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.unknown) {
    process.stderr.write("Unknown option: " + options.unknown + " (use --help for usage)\n");
    process.exitCode = 1;
    return;
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      process.stderr.write("[serve] unexpected error: " + (error && error.stack ? error.stack : error) + "\n");
      if (!res.headersSent) {
        sendError(res, 500, "Server error", "An unexpected error occurred while handling the request.", req.url, req.method);
      } else {
        res.destroy();
      }
    });
  });

  server.on("error", (error) => {
    if (error && error.code === "EADDRINUSE") {
      process.stderr.write("Port " + options.port + " is already in use; try another one: node tools/serve.mjs 8081\n");
    } else {
      process.stderr.write("Server failed to start: " + (error && error.message ? error.message : error) + "\n");
    }
    process.exitCode = 1;
  });

  server.listen(options.port, () => {
    const lines = [
      "",
      "  SQL tutorial site — static server",
      "  ─────────────────────────────────────────",
      "  root : " + ROOT,
      "  url  : http://localhost:" + options.port + "/docs/",
      "  play : http://localhost:" + options.port + "/docs/playground.html",
      "  stop : Ctrl + C",
      "  ─────────────────────────────────────────",
      ""
    ];
    process.stdout.write(lines.join("\n") + "\n");
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1200).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
