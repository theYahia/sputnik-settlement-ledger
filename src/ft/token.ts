/**
 * Minimal NEP-141 token core, testable without a chain.
 *
 * The product needs a token the treasury can hold and pay out atomically in
 * one proposal. This is deliberately the smallest NEP-141 that satisfies
 * `ft_transfer` (used by the batch) and `storage_deposit` (required before
 * the batch, or the transfer panics). No approval flow, no events beyond the
 * standard `ft_transfer`, no owner migration: anything more is out of scope
 * and would need its own review.
 */

export const STORAGE_DEPOSIT_YOCTO = 1_250_000_000_000_000_000_000n;
export const MAX_MEMO_LENGTH = 128;

export interface TokenState {
  readonly owner: string;
  totalSupply: string;
  balances: Record<string, string>;
  registered: string[];
  metadata: {
    readonly name: string;
    readonly symbol: string;
    readonly decimals: number;
  };
}

export type TokenErrorCode =
  | "NOT_OWNER"
  | "NOT_REGISTERED"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_BALANCE"
  | "INVALID_ARGUMENT";

export class TokenError extends Error {
  readonly code: TokenErrorCode;

  constructor(code: TokenErrorCode, message: string) {
    super(message);
    this.name = "TokenError";
    this.code = code;
  }
}

export function initToken(
  owner: string,
  name: string,
  symbol: string,
  decimals: number,
): TokenState {
  if (!isAccountId(owner)) throw new TokenError("INVALID_ARGUMENT", "owner must be an account id");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 24) {
    throw new TokenError("INVALID_ARGUMENT", "decimals must be an integer in 0..24");
  }
  return {
    owner,
    totalSupply: "0",
    balances: {},
    registered: [],
    metadata: { name, symbol, decimals },
  };
}

export function storageDeposit(state: TokenState, account: string, attached: bigint): void {
  if (!isAccountId(account)) throw new TokenError("INVALID_ARGUMENT", "invalid account");
  if (state.registered.includes(account)) {
    if (attached !== 0n) {
      throw new TokenError("INVALID_ARGUMENT", "account is already registered; deposit is not needed");
    }
    return;
  }
  if (attached < STORAGE_DEPOSIT_YOCTO) {
    throw new TokenError(
      "INVALID_ARGUMENT",
      `storage deposit requires at least ${STORAGE_DEPOSIT_YOCTO} yoctoNEAR`,
    );
  }
  state.registered.push(account);
  state.balances[account] = state.balances[account] ?? "0";
}

/**
 * Transfers are refused for unregistered accounts. On chain this is the
 * failure that a bulk-payout operator hits when they skip `storage_deposit`;
 * the runbook makes it an explicit step for every recipient.
 */
export function ftTransfer(
  state: TokenState,
  caller: string,
  receiver: string,
  amount: string,
  memo: string,
): void {
  if (!isAccountId(caller) || !isAccountId(receiver)) {
    throw new TokenError("INVALID_ARGUMENT", "invalid account");
  }
  if (memo.length > MAX_MEMO_LENGTH) {
    throw new TokenError("INVALID_ARGUMENT", `memo longer than ${MAX_MEMO_LENGTH}`);
  }
  if (!/^[1-9][0-9]*$/.test(amount)) {
    throw new TokenError("INVALID_AMOUNT", "amount must be a positive decimal string");
  }
  requireRegistered(state, caller);
  requireRegistered(state, receiver);
  const value = BigInt(amount);
  const balance = BigInt(state.balances[caller] ?? "0");
  if (balance < value) {
    throw new TokenError("INSUFFICIENT_BALANCE", `${caller} has ${balance}, needs ${value}`);
  }
  state.balances[caller] = (balance - value).toString(10);
  state.balances[receiver] = (BigInt(state.balances[receiver] ?? "0") + value).toString(10);
}

/** Mint exists only so a testnet treasury can be funded; owner-only. */
export function mint(state: TokenState, caller: string, account: string, amount: string): void {
  if (caller !== state.owner) throw new TokenError("NOT_OWNER", `${caller} is not the token owner`);
  if (!/^[1-9][0-9]*$/.test(amount)) {
    throw new TokenError("INVALID_AMOUNT", "amount must be a positive decimal string");
  }
  requireRegistered(state, account);
  const value = BigInt(amount);
  state.balances[account] = (BigInt(state.balances[account] ?? "0") + value).toString(10);
  state.totalSupply = (BigInt(state.totalSupply) + value).toString(10);
}

export function ftBalanceOf(state: TokenState, account: string): string {
  return state.balances[account] ?? "0";
}

function requireRegistered(state: TokenState, account: string): void {
  if (!state.registered.includes(account)) {
    throw new TokenError("NOT_REGISTERED", `${account} has no storage deposit`);
  }
}

const ACCOUNT_SEGMENT = String.raw`[a-z\d]+(?:[-_][a-z\d]+)*`;
const ACCOUNT_ID = new RegExp(String.raw`^${ACCOUNT_SEGMENT}(?:\.${ACCOUNT_SEGMENT})*$`);

function isAccountId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length >= 2 && value.length <= 64 && ACCOUNT_ID.test(value)
  );
}
