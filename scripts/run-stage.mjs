#!/usr/bin/env node
// Runs every `near ...` line of one "# --- <stage>" block of a generated commands file,
// in order, and stops at the first failure. Each command is printed before it runs.
// Usage: node scripts/run-stage.mjs <commands-file> <stage>
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function tokenize(line) {
  const tokens = [];
  let current = "";
  let quote = false;
  let started = false;
  for (const ch of line) {
    if (ch === "'") {
      quote = !quote;
      started = true;
    } else if (ch === " " && !quote) {
      if (started) tokens.push(current);
      current = "";
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (started) tokens.push(current);
  return tokens;
}

const [file, stage] = process.argv.slice(2);
if (file === undefined || stage === undefined) {
  process.stderr.write("usage: node scripts/run-stage.mjs <commands-file> <stage>\n");
  process.exit(2);
}

function readText(path) {
  const buf = readFileSync(path);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  return buf.toString("utf8");
}

const lines = readText(file).split(/\r?\n/);
let active = false;
let count = 0;
for (const line of lines) {
  const header = /^# --- (.+)$/.exec(line);
  if (header !== null) {
    active = header[1].trim() === stage;
    continue;
  }
  if (!active || !line.startsWith("near ")) continue;
  count += 1;
  process.stdout.write(`\n>>> [${count}] ${line}\n`);
  const [, ...args] = tokenize(line);
  const result = spawnSync("near", args, { stdio: "inherit", shell: false });
  if (result.error !== undefined) {
    process.stderr.write(`could not start near: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`FAILED (exit ${result.status}): stopping\n`);
    process.exit(1);
  }
}
if (count === 0) {
  process.stderr.write(`no commands found for stage '${stage}'\n`);
  process.exit(2);
}
process.stdout.write(`\nstage '${stage}' done: ${count} command(s)\n`);
