import type { Obligation, Quote } from "../ledger/types.ts";
import { ledgerHash } from "../ledger/hash.ts";
import { quote } from "../settlement/quote.ts";

/**
 * Re-derives the ledger hash from the records and compares it with the hash
 * the contract froze at `close_period`. Any single substituted record changes
 * the canonical byte string and therefore the hash, which is exactly the
 * property the report claims.
 */

export interface VerifyInput {
  readonly periodId: string;
  readonly obligations: readonly Obligation[];
  /** Hash taken from the contract (or from the closed local mirror). */
  readonly expectedHash: string;
  /** Quote returned by the contract view, when verifying against a live chain. */
  readonly onChainQuote?: Quote;
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly expectedHash: string;
  readonly recomputedHash: string;
  readonly quote: Quote;
  readonly problems: readonly string[];
}

export function verifyLedger(input: VerifyInput): VerifyResult {
  const recomputedHash = ledgerHash(input.periodId, input.obligations);
  const expectedHash = normalizeHash(input.expectedHash);
  const problems: string[] = [];

  if (recomputedHash !== expectedHash) {
    problems.push(
      `ledger hash mismatch: contract has ${expectedHash}, recomputed ${recomputedHash}`,
    );
  }

  const offlineQuote = quote(input.periodId, input.obligations);
  if (input.onChainQuote !== undefined) {
    problems.push(...compareQuotes(input.onChainQuote, offlineQuote));
  }

  return {
    ok: problems.length === 0,
    expectedHash,
    recomputedHash,
    quote: offlineQuote,
    problems,
  };
}

/** Accepts a hash with or without the `sha256:` prefix; always returns prefixed. */
export function normalizeHash(hash: string): string {
  const trimmed = hash.trim();
  return trimmed.startsWith("sha256:") ? trimmed : `sha256:${trimmed}`;
}

/**
 * The contract returns the same quote through JSON, where amounts are
 * decimal strings. Compare the settlement-relevant fields exactly; the
 * advice text is derived and included so a wording drift is caught too.
 */
export function compareQuotes(remote: Quote, local: Quote): string[] {
  const problems: string[] = [];
  const remoteCanonical = canonicalQuote(remote);
  const localCanonical = canonicalQuote(local);
  if (remoteCanonical !== localCanonical) {
    problems.push(`on-chain quote differs from offline quote:\n  chain: ${remoteCanonical}\n  local: ${localCanonical}`);
  }
  return problems;
}

function canonicalQuote(value: Quote): string {
  return JSON.stringify({
    periodId: value.periodId,
    participants: value.participants,
    netPositions: value.netPositions.map((p) => [p.account, p.net.toString(10)]),
    transfers: value.transfers.map((t) => [t.from, t.to, t.amount.toString(10)]),
    baselineTransferCount: value.baselineTransferCount,
    transferCount: value.transferCount,
    gross: value.gross.toString(10),
    movedNet: value.movedNet.toString(10),
    mutuality: value.mutuality,
    advice: value.advice,
    excludedDisputed: [...value.excludedDisputed],
  });
}
