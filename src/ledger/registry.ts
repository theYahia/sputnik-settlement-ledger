import type { Obligation, ObligationId, PeriodStatus } from "./types.ts";
import { ledgerHash } from "./hash.ts";

/**
 * Period registry logic, independent of any NEAR binding.
 *
 * The near-sdk-js contract in `src/contract/` is a thin shim over these
 * functions, and the tests exercise the same functions directly. That is the
 * only reliable way to keep the on-chain quote and the offline quote equal:
 * there is one implementation, not two.
 *
 * State is plain JSON with amounts as decimal strings, because the contract
 * state is JSON and a JSON number cannot carry 10^24 without loss.
 */

export interface StoredObligation {
  readonly id: ObligationId;
  readonly from: string;
  readonly to: string;
  /** Decimal string in minimal token units. */
  readonly amount: string;
  readonly memo: string;
  readonly disputed: boolean;
}

export interface PeriodRecord {
  readonly id: string;
  status: PeriodStatus;
  readonly members: readonly string[];
  obligations: StoredObligation[];
  ledgerHash: string | null;
  /** Filled by markSettled once the DAO proposal executed. */
  settlement: { readonly proposalId: string; readonly txHash: string } | null;
  nextObligationIndex: number;
}

export interface RegistryState {
  /** The DAO account that owns this registry: only it closes periods. */
  owner: string;
  periods: Record<string, PeriodRecord>;
  version: number;
}

export type RegistryErrorCode =
  | "NOT_OWNER"
  | "NOT_MEMBER"
  | "PERIOD_EXISTS"
  | "PERIOD_NOT_FOUND"
  | "PERIOD_NOT_OPEN"
  | "PERIOD_NOT_CLOSED"
  | "INVALID_ARGUMENT"
  | "OBLIGATION_NOT_FOUND"
  | "ALREADY_SETTLED";

export class RegistryError extends Error {
  readonly code: RegistryErrorCode;

  constructor(code: RegistryErrorCode, message: string) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
  }
}

export const REGISTRY_VERSION = 1;

export function emptyRegistry(owner: string): RegistryState {
  if (!isAccountId(owner)) throw new RegistryError("INVALID_ARGUMENT", "owner must be an account id");
  return { owner, periods: {}, version: REGISTRY_VERSION };
}

export function createPeriod(
  state: RegistryState,
  caller: string,
  periodId: string,
  members: readonly string[],
): PeriodRecord {
  requireOwner(state, caller);
  if (!isIdentifier(periodId)) {
    throw new RegistryError("INVALID_ARGUMENT", "period id must be 1-64 chars of [A-Za-z0-9._:-]");
  }
  if (state.periods[periodId] !== undefined) {
    throw new RegistryError("PERIOD_EXISTS", `period ${periodId} already exists`);
  }
  if (members.length === 0) {
    throw new RegistryError("INVALID_ARGUMENT", "period needs at least one member");
  }
  const uniqueMembers: string[] = [];
  for (const member of members) {
    if (!isAccountId(member)) {
      throw new RegistryError("INVALID_ARGUMENT", `invalid member account: ${member}`);
    }
    if (!uniqueMembers.includes(member)) uniqueMembers.push(member);
  }

  const period: PeriodRecord = {
    id: periodId,
    status: "open",
    members: uniqueMembers,
    obligations: [],
    ledgerHash: null,
    settlement: null,
    nextObligationIndex: 1,
  };
  state.periods[periodId] = period;
  return period;
}

export function recordObligation(
  state: RegistryState,
  caller: string,
  periodId: string,
  from: string,
  to: string,
  amount: string,
  memo: string,
): StoredObligation {
  const period = requirePeriod(state, periodId);
  requireOpen(period);
  requireMember(period, caller);
  if (!isAccountId(from) || !isAccountId(to)) {
    throw new RegistryError("INVALID_ARGUMENT", "from/to must be account ids");
  }
  if (from === to) {
    throw new RegistryError("INVALID_ARGUMENT", "from and to must differ");
  }
  if (!isPositiveDecimal(amount)) {
    throw new RegistryError("INVALID_ARGUMENT", "amount must be a positive decimal string");
  }
  if (typeof memo !== "string" || memo.length > 128) {
    throw new RegistryError("INVALID_ARGUMENT", "memo must be a string of at most 128 chars");
  }

  const obligation: StoredObligation = {
    id: `ob-${period.nextObligationIndex}`,
    from,
    to,
    amount,
    memo,
    disputed: false,
  };
  period.nextObligationIndex += 1;
  period.obligations.push(obligation);
  return obligation;
}

export function disputeObligation(
  state: RegistryState,
  caller: string,
  periodId: string,
  obligationId: string,
  disputed: boolean,
): StoredObligation {
  const period = requirePeriod(state, periodId);
  requireOpen(period);
  if (caller !== state.owner && !period.members.includes(caller)) {
    throw new RegistryError("NOT_MEMBER", `${caller} may not dispute in ${periodId}`);
  }
  const obligation = period.obligations.find((o) => o.id === obligationId);
  if (obligation === undefined) {
    throw new RegistryError("OBLIGATION_NOT_FOUND", `no obligation ${obligationId}`);
  }
  const updated: StoredObligation = { ...obligation, disputed };
  period.obligations = period.obligations.map((o) => (o.id === obligationId ? updated : o));
  return updated;
}

/**
 * Freezes the ledger. From here the record set is immutable, which is what
 * makes `ledger_hash` meaningful: a dispute raised after closing would either
 * invalidate the hash or silently rewrite history, and both are worse than
 * opening a correction period.
 */
export function closePeriod(
  state: RegistryState,
  caller: string,
  periodId: string,
): PeriodRecord {
  requireOwner(state, caller);
  const period = requirePeriod(state, periodId);
  requireOpen(period);
  period.status = "quoted";
  period.ledgerHash = ledgerHash(periodId, toObligations(period));
  return period;
}

export function markSettled(
  state: RegistryState,
  caller: string,
  periodId: string,
  proposalId: string,
  txHash: string,
): PeriodRecord {
  requireOwner(state, caller);
  const period = requirePeriod(state, periodId);
  if (period.status === "open") {
    throw new RegistryError("PERIOD_NOT_CLOSED", `period ${periodId} is not closed`);
  }
  if (period.status === "settled") {
    throw new RegistryError("ALREADY_SETTLED", `period ${periodId} is already settled`);
  }
  if (!isIdentifier(proposalId) || !isIdentifier(txHash)) {
    throw new RegistryError("INVALID_ARGUMENT", "proposalId and txHash must be non-empty");
  }
  period.status = "settled";
  period.settlement = { proposalId, txHash };
  return period;
}

export function getPeriod(state: RegistryState, periodId: string): PeriodRecord {
  return requirePeriod(state, periodId);
}

export function listObligations(state: RegistryState, periodId: string): Obligation[] {
  return toObligations(requirePeriod(state, periodId));
}

export function getLedgerHash(state: RegistryState, periodId: string): string | null {
  return requirePeriod(state, periodId).ledgerHash;
}

/** Ledger records as domain obligations, with amounts parsed back to bigint. */
export function toObligations(period: PeriodRecord): Obligation[] {
  return period.obligations.map((o) => ({
    id: o.id,
    from: o.from,
    to: o.to,
    amount: BigInt(o.amount),
    memo: o.memo,
    disputed: o.disputed,
  }));
}

/**
 * Settlement may only be quoted for a closed period: on an open period the
 * record set can still change, so the quoted numbers would not correspond to
 * any hash the DAO could later verify.
 */
export function requireClosedForQuote(period: PeriodRecord): void {
  if (period.status === "open") {
    throw new RegistryError(
      "PERIOD_NOT_CLOSED",
      `period ${period.id} is open; close it before quoting a settlement`,
    );
  }
}

export function requireOwner(state: RegistryState, caller: string): void {
  if (caller !== state.owner) {
    throw new RegistryError("NOT_OWNER", `${caller} is not the registry owner`);
  }
}

export function requirePeriod(state: RegistryState, periodId: string): PeriodRecord {
  const period = state.periods[periodId];
  if (period === undefined) {
    throw new RegistryError("PERIOD_NOT_FOUND", `no period ${periodId}`);
  }
  return period;
}

function requireOpen(period: PeriodRecord): void {
  if (period.status !== "open") {
    throw new RegistryError("PERIOD_NOT_OPEN", `period ${period.id} is ${period.status}`);
  }
}

function requireMember(period: PeriodRecord, caller: string): void {
  if (!period.members.includes(caller)) {
    throw new RegistryError("NOT_MEMBER", `${caller} is not a member of ${period.id}`);
  }
}

const ACCOUNT_SEGMENT = String.raw`[a-z\d]+(?:[-_][a-z\d]+)*`;
const ACCOUNT_ID = new RegExp(String.raw`^${ACCOUNT_SEGMENT}(?:\.${ACCOUNT_SEGMENT})*$`);

export function isAccountId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 2 && value.length <= 64 &&
    ACCOUNT_ID.test(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,64}$/.test(value);
}

function isPositiveDecimal(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}
