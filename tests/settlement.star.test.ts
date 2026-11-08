import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseFixture } from "../src/ledger/parse.ts";
import { quote } from "../src/settlement/quote.ts";
import { NO_BENEFIT_ADVICE } from "../src/ledger/types.ts";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

test("star ledger: netting changes nothing on either axis, and says so", () => {
  const { periodId, obligations } = parseFixture(fixture("star.json"));
  const result = quote(periodId, obligations);

  assert.equal(result.mutuality, "0.0000");
  assert.equal(result.baselineTransferCount, 4);
  assert.equal(result.transferCount, 4);
  assert.equal(result.gross, result.movedNet);
  assert.equal(result.advice, NO_BENEFIT_ADVICE);
});

test("mutual working-group ledger: both axes improve, disputed record excluded", () => {
  const { periodId, obligations } = parseFixture(fixture("workgroups.json"));
  const result = quote(periodId, obligations);

  assert.equal(result.advice, null);
  assert.ok(
    result.transferCount < result.baselineTransferCount,
    `${result.transferCount} !< ${result.baselineTransferCount}`,
  );
  assert.ok(result.movedNet < result.gross, `${result.movedNet} !< ${result.gross}`);
  assert.ok(result.transferCount <= result.participants - 1);
  assert.deepEqual(result.excludedDisputed, ["ob-18"]);
});

test("empty ledger settles to nothing without claiming a benefit", () => {
  const result = quote("empty", []);
  assert.equal(result.transferCount, 0);
  assert.equal(result.gross, 0n);
  assert.equal(result.mutuality, "0.0000");
  assert.equal(result.advice, null);
});
