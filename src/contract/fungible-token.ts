import { NearBindgen, call, initialize, near, view } from "near-sdk-js";

import {
  TokenError,
  ftBalanceOf,
  ftTransfer,
  initToken,
  mint as mintImpl,
  storageDeposit,
  type TokenState,
} from "../ft/token.ts";

/**
 * NEP-141 test token for the demo treasury.
 *
 * It exists so the batch in a Sputnik proposal is atomic: several
 * `ft_transfer` calls to one token contract either all succeed or all revert.
 * It is not a product feature and is not audited.
 */

@NearBindgen({ requireInit: true })
export class LedgerToken {
  state: TokenState = initToken("placeholder.testnet", "Settlement Ledger Token", "SLT", 18);

  @initialize({})
  init({
    owner,
    name,
    symbol,
    decimals,
  }: {
    owner: string;
    name: string;
    symbol: string;
    decimals: number;
  }): void {
    this.state = initToken(owner, name, symbol, decimals);
  }

  @call({ payableFunction: true })
  storage_deposit({ account_id }: { account_id?: string }): void {
    const target = account_id ?? near.predecessorAccountId();
    run(() => storageDeposit(this.state, target, near.attachedDeposit()));
  }

  @call({ payableFunction: true })
  ft_transfer({
    receiver_id,
    amount,
    memo,
  }: {
    receiver_id: string;
    amount: string;
    memo?: string;
  }): void {
    if (near.attachedDeposit() !== 1n) {
      throw new Error("INVALID_AMOUNT: ft_transfer requires exactly 1 yoctoNEAR");
    }
    run(() =>
      ftTransfer(
        this.state,
        near.predecessorAccountId(),
        receiver_id,
        amount,
        memo ?? "",
      ),
    );
  }

  @call({})
  mint({ account_id, amount }: { account_id: string; amount: string }): void {
    run(() => mintImpl(this.state, near.predecessorAccountId(), account_id, amount));
  }

  @view({})
  ft_balance_of({ account_id }: { account_id: string }): string {
    return ftBalanceOf(this.state, account_id);
  }

  @view({})
  ft_total_supply(): string {
    return this.state.totalSupply;
  }

  @view({})
  ft_metadata(): TokenState["metadata"] {
    return this.state.metadata;
  }
}

function run<T>(action: () => T): T {
  try {
    return action();
  } catch (error: unknown) {
    if (error instanceof TokenError) {
      throw new Error(`${error.code}: ${error.message}`);
    }
    throw error;
  }
}
