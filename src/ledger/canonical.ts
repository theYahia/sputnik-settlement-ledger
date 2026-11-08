import type { Obligation, ObligationId } from "./types.ts";

/**
 * Canonical serialization of a period's ledger.
 *
 * The hash in `close_period` and the hash recomputed by `verify` must agree
 * byte for byte, on chain and off chain. That is only true if the byte string
 * is produced by exactly one function, so this is it. Any change here is a
 * breaking change to every previously closed period.
 *
 * Format: one line per obligation, fields separated by \x1f, lines by \n,
 * records sorted by id. Disputed records are included with their flag: a
 * dispute must not silently rewrite history, it only changes the settlement.
 */
export function canonicalLedger(periodId: string, obligations: readonly Obligation[]): string {
  const sorted = [...obligations].sort((a, b) => compareIds(a.id, b.id));
  const lines = [`period\x1f${periodId}`];
  for (const o of sorted) {
    lines.push(
      [o.id, o.from, o.to, o.amount.toString(10), o.disputed ? "1" : "0", escapeMemo(o.memo)].join(
        "\x1f",
      ),
    );
  }
  return lines.join("\n");
}

function compareIds(a: ObligationId, b: ObligationId): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function escapeMemo(memo: string): string {
  return memo.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\x1f", "\\u001f");
}
