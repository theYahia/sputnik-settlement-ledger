import type { Obligation } from "./types.ts";
import { canonicalLedger } from "./canonical.ts";
import { sha256Hex } from "./sha256.ts";

/**
 * Hash of a period's ledger as it stood when the period was closed.
 *
 * This is the value stored on chain and the value `verify` recomputes from
 * the off-chain ledger. It covers disputed records too, so flipping a dispute
 * flag changes the hash rather than hiding an edit.
 */
export function ledgerHash(periodId: string, obligations: readonly Obligation[]): string {
  return `sha256:${sha256Hex(canonicalLedger(periodId, obligations))}`;
}
