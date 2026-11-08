import type { Quote, Transfer } from "../ledger/types.ts";

/**
 * Compiles a closed period into one Sputnik DAO `FunctionCall` proposal.
 *
 * This is the actual contribution: a deterministic, byte-stable mapping from
 * a ledger to the exact arguments a DAO will execute. Sputnik already knows
 * how to run several actions in one atomic proposal; what it lacks is a
 * defensible way to get from "who owes whom" to those actions. The output is
 * golden-tested against a fixture so any accidental change to ordering,
 * encoding or rounding fails the build.
 */

export interface ProposalOptions {
  /** Sputnik DAO account that will receive the proposal. */
  readonly daoAccount: string;
  /** NEP-141 token contract whose `ft_transfer` will be called. */
  readonly tokenId: string;
  /** Account allowed to create the proposal; Sputnik enforces its own policy. */
  readonly proposer: string;
  readonly gas?: string;
  readonly deposit?: string;
}

export interface FtTransferAction {
  readonly method_name: "ft_transfer";
  /** base64 of UTF-8 JSON, which is what Sputnik expects in `args`. */
  readonly args: string;
  readonly deposit: string;
  readonly gas: string;
}

export interface FunctionCallKind {
  readonly receiver_id: string;
  readonly actions: readonly FtTransferAction[];
}

export interface FunctionCallProposal {
  readonly proposer: string;
  readonly description: string;
  readonly kind: {
    readonly FunctionCall: FunctionCallKind;
  };
}

export interface ProposalEnvelope {
  readonly proposal: FunctionCallProposal;
}

export const DEFAULT_GAS = "30000000000000";
export const FT_TRANSFER_DEPOSIT = "1";

/**
 * Transfers are already deterministic from `reduceSettlement`. The explicit
 * sort here guards the proposal against a future change in that module: two
 * proposals with the same ledger must stay byte-identical.
 */
export function buildProposal(periodId: string, ledgerHash: string, quoteResult: Quote, options: ProposalOptions): ProposalEnvelope {
  const gas = options.gas ?? DEFAULT_GAS;
  const deposit = options.deposit ?? FT_TRANSFER_DEPOSIT;

  const transfers = [...quoteResult.transfers].sort(compareTransfers);

  const actions: FtTransferAction[] = transfers.map((transfer) => ({
    method_name: "ft_transfer",
    args: encodeArgs({
      receiver_id: transfer.to,
      amount: transfer.amount.toString(10),
      memo: periodId,
    }),
    deposit,
    gas,
  }));

  return {
    proposal: {
      proposer: options.proposer,
      description: describe(periodId, ledgerHash, quoteResult, options),
      kind: {
        FunctionCall: {
          receiver_id: options.tokenId,
          actions,
        },
      },
    },
  };
}

/** Serialized exactly as it is posted to `add_proposal`. */
export function serializeProposal(envelope: ProposalEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * The description is the only free-text field a voter sees next to the raw
 * actions, so it states the numbers the quote view would return and the hash
 * that binds them to the ledger.
 */
export function describe(
  periodId: string,
  ledgerHash: string,
  quoteResult: Quote,
  options: ProposalOptions,
): string {
  const axes =
    `payouts ${quoteResult.baselineTransferCount} -> ${quoteResult.transferCount}, ` +
    `value moved ${quoteResult.gross} -> ${quoteResult.movedNet}`;
  return (
    `Settlement ${periodId}: ${axes} (mutuality ${quoteResult.mutuality}); ` +
    `ledger ${ledgerHash}; token ${options.tokenId}`
  );
}

function encodeArgs(value: Readonly<Record<string, string>>): string {
  const json = JSON.stringify(value);
  return Buffer.from(json, "utf8").toString("base64");
}

function compareTransfers(a: Transfer, b: Transfer): number {
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  if (a.to !== b.to) return a.to < b.to ? -1 : 1;
  return a.amount === b.amount ? 0 : a.amount < b.amount ? -1 : 1;
}
