import fc from "fast-check";
import type { Obligation } from "../../src/ledger/types.ts";

export const ACCOUNT_POOL: readonly string[] = [
  "alfa.ledger-dao.testnet",
  "bravo.ledger-dao.testnet",
  "charlie.ledger-dao.testnet",
  "delta.ledger-dao.testnet",
  "echo.ledger-dao.testnet",
  "foxtrot.ledger-dao.testnet",
  "golf.ledger-dao.testnet",
  "hotel.ledger-dao.testnet",
  "india.ledger-dao.testnet",
  "juliett.ledger-dao.testnet",
  "kilo.ledger-dao.testnet",
  "lima.ledger-dao.testnet",
  "mike.ledger-dao.testnet",
  "november.ledger-dao.testnet",
  "oscar.ledger-dao.testnet",
  "papa.ledger-dao.testnet",
  "quebec.ledger-dao.testnet",
  "romeo.ledger-dao.testnet",
  "sierra.ledger-dao.testnet",
  "tango.ledger-dao.testnet",
];

export interface LedgerSample {
  readonly accounts: readonly string[];
  readonly obligations: readonly Obligation[];
}

/**
 * Random ledgers over 2..20 named accounts, as the invariants are stated for
 * that range. Amounts stay well above 1 so that no transfer is degenerate,
 * and reach 10^21 so that bigint, not number, is exercised.
 */
export function ledgerArbitrary(): fc.Arbitrary<LedgerSample> {
  return fc
    .integer({ min: 2, max: ACCOUNT_POOL.length })
    .chain((participantCount) => {
      const accounts = ACCOUNT_POOL.slice(0, participantCount);
      const edge = fc.record({
        fromIndex: fc.integer({ min: 0, max: participantCount - 1 }),
        shift: fc.integer({ min: 1, max: participantCount - 1 }),
        amount: fc
          .bigInt({ min: 1n, max: 1_000_000_000_000_000_000_000n })
          .map((value) => value.toString(10)),
        disputed: fc.boolean(),
        memo: fc.string({ maxLength: 24 }),
      });
      return fc.record({
        accounts: fc.constant(accounts),
        edges: fc.array(edge, { minLength: 0, maxLength: 60 }),
      });
    })
    .map(({ accounts, edges }) => ({
      accounts,
      obligations: edges.map((e, index) => {
        const from = accounts[e.fromIndex % accounts.length] as string;
        const to = accounts[(e.fromIndex + e.shift) % accounts.length] as string;
        return {
          id: `ob-${index.toString().padStart(3, "0")}`,
          from,
          to,
          amount: BigInt(e.amount),
          memo: e.memo,
          disputed: e.disputed,
        } satisfies Obligation;
      }),
    }));
}

export function shuffleDeterministic<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed >>> 0 || 1;
  for (let i = copy.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    const a = copy[i] as T;
    const b = copy[j] as T;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}
