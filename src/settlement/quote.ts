import type { Obligation, ObligationId, Quote } from "../ledger/types.ts";
import { NO_BENEFIT_ADVICE } from "../ledger/types.ts";
import { grossVolume, netPositions } from "./net-positions.ts";
import { reduceSettlement } from "./reduce.ts";

/**
 * The single entry point used by the CLI, the report and the contract view.
 *
 * It deliberately reports two axes at once. Counting only transfers hides the
 * case where the number drops but the same money still moves; counting only
 * volume hides the case where volume is unchanged but far fewer payouts are
 * needed. A star-shaped ledger (treasury pays k groups) scores zero on both,
 * and the quote says so instead of pretending otherwise.
 */
export function quote(periodId: string, obligations: readonly Obligation[]): Quote {
  const active = obligations.filter((o) => !o.disputed);
  const excludedDisputed: ObligationId[] = obligations
    .filter((o) => o.disputed)
    .map((o) => o.id)
    .sort();

  const positions = netPositions(active);
  const transfers = reduceSettlement(positions);

  const gross = grossVolume(active);
  const movedNet = transfers.reduce((acc, t) => acc + t.amount, 0n);
  const baselineTransferCount = countBaselinePairs(active);
  const mutuality = ratio(gross - movedNet, gross);

  return {
    periodId,
    participants: positions.length,
    netPositions: positions,
    transfers,
    baselineTransferCount,
    transferCount: transfers.length,
    gross,
    movedNet,
    mutuality,
    advice: gross > 0n && movedNet >= gross ? NO_BENEFIT_ADVICE : null,
    excludedDisputed,
  };
}

/**
 * Baseline = paying every distinct (from, to) pair separately, which is what
 * a treasury does today with a spreadsheet. Several obligations between the
 * same pair would in practice be paid as one line, so they count once.
 */
function countBaselinePairs(obligations: readonly Obligation[]): number {
  const pairs = new Set<string>();
  for (const o of obligations) pairs.add(`${o.from}\x1f${o.to}`);
  return pairs.size;
}

/** `numerator / denominator` as a 4-decimal string, computed in integers. */
function ratio(numerator: bigint, denominator: bigint): string {
  if (denominator === 0n) return "0.0000";
  const scaled = (numerator * 10000n) / denominator;
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / 10000n;
  const frac = (abs % 10000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}
