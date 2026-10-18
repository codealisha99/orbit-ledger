#!/usr/bin/env bun


export {};

import { join, dirname } from "path";
import { fileURLToPath } from "url";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: bun watch-quiet.ts <file-to-watch>");
  process.exit(1);
}

const fileToWatch = args[0];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const monorepoRoot = join(__dirname, "..");

const proc = Bun.spawn(
  [
    "bun",
    "--watch",
    fileToWatch,
    "--watch-path",
    join(monorepoRoot, "packages", "shared"),
    "--watch-path",
    join(monorepoRoot, "packages", "database"),
  ],
  {
    stdout: "inherit",
    stderr: "pipe", // Pipe stderr to filter warnings
    stdin: "inherit",
    cwd: process.cwd(),
  }
);

if (proc.stderr) {
  const decoder = new TextDecoder();
  (async () => {
    for await (const chunk of proc.stderr) {
      const text = decoder.decode(chunk);
      if (!text.includes("is not in the project directory and will not be watched")) {
        process.stderr.write(chunk);
      }
    }
  })();
}

process.on("SIGINT", () => {
  proc.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  proc.kill();
  process.exit(0);
});

await proc.exited;
process.exit(proc.exitCode ?? 0);
