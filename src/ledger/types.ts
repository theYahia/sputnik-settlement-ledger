/**
 * Core domain types.
 *
 * Amounts are always integers in the token's minimal units (yocto-style),
 * carried as `bigint`. No floating point anywhere in the settlement path:
 * a rounding error here is an unexplainable payout on chain.
 */

export type AccountId = string;

export type ObligationId = string;

export interface Obligation {
  readonly id: ObligationId;
  /** Account that owes. */
  readonly from: AccountId;
  /** Account that is owed. */
  readonly to: AccountId;
  /** Strictly positive, in minimal token units. */
  readonly amount: bigint;
  readonly memo: string;
  /** Disputed records are excluded from settlement of the period. */
  readonly disputed: boolean;
}

export type PeriodStatus = "open" | "quoted" | "settled";

export interface Period {
  readonly id: string;
  readonly status: PeriodStatus;
  readonly obligations: readonly Obligation[];
  /** Set when the period is closed; hash of the canonical ledger. */
  readonly ledgerHash: string | null;
}

export interface NetPosition {
  readonly account: AccountId;
  /** Negative: owes. Positive: is owed. Never zero in a returned list. */
  readonly net: bigint;
}

export interface Transfer {
  readonly from: AccountId;
  readonly to: AccountId;
  readonly amount: bigint;
}

/**
 * Both axes of the result, reported together on purpose.
 *
 * `transfers` compares the baseline payout count with the computed one;
 * `volume` compares gross obligation volume with the value actually moved.
 * `mutuality` is 0 for a star-shaped ledger (one payer, many payees), where
 * netting changes nothing at all.
 */
export interface Quote {
  readonly periodId: string;
  readonly participants: number;
  readonly netPositions: readonly NetPosition[];
  readonly transfers: readonly Transfer[];
  readonly baselineTransferCount: number;
  readonly transferCount: number;
  readonly gross: bigint;
  readonly movedNet: bigint;
  /** 1 - movedNet/gross, rounded to 4 decimals, as a decimal string. */
  readonly mutuality: string;
  /** Present only when netting changes nothing; verbatim honest note. */
  readonly advice: string | null;
  readonly excludedDisputed: readonly ObligationId[];
}

export const NO_BENEFIT_ADVICE = "netting saves nothing here, use a plain bulk payout";
