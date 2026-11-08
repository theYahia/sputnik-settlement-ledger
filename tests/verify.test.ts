import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseFixture } from "../src/ledger/parse.ts";
import { quote } from "../src/settlement/quote.ts";
import { ledgerHash } from "../src/ledger/hash.ts";
import { verifyLedger } from "../src/verify/verify.ts";
import type { Obligation } from "../src/ledger/types.ts";

function fixture(name: string): ReturnType<typeof parseFixture> {
  return parseFixture(
    readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8"),
  );
}

test("verify passes against the hash frozen at close", () => {
  const { periodId, obligations } = fixture("workgroups.json");
  const hash = ledgerHash(periodId, obligations);
  const result = verifyLedger({ periodId, obligations, expectedHash: hash });
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
  assert.equal(result.recomputedHash, hash);
});

test("verify fails when a single record is substituted in the ledger", () => {
  const { periodId, obligations } = fixture("workgroups.json");
  const hash = ledgerHash(periodId, obligations);
  const tampered: Obligation[] = obligations.map((o, index) =>
    index === 0 ? { ...o, amount: o.amount + 1n } : o,
  );
  const result = verifyLedger({ periodId, obligations: tampered, expectedHash: hash });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /ledger hash mismatch/);
});

test("verify fails when a dispute flag is flipped after close", () => {
  const { periodId, obligations } = fixture("workgroups.json");
  const hash = ledgerHash(periodId, obligations);
  const tampered: Obligation[] = obligations.map((o) =>
    o.id === "ob-18" ? { ...o, disputed: false } : o,
  );
  const result = verifyLedger({ periodId, obligations: tampered, expectedHash: hash });
  assert.equal(result.ok, false);
});

test("verify fails when the on-chain quote disagrees with the offline quote", () => {
  const { periodId, obligations } = fixture("workgroups.json");
  const hash = ledgerHash(periodId, obligations);
  const localQuote = quote(periodId, obligations);
  const moved: typeof localQuote = {
    ...localQuote,
    transfers: localQuote.transfers.slice(0, -1),
    transferCount: localQuote.transferCount - 1,
  };
  const result = verifyLedger({
    periodId,
    obligations,
    expectedHash: hash,
    onChainQuote: moved,
  });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /on-chain quote differs/);
});

test("verify accepts a hash without the sha256 prefix", () => {
  const { periodId, obligations } = fixture("workgroups.json");
  const hash = ledgerHash(periodId, obligations).replace("sha256:", "");
  const result = verifyLedger({ periodId, obligations, expectedHash: hash });
  assert.equal(result.ok, true);
  assert.equal(result.expectedHash, `sha256:${hash}`);
});
