import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseFixture } from "../src/ledger/parse.ts";
import { quote } from "../src/settlement/quote.ts";
import { ledgerHash } from "../src/ledger/hash.ts";
import { buildProposal, serializeProposal, type ProposalEnvelope } from "../src/proposal/build.ts";

const OPTIONS = {
  daoAccount: "ledger-dao.testnet",
  tokenId: "ledger-token.testnet",
  proposer: "ops.ledger-dao.testnet",
} as const;

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

function build(): { envelope: ProposalEnvelope; serialized: string; hash: string } {
  const fixture = parseFixture(read("workgroups.json"));
  const result = quote(fixture.periodId, fixture.obligations);
  const hash = ledgerHash(fixture.periodId, fixture.obligations);
  const envelope = buildProposal(fixture.periodId, hash, result, OPTIONS);
  return { envelope, serialized: serializeProposal(envelope), hash };
}

test("golden: fixture compiles to the exact expected proposal, byte for byte", () => {
  const { serialized } = build();
  const golden = read("golden-proposal.json").replace(/\r\n/g, "\n").trimEnd();
  assert.equal(serialized, golden);
});

test("golden: every action is one ft_transfer with the period in the memo", () => {
  const { envelope } = build();
  const fixture = parseFixture(read("workgroups.json"));
  const result = quote(fixture.periodId, fixture.obligations);

  const kind = envelope.proposal.kind.FunctionCall;
  assert.equal(kind.receiver_id, "ledger-token.testnet");
  assert.equal(kind.actions.length, result.transferCount);

  const decoded = kind.actions.map((action) => {
    assert.equal(action.method_name, "ft_transfer");
    assert.equal(action.deposit, "1");
    const args: unknown = JSON.parse(Buffer.from(action.args, "base64").toString("utf8"));
    assert.ok(typeof args === "object" && args !== null);
    const record = args as Record<string, unknown>;
    assert.equal(record.memo, "2026-Q4-workgroups");
    return {
      receiver: String(record.receiver_id),
      amount: BigInt(String(record.amount)),
    };
  });

  const expected = [...result.transfers]
    .sort((a, b) => (a.from === b.from ? (a.to < b.to ? -1 : 1) : a.from < b.from ? -1 : 1))
    .map((transfer) => ({ receiver: transfer.to, amount: transfer.amount }));
  assert.deepEqual(decoded, expected);

  const moved = decoded.reduce((acc, item) => acc + item.amount, 0n);
  assert.equal(moved, result.movedNet);
});

test("golden: the description carries the ledger hash that verify recomputes", () => {
  const { envelope, hash } = build();
  assert.ok(envelope.proposal.description.includes(hash));
  assert.ok(envelope.proposal.description.includes("payouts 17 -> 4"));
});

test("building twice produces identical bytes", () => {
  assert.equal(build().serialized, build().serialized);
});

test("star fixture compiles to a plain bulk payout, one action per payee", () => {
  const fixture = parseFixture(read("star.json"));
  const result = quote(fixture.periodId, fixture.obligations);
  const hash = ledgerHash(fixture.periodId, fixture.obligations);
  const envelope = buildProposal(fixture.periodId, hash, result, OPTIONS);
  assert.equal(envelope.proposal.kind.FunctionCall.actions.length, 4);
  assert.ok(envelope.proposal.description.includes("mutuality 0.0000"));
});
