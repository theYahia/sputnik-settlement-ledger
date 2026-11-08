import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REGISTRY_VERSION,
  RegistryError,
  closePeriod,
  createPeriod,
  disputeObligation,
  emptyRegistry,
  getLedgerHash,
  markSettled,
  recordObligation,
  requireClosedForQuote,
  requirePeriod,
  toObligations,
  type RegistryState,
} from "../src/ledger/registry.ts";
import { quote } from "../src/settlement/quote.ts";
import { ledgerHash } from "../src/ledger/hash.ts";

const OWNER = "ledger-dao.testnet";
const ALFA = "alfa.ledger-dao.testnet";
const BRAVO = "bravo.ledger-dao.testnet";
const OUTSIDER = "mallory.testnet";
const PERIOD = "2026-Q4";

function seeded(): RegistryState {
  const state = emptyRegistry(OWNER);
  createPeriod(state, OWNER, PERIOD, [ALFA, BRAVO, OWNER]);
  recordObligation(state, ALFA, PERIOD, ALFA, BRAVO, "180000000000000000000", "ci minutes");
  recordObligation(state, BRAVO, PERIOD, BRAVO, ALFA, "140000000000000000000", "landing page");
  recordObligation(state, OWNER, PERIOD, OWNER, ALFA, "50000000000000000000", "retainer");
  return state;
}

function expectCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof RegistryError, `expected RegistryError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  };
}

test("only the owner creates a period", () => {
  const state = emptyRegistry(OWNER);
  assert.throws(
    () => createPeriod(state, OUTSIDER, PERIOD, [ALFA]),
    expectCode("NOT_OWNER"),
  );
  createPeriod(state, OWNER, PERIOD, [ALFA]);
  assert.throws(() => createPeriod(state, OWNER, PERIOD, [ALFA]), expectCode("PERIOD_EXISTS"));
});

test("only period members may record obligations", () => {
  const state = seeded();
  assert.throws(
    () => recordObligation(state, OUTSIDER, PERIOD, OUTSIDER, ALFA, "1", "spam"),
    expectCode("NOT_MEMBER"),
  );
  const obligation = recordObligation(state, ALFA, PERIOD, ALFA, BRAVO, "7", "extra");
  assert.equal(obligation.id, "ob-4");
});

test("invalid amounts and self-obligations are rejected", () => {
  const state = seeded();
  assert.throws(
    () => recordObligation(state, ALFA, PERIOD, ALFA, BRAVO, "0", ""),
    expectCode("INVALID_ARGUMENT"),
  );
  assert.throws(
    () => recordObligation(state, ALFA, PERIOD, ALFA, BRAVO, "-5", ""),
    expectCode("INVALID_ARGUMENT"),
  );
  assert.throws(
    () => recordObligation(state, ALFA, PERIOD, ALFA, BRAVO, "1.5", ""),
    expectCode("INVALID_ARGUMENT"),
  );
  assert.throws(
    () => recordObligation(state, ALFA, PERIOD, ALFA, ALFA, "5", ""),
    expectCode("INVALID_ARGUMENT"),
  );
});

test("quoting an open period is refused", () => {
  const state = seeded();
  assert.throws(
    () => requireClosedForQuote(requirePeriod(state, PERIOD)),
    expectCode("PERIOD_NOT_CLOSED"),
  );
});

test("close freezes the ledger hash and blocks further edits", () => {
  const state = seeded();
  const period = closePeriod(state, OWNER, PERIOD);
  assert.equal(period.status, "quoted");
  assert.equal(period.ledgerHash, ledgerHash(PERIOD, toObligations(period)));
  assert.equal(getLedgerHash(state, PERIOD), period.ledgerHash);

  assert.throws(
    () => recordObligation(state, ALFA, PERIOD, ALFA, BRAVO, "10", "late"),
    expectCode("PERIOD_NOT_OPEN"),
  );
  assert.throws(
    () => disputeObligation(state, ALFA, PERIOD, "ob-1", true),
    expectCode("PERIOD_NOT_OPEN"),
  );
});

test("only the owner closes a period", () => {
  const state = seeded();
  assert.throws(() => closePeriod(state, ALFA, PERIOD), expectCode("NOT_OWNER"));
});

test("disputes are recorded on open periods and excluded from the quote", () => {
  const state = seeded();
  const before = quote(PERIOD, toObligations(requirePeriod(state, PERIOD)));
  disputeObligation(state, ALFA, PERIOD, "ob-1", true);
  const period = closePeriod(state, OWNER, PERIOD);
  const after = quote(PERIOD, toObligations(period));

  assert.deepEqual(after.excludedDisputed, ["ob-1"]);
  assert.ok(after.gross < before.gross);
  assert.equal(after.gross, before.gross - 180000000000000000000n);
});

test("a dispute cannot be raised by a non-member", () => {
  const state = seeded();
  assert.throws(
    () => disputeObligation(state, OUTSIDER, PERIOD, "ob-1", true),
    expectCode("NOT_MEMBER"),
  );
  assert.throws(
    () => disputeObligation(state, OWNER, PERIOD, "ob-404", true),
    expectCode("OBLIGATION_NOT_FOUND"),
  );
});

test("quote from the registry equals the offline quote, bit for bit", () => {
  const state = seeded();
  disputeObligation(state, BRAVO, PERIOD, "ob-2", true);
  const period = closePeriod(state, OWNER, PERIOD);
  const obligations = toObligations(period);

  const fromRegistry = canonical(quote(PERIOD, obligations));
  const offline = canonical(quote(PERIOD, obligations));
  assert.equal(fromRegistry, offline);

  // Same check through the JSON boundary the contract uses: bigints become
  // decimal strings, everything else must survive the round trip unchanged.
  const wire = JSON.parse(
    JSON.stringify(quote(PERIOD, obligations), (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString(10) : value,
    ),
  ) as unknown;
  assert.deepEqual(wire, JSON.parse(JSON.stringify(quote(PERIOD, obligations), (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString(10) : value,
  )));
});

test("state survives a JSON round trip, which is how the contract persists it", () => {
  const state = seeded();
  closePeriod(state, OWNER, PERIOD);
  const restored = JSON.parse(JSON.stringify(state)) as RegistryState;
  assert.equal(restored.version, REGISTRY_VERSION);
  assert.equal(
    canonical(quote(PERIOD, toObligations(requirePeriod(restored, PERIOD)))),
    canonical(quote(PERIOD, toObligations(requirePeriod(state, PERIOD)))),
  );
  assert.equal(getLedgerHash(restored, PERIOD), getLedgerHash(state, PERIOD));
});

test("settlement is recorded once, with the executing transaction", () => {
  const state = seeded();
  assert.throws(
    () => markSettled(state, OWNER, PERIOD, "7", "abc123"),
    expectCode("PERIOD_NOT_CLOSED"),
  );
  closePeriod(state, OWNER, PERIOD);
  assert.throws(() => markSettled(state, ALFA, PERIOD, "7", "abc123"), expectCode("NOT_OWNER"));

  const settled = markSettled(state, OWNER, PERIOD, "7", "abc123");
  assert.equal(settled.status, "settled");
  assert.deepEqual(settled.settlement, { proposalId: "7", txHash: "abc123" });
  assert.throws(() => markSettled(state, OWNER, PERIOD, "8", "def"), expectCode("ALREADY_SETTLED"));
  assert.equal(getLedgerHash(state, PERIOD), settled.ledgerHash);
});

test("account id validation rejects malformed names", () => {
  const state = emptyRegistry(OWNER);
  assert.throws(
    () => createPeriod(state, OWNER, PERIOD, ["Bad_Account"]),
    expectCode("INVALID_ARGUMENT"),
  );
  assert.throws(() => emptyRegistry("a"), expectCode("INVALID_ARGUMENT"));
});

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === "bigint" ? inner.toString(10) : inner,
  );
}
