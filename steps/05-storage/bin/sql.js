#!/usr/bin/env node
/**
 * The sql-from-scratch command-line interface (CLI).
 *
 * Chapter 1: build a REPL skeleton that reads input and answers built-in commands.
 * Later chapters plug in the tokenizer, parser, and execution engine step by step.
 */
import { createInterface } from "node:readline/promises";
import { describeTokens } from "../src/tokenizer.js";
import { parseScript } from "../src/parser.js";
import { SqlError } from "../src/errors.js";
import process from "node:process";

const VERSION = "0.1.0";

const HELP = [
  "Built-in commands:",
  "  .help            show this help",
  "  .tokens <SQL>    split SQL into tokens (debugging)",
  "  .ast <SQL>       show the syntax tree (debugging)",
  "  .exit / .quit    quit",
  "",
  "This version has no SQL engine yet; entering SQL shows 'not implemented'."
].join("\n");

function printBanner() {
  console.log(`sql-from-scratch v${VERSION} — an SQL database built from scratch in JavaScript`);
  console.log('Type .help for commands, .exit to quit.');
}

function printResult(result) {
  console.log(result);
}

async function main() {
  printBanner();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // On Ctrl+C, cancel the current input instead of blowing up the whole process.
  rl.on("SIGINT", () => {
    console.log("");
    rl.close();
  });

  try {
    while (true) {
      let line;
      try {
        line = await rl.question("sql> ");
      } catch {
        break; // Ctrl+D / end of stream
      }
      const input = line.trim();
      if (input === "") continue;
      if (input === ".exit" || input === ".quit") break;
      if (input === ".help") {
        printResult(HELP);
        continue;
      }
      if (input.startsWith(".ast")) {
        const sql = input.slice(".ast".length).trim();
        try {
          printResult(JSON.stringify(parseScript(sql), null, 2));
        } catch (err) {
          console.error(err instanceof SqlError ? err.format(sql) : String(err));
        }
        continue;
      }
      if (input.startsWith(".tokens")) {
        const sql = input.slice(".tokens".length).trim();
        try {
          printResult(describeTokens(sql));
        } catch (err) {
          console.error(err instanceof SqlError ? err.format(sql) : String(err));
        }
        continue;
      }
      if (input.startsWith(".")) {
        console.error(`Unknown command: ${input.split(/\s+/)[0]} (try .help)`);
        continue;
      }
      console.error("Not implemented yet: the SQL engine arrives in a later chapter.");
    }
  } finally {
    rl.close();
    console.log("Goodbye!");
  }
}

main();
