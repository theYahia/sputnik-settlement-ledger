import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { netPositions } from "../src/settlement/net-positions.ts";
import { reduceSettlement } from "../src/settlement/reduce.ts";
import { quote } from "../src/settlement/quote.ts";
import { ledgerArbitrary, shuffleDeterministic } from "./helpers/obligations.ts";

const RUNS = { numRuns: 400 } as const;

test("invariant 1: net positions sum to zero", () => {
  fc.assert(
    fc.property(ledgerArbitrary(), ({ obligations }) => {
      const positions = netPositions(obligations);
      const total = positions.reduce((acc, p) => acc + p.net, 0n);
      assert.equal(total, 0n);
    }),
    RUNS,
  );
});

test("invariant 2: sum of positive nets equals total moved", () => {
  fc.assert(
    fc.property(ledgerArbitrary(), ({ obligations }) => {
      const positions = netPositions(obligations);
      const expected = positions.reduce((acc, p) => (p.net > 0n ? acc + p.net : acc), 0n);
      const moved = reduceSettlement(positions).reduce((acc, t) => acc + t.amount, 0n);
      assert.equal(moved, expected);
    }),
    RUNS,
  );
});

test("invariant 3: transfers <= n-1 for n non-zero positions", () => {
  fc.assert(
    fc.property(ledgerArbitrary(), ({ obligations }) => {
      const positions = netPositions(obligations);
      const transfers = reduceSettlement(positions);
      if (positions.length === 0) {
        assert.equal(transfers.length, 0);
        return;
      }
      assert.ok(
        transfers.length <= positions.length - 1,
        `${transfers.length} transfers for ${positions.length} positions`,
      );
    }),
    RUNS,
  );
});

test("invariant 4: nobody pays more than their own debit", () => {
  fc.assert(
    fc.property(ledgerArbitrary(), ({ obligations }) => {
      const positions = netPositions(obligations);
      const debit = new Map<string, bigint>();
      for (const p of positions) if (p.net < 0n) debit.set(p.account, -p.net);

      const paid = new Map<string, bigint>();
      for (const t of reduceSettlement(positions)) {
        paid.set(t.from, (paid.get(t.from) ?? 0n) + t.amount);
      }
      for (const [account, amount] of paid) {
        assert.equal(amount <= (debit.get(account) ?? 0n), true, `${account} overpaid`);
      }
    }),
    RUNS,
  );
});

test("invariant 5: no non-positive transfer amounts, no self-transfers", () => {
  fc.assert(
    fc.property(ledgerArbitrary(), ({ obligations }) => {
      for (const t of reduceSettlement(netPositions(obligations))) {
        assert.ok(t.amount > 0n, "transfer amount must be positive");
        assert.notEqual(t.from, t.to);
      }
    }),
    RUNS,
  );
});

test("invariant 6: result is invariant under permutation of the input", () => {
  fc.assert(
    fc.property(ledgerArbitrary(), fc.integer({ min: 1, max: 2 ** 30 }), ({ obligations }, seed) => {
      const a = quote("p", obligations);
      const b = quote("p", shuffleDeterministic(obligations, seed));
      assert.deepEqual(serialize(a.transfers), serialize(b.transfers));
      assert.equal(a.mutuality, b.mutuality);
      assert.equal(a.movedNet, b.movedNet);
      assert.equal(a.gross, b.gross);
    }),
    RUNS,
  );
});

test("invariant 7: disputed obligations never move money", () => {
  fc.assert(
    fc.property(ledgerArbitrary(), ({ obligations }) => {
      const withoutDisputed = obligations.filter((o) => !o.disputed);
      const full = quote("p", obligations);
      const filtered = quote("p", withoutDisputed);
      assert.deepEqual(serialize(full.transfers), serialize(filtered.transfers));
      assert.equal(full.gross, filtered.gross);
    }),
    RUNS,
  );
});

function serialize(transfers: readonly { from: string; to: string; amount: bigint }[]): string[] {
  return transfers.map((t) => `${t.from}->${t.to}:${t.amount}`);
}
