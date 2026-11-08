import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { sha256Hex } from "../src/ledger/sha256.ts";
import { canonicalLedger } from "../src/ledger/canonical.ts";
import { ledgerHash } from "../src/ledger/hash.ts";
import { parseFixture } from "../src/ledger/parse.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function reference(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

test("sha256 matches node:crypto on known vectors", () => {
  const vectors = [
    "",
    "abc",
    "The quick brown fox jumps over the lazy dog",
    "a".repeat(55),
    "a".repeat(56),
    "a".repeat(63),
    "a".repeat(64),
    "a".repeat(65),
    "a".repeat(1000),
    "Привет, ledger — юникод \u0001\u001f",
  ];
  for (const vector of vectors) {
    assert.equal(sha256Hex(vector), reference(vector), `mismatch for length ${vector.length}`);
  }
});

test("hashing a fixture ledger matches the reference hash of its canonical form", () => {
  const json = readFileSync(
    fileURLToPath(new URL("../fixtures/workgroups.json", import.meta.url)),
    "utf8",
  );
  const { periodId, obligations } = parseFixture(json);
  const canonical = canonicalLedger(periodId, obligations);
  assert.equal(ledgerHash(periodId, obligations), `sha256:${reference(canonical)}`);
});

test("canonical form is insensitive to input order", () => {
  const { periodId, obligations } = parseFixture(
    readFileSync(fileURLToPath(new URL("../fixtures/workgroups.json", import.meta.url)), "utf8"),
  );
  const reversed = [...obligations].reverse();
  assert.equal(canonicalLedger(periodId, obligations), canonicalLedger(periodId, reversed));
});

test("canonical form changes when a record changes", () => {
  const { periodId, obligations } = parseFixture(
    readFileSync(fileURLToPath(new URL("../fixtures/workgroups.json", import.meta.url)), "utf8"),
  );
  const tampered = obligations.map((o, index) =>
    index === 0 ? { ...o, amount: o.amount + 1n } : o,
  );
  assert.notEqual(ledgerHash(periodId, obligations), ledgerHash(periodId, tampered));
});
