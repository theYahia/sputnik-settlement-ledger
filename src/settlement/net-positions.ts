import type { AccountId, NetPosition, Obligation } from "../ledger/types.ts";

/**
 * Net position per account: (owed to it) - (what it owes).
 *
 * Disputed obligations are excluded: a contested record must not move money.
 * Accounts whose net is exactly zero are dropped — they neither pay nor
 * receive, and keeping them would inflate the participant count used in the
 * `transfers <= n-1` bound.
 *
 * Output order is lexicographic by account id so the result is identical for
 * any permutation of the input.
 */
export function netPositions(obligations: readonly Obligation[]): NetPosition[] {
  const nets = new Map<AccountId, bigint>();

  for (const o of obligations) {
    if (o.disputed) continue;
    if (o.amount <= 0n) throw new Error(`obligation ${o.id}: amount must be positive`);
    if (o.from === o.to) throw new Error(`obligation ${o.id}: self-obligation is not settleable`);
    nets.set(o.from, (nets.get(o.from) ?? 0n) - o.amount);
    nets.set(o.to, (nets.get(o.to) ?? 0n) + o.amount);
  }

  const result: NetPosition[] = [];
  for (const [account, net] of nets) {
    if (net !== 0n) result.push({ account, net });
  }
  result.sort(byAccount);
  return result;
}

function byAccount(a: NetPosition, b: NetPosition): number {
  return a.account < b.account ? -1 : a.account > b.account ? 1 : 0;
}

/** Sum of all obligation amounts that take part in settlement. */
export function grossVolume(obligations: readonly Obligation[]): bigint {
  let total = 0n;
  for (const o of obligations) {
    if (o.disputed) continue;
    total += o.amount;
  }
  return total;
}
