import type { Obligation } from "./types.ts";

interface RawObligation {
  readonly id?: unknown;
  readonly from?: unknown;
  readonly to?: unknown;
  readonly amount?: unknown;
  readonly memo?: unknown;
  readonly disputed?: unknown;
}

interface RawFixture {
  readonly periodId?: unknown;
  readonly tokenId?: unknown;
  readonly decimals?: unknown;
  readonly obligations?: unknown;
}

export interface Fixture {
  readonly periodId: string;
  readonly tokenId: string;
  readonly decimals: number;
  readonly obligations: readonly Obligation[];
}

/**
 * Amounts arrive as decimal strings, never as JSON numbers: a 24-decimal
 * token amount does not survive IEEE-754.
 */
export function parseFixture(json: string): Fixture {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== "object" || raw === null) throw new Error("fixture must be an object");
  const fixture = raw as RawFixture;

  const periodId = requireString(fixture.periodId, "periodId");
  const tokenId = requireString(fixture.tokenId, "tokenId");
  const decimals = fixture.decimals;
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0) {
    throw new Error("decimals must be a non-negative integer");
  }
  if (!Array.isArray(fixture.obligations)) throw new Error("obligations must be an array");

  const obligations = fixture.obligations.map((entry, index) => parseObligation(entry, index));
  return { periodId, tokenId, decimals, obligations };
}

export function parseObligation(entry: unknown, index: number): Obligation {
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`obligation #${index} must be an object`);
  }
  const raw = entry as RawObligation;
  const amount = raw.amount;
  if (typeof amount !== "string" || !/^[0-9]+$/.test(amount)) {
    throw new Error(`obligation #${index}: amount must be a decimal string in minimal units`);
  }
  const parsed = BigInt(amount);
  if (parsed <= 0n) throw new Error(`obligation #${index}: amount must be positive`);

  return {
    id: requireString(raw.id, `obligation #${index} id`),
    from: requireString(raw.from, `obligation #${index} from`),
    to: requireString(raw.to, `obligation #${index} to`),
    amount: parsed,
    memo: typeof raw.memo === "string" ? raw.memo : "",
    disputed: raw.disputed === true,
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}
