import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(args: readonly string[]): Run {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const OWNER = "ledger-dao.testnet";
const ALFA = "alfa.ledger-dao.testnet";
const BRAVO = "bravo.ledger-dao.testnet";

test("offline mirror: record, dispute, close, quote, settle", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ssl-cli-"));
  const store = path.join(dir, "state.json");
  const base = ["--store", store];

  assert.equal(run(["init", ...base, "--owner", OWNER]).status, 0);
  assert.equal(
    run(["create-period", ...base, "--period", "2026-Q4", "--members", `${OWNER},${ALFA},${BRAVO}`]).status,
    0,
  );

  const record = run([
    "record",
    ...base,
    "--period",
    "2026-Q4",
    "--from",
    ALFA,
    "--to",
    BRAVO,
    "--amount",
    "180000000000000000000",
    "--memo",
    "ci minutes",
  ]);
  assert.equal(record.status, 0);
  assert.match(record.stdout, /recorded ob-1/);
  assert.match(record.stdout, /on chain: near contract call-function/);

  const outsider = run([
    "record",
    ...base,
    "--period",
    "2026-Q4",
    "--from",
    "mallory.testnet",
    "--to",
    ALFA,
    "--amount",
    "1",
    "--actor",
    "mallory.testnet",
  ]);
  assert.equal(outsider.status, 1);
  assert.match(outsider.stderr, /NOT_MEMBER/);

  assert.equal(
    run(["record", ...base, "--period", "2026-Q4", "--from", BRAVO, "--to", ALFA, "--amount", "140000000000000000000"]).status,
    0,
  );
  assert.equal(run(["dispute", ...base, "--period", "2026-Q4", "--obligation", "ob-2"]).status, 0);

  const quoteBeforeClose = run(["quote", ...base, "--period", "2026-Q4"]);
  assert.equal(quoteBeforeClose.status, 2, "quoting an open period is refused");

  const close = run(["close", ...base, "--period", "2026-Q4"]);
  assert.equal(close.status, 0);
  assert.match(close.stdout, /ledger hash sha256:[0-9a-f]{64}/);

  const quoteClosed = run(["quote", ...base, "--period", "2026-Q4", "--json"]);
  assert.equal(quoteClosed.status, 0);
  const priced = JSON.parse(quoteClosed.stdout) as { transferCount: number; excludedDisputed: string[] };
  assert.equal(priced.transferCount, 1);
  assert.deepEqual(priced.excludedDisputed, ["ob-2"]);

  assert.equal(run(["settle", ...base, "--period", "2026-Q4", "--proposal", "7", "--tx", "abc123"]).status, 0);
  const settledState = JSON.parse(readFileSync(store, "utf8")) as {
    periods: Record<string, { status: string }>;
  };
  assert.equal(settledState.periods["2026-Q4"]?.status, "settled");
});

test("report writes html, markdown and csv", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ssl-report-"));
  const result = run([
    "report",
    "--fixture",
    path.join(FIXTURES, "workgroups.json"),
    "--out-dir",
    dir,
  ]);
  assert.equal(result.status, 0);
  for (const file of ["report.html", "report.md", "payouts.csv"]) {
    assert.ok(existsSync(path.join(dir, file)), `${file} exists`);
  }
  const csv = readFileSync(path.join(dir, "payouts.csv"), "utf8");
  assert.equal(csv.trimEnd().split("\n").length, 5, "header + 4 payouts");
});

test("verify exits 0 for the right hash and 1 for a wrong one", () => {
  const fixture = path.join(FIXTURES, "star.json");
  const hash = "sha256:2d7ba6015f73892db5ae5428be40348339184d83e81d374e3addda17ae9de537";

  const ok = run(["verify", "--fixture", fixture, "--expected", hash]);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^OK/u);

  const bad = run(["verify", "--fixture", fixture, "--expected", `${hash.slice(0, -1)}0`]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^FAIL/u);
});

test("unknown command exits with a usage error", () => {
  const result = run(["frobnicate"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown command/);
});
