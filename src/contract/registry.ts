import { NearBindgen, call, initialize, near, view } from "near-sdk-js";

import {
  REGISTRY_VERSION,
  RegistryError,
  closePeriod,
  createPeriod,
  disputeObligation,
  emptyRegistry,
  getLedgerHash,
  getPeriod,
  markSettled,
  recordObligation,
  requireClosedForQuote,
  requirePeriod,
  toObligations,
  type PeriodRecord,
  type RegistryState,
  type StoredObligation,
} from "../ledger/registry.ts";
import { quote } from "../settlement/quote.ts";
import type { Quote } from "../ledger/types.ts";

/**
 * On-chain obligation registry for one Sputnik DAO treasury.
 *
 * This contract holds records and the ledger hash. It does not hold funds and
 * has no signing path: custody and approvals stay in Sputnik. Execution is a
 * single `ft_transfer` batch proposal compiled by the CLI from a closed
 * period and executed by the DAO.
 *
 * The arithmetic lives in `src/ledger` and `src/settlement` and is imported
 * unchanged, so `quote_settlement` cannot drift from the offline quote.
 */

export interface QuoteResult extends Quote {
  readonly ledgerHash: string;
}

@NearBindgen({ requireInit: true })
export class SettlementRegistry {
  state: RegistryState = { owner: "", periods: {}, version: REGISTRY_VERSION };

  @initialize({})
  init({ owner }: { owner: string }): void {
    this.state = emptyRegistry(owner);
  }

  @call({})
  create_period({ period_id, members }: { period_id: string; members: string[] }): void {
    run(() => createPeriod(this.state, near.predecessorAccountId(), period_id, members));
  }

  @call({})
  record_obligation({
    period_id,
    from,
    to,
    amount,
    memo,
  }: {
    period_id: string;
    from: string;
    to: string;
    amount: string;
    memo: string;
  }): string {
    return run(() => {
      const obligation = recordObligation(
        this.state,
        near.predecessorAccountId(),
        period_id,
        from,
        to,
        amount,
        memo,
      );
      return obligation.id;
    });
  }

  @call({})
  dispute_obligation({
    period_id,
    obligation_id,
  }: {
    period_id: string;
    obligation_id: string;
  }): void {
    run(() =>
      disputeObligation(this.state, near.predecessorAccountId(), period_id, obligation_id, true),
    );
  }

  @call({})
  undispute_obligation({
    period_id,
    obligation_id,
  }: {
    period_id: string;
    obligation_id: string;
  }): void {
    run(() =>
      disputeObligation(this.state, near.predecessorAccountId(), period_id, obligation_id, false),
    );
  }

  @call({})
  close_period({ period_id }: { period_id: string }): string | null {
    return run(() => closePeriod(this.state, near.predecessorAccountId(), period_id).ledgerHash);
  }

  @call({})
  mark_settled({
    period_id,
    proposal_id,
    tx_hash,
  }: {
    period_id: string;
    proposal_id: string;
    tx_hash: string;
  }): void {
    run(() => markSettled(this.state, near.predecessorAccountId(), period_id, proposal_id, tx_hash));
  }

  /**
   * View, so the numbers in a proposal description can be re-read from chain
   * by anyone, without a transaction. Amounts travel as decimal strings: JSON
   * has no exact integer type and these values exceed 2^53.
   */
  @view({})
  quote_settlement({ period_id }: { period_id: string }): QuoteResult {
    return run(() => {
      const period = requirePeriod(this.state, period_id);
      requireClosedForQuote(period);
      if (period.ledgerHash === null) {
        throw new RegistryError("PERIOD_NOT_CLOSED", `period ${period_id} has no ledger hash`);
      }
      return { ...quote(period_id, toObligations(period)), ledgerHash: period.ledgerHash };
    });
  }

  @view({})
  get_period({ period_id }: { period_id: string }): PeriodRecord {
    return run(() => getPeriod(this.state, period_id));
  }

  @view({})
  list_obligations({ period_id }: { period_id: string }): StoredObligation[] {
    return run(() => requirePeriod(this.state, period_id).obligations);
  }

  @view({})
  get_ledger_hash({ period_id }: { period_id: string }): string | null {
    return run(() => getLedgerHash(this.state, period_id));
  }

  @view({})
  get_owner(): string {
    return this.state.owner;
  }
}

/**
 * Errors cross the WASM boundary as a panic message carrying a stable code,
 * so a failing test can assert on the reason rather than an opaque string.
 */
function run<T>(action: () => T): T {
  try {
    return action();
  } catch (error: unknown) {
    if (error instanceof RegistryError) {
      throw new Error(`${error.code}: ${error.message}`);
    }
    throw error;
  }
}
