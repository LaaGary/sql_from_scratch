#!/usr/bin/env node
/**
 * The sql-from-scratch command-line interface (CLI).
 *
 * Chapter 1: build a REPL skeleton that reads input and answers built-in commands.
 * Later chapters plug in the tokenizer, parser, and execution engine step by step.
 */
import { createInterface } from "node:readline/promises";
import process from "node:process";

const VERSION = "1.0.0";

const HELP = [
  "Built-in commands:",
  "  .help            show this help",
  "  .exit / .quit    quit",
  "",
  "This version has no SQL engine yet; entering SQL shows 'not implemented'."
].join("\n");

function printBanner() {
  console.log(`sql-from-scratch v${VERSION} — an SQL database built from scratch in JavaScript`);
  console.log("Type .help for commands, .exit to quit.");
}

async function main() {
  printBanner();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
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
        break;
      }
      const input = line.trim();
      if (input === "") continue;
      if (input === ".exit" || input === ".quit") break;
      if (input === ".help") {
        console.log(HELP);
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
