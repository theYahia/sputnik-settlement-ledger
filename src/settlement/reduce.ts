import type { NetPosition, Transfer } from "../ledger/types.ts";

/**
 * Greedy reduction of net positions to a set of transfers.
 *
 * This is a *reduced* set, not a minimal one: finding the minimum number of
 * transfers is NP-hard (it is equivalent to partitioning into zero-sum
 * subsets). The greedy largest-debtor / largest-creditor rule is guaranteed
 * to terminate within n-1 transfers, because every step zeroes out at least
 * one of the two accounts it touches.
 *
 * Tie-breaking is lexicographic by account id, so two runs over the same
 * positions in any order produce byte-identical output. Without that, the
 * on-chain quote and the offline quote could disagree on equal amounts.
 */
export function reduceSettlement(positions: readonly NetPosition[]): Transfer[] {
  const debtors = positions
    .filter((p) => p.net < 0n)
    .map((p) => ({ account: p.account, amount: -p.net }));
  const creditors = positions
    .filter((p) => p.net > 0n)
    .map((p) => ({ account: p.account, amount: p.net }));

  const sumDebt = debtors.reduce((acc, d) => acc + d.amount, 0n);
  const sumCredit = creditors.reduce((acc, c) => acc + c.amount, 0n);
  if (sumDebt !== sumCredit) {
    throw new Error("net positions do not sum to zero; ledger is inconsistent");
  }

  debtors.sort(byAmountDescThenAccount);
  creditors.sort(byAmountDescThenAccount);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    if (debtor === undefined || creditor === undefined) break;
    const amount = debtor.amount < creditor.amount ? debtor.amount : creditor.amount;
    transfers.push({ from: debtor.account, to: creditor.account, amount });
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0n) i++;
    if (creditor.amount === 0n) j++;
  }

  return transfers;
}

function byAmountDescThenAccount(
  a: { readonly account: string; readonly amount: bigint },
  b: { readonly account: string; readonly amount: bigint },
): number {
  if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;
  return a.account < b.account ? -1 : a.account > b.account ? 1 : 0;
}
