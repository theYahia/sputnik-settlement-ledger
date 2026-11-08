#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { parseFixture, type Fixture } from "../ledger/parse.ts";
import { quote } from "../settlement/quote.ts";
import { ledgerHash } from "../ledger/hash.ts";
import {
  REGISTRY_VERSION,
  RegistryError,
  closePeriod,
  createPeriod,
  disputeObligation,
  emptyRegistry,
  markSettled,
  recordObligation,
  requirePeriod,
  toObligations,
  type RegistryState,
} from "../ledger/registry.ts";
import { buildProposal, serializeProposal, type ProposalEnvelope } from "../proposal/build.ts";
import { renderCsv, renderHtml, renderMarkdown, type ReportInput } from "../report/render.ts";
import { verifyLedger } from "../verify/verify.ts";
import { viewFunction } from "../chain/rpc.ts";
import type { Obligation, Quote } from "../ledger/types.ts";

/**
 * CLI surface. Two modes share one code path:
 *
 * - offline: work from a fixture or from a local registry mirror (`--store`),
 *   which is what `npm test` and a reviewer without network access use;
 * - on-chain: `verify` reads `get_ledger_hash`, `list_obligations` and
 *   `quote_settlement` from a deployed contract over plain RPC.
 *
 * No command signs a transaction. Creation and execution belong to the DAO.
 */

const USAGE = `Usage: ssl <command> [options]

Offline ledger (local mirror of the on-chain registry, JSON file):
  init --store <file> --owner <account>
  create-period --store <file> --period <id> --members <a,b,c> [--actor <account>]
  record --store <file> --period <id> --from <a> --to <b> --amount <minimal-units> --memo <text> [--actor]
  dispute --store <file> --period <id> --obligation <id> [--actor]
  undispute --store <file> --period <id> --obligation <id> [--actor]
  close --store <file> --period <id> [--actor]
  settle --store <file> --period <id> --proposal <id> --tx <hash> [--actor]

Computation and artefacts:
  quote --fixture <file> [--json]
  quote --store <file> --period <id> [--json]
  build-proposal --fixture <file> --dao <account> --token <account> [--proposer <account>] [--out <file>]
  report --fixture <file> --out-dir <dir> [--proposal <file>] [--tx <hash>] [--proposal-id <id>]
  verify --fixture <file> --expected <ledger-hash>
  verify --fixture <file> --store <file> --period <id>
  verify --fixture <file> --rpc <url> --contract <account> --period <id>

Examples:
  ssl quote --fixture fixtures/star.json
  ssl report --fixture fixtures/workgroups.json --out-dir out
  ssl verify --fixture fixtures/workgroups.json --expected sha256:...
`;

class UsageError extends Error {}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  const args = parseArgs(rest);

  switch (command) {
    case "init":
      return cmdInit(args);
    case "create-period":
      return cmdCreatePeriod(args);
    case "record":
      return cmdRecord(args);
    case "dispute":
      return cmdDispute(args, true);
    case "undispute":
      return cmdDispute(args, false);
    case "close":
      return cmdClose(args);
    case "settle":
      return cmdSettle(args);
    case "quote":
      return cmdQuote(args);
    case "build-proposal":
      return cmdBuildProposal(args);
    case "report":
      return cmdReport(args);
    case "verify":
      return cmdVerify(args);
    default:
      throw new UsageError(`unknown command: ${command}`);
  }
}

function cmdInit(args: Args): number {
  const store = required(args, "store");
  const owner = required(args, "owner");
  const state = emptyRegistry(owner);
  saveState(store, state);
  print(`registry owned by ${owner} written to ${store}`);
  return 0;
}

function cmdCreatePeriod(args: Args): number {
  const { state, store } = loadState(args);
  const actor = args.actor ?? state.owner;
  const periodId = required(args, "period");
  const members = required(args, "members")
    .split(",")
    .map((member) => member.trim())
    .filter((member) => member.length > 0);
  createPeriod(state, actor, periodId, members);
  saveState(store, state);
  print(`period ${periodId} created with ${members.length} member(s)`);
  return 0;
}

function cmdRecord(args: Args): number {
  const { state, store } = loadState(args);
  const actor = args.actor ?? state.owner;
  const periodId = required(args, "period");
  const period = requirePeriod(state, periodId);
  const obligation = recordObligation(
    state,
    actor,
    periodId,
    required(args, "from"),
    required(args, "to"),
    required(args, "amount"),
    args.memo ?? "",
  );
  saveState(store, state);
  print(`recorded ${obligation.id}: ${obligation.from} -> ${obligation.to} ${obligation.amount}`);
  print(
    `on chain: near contract call-function as-transaction ${period.id} record_obligation json-args ` +
      `'{"period_id":"${periodId}","from":"${obligation.from}","to":"${obligation.to}","amount":"${obligation.amount}","memo":"${escapeForShell(obligation.memo)}"}' ` +
      `prepaid-gas '100 Tgas' attach-deposit '0 NEAR' sign-as ${actor} network-config testnet sign-with-keychain`,
  );
  return 0;
}

function cmdDispute(args: Args, disputed: boolean): number {
  const { state, store } = loadState(args);
  const actor = args.actor ?? state.owner;
  const periodId = required(args, "period");
  const updated = disputeObligation(
    state,
    actor,
    periodId,
    required(args, "obligation"),
    disputed,
  );
  saveState(store, state);
  print(`${updated.id} is now ${updated.disputed ? "disputed" : "not disputed"}`);
  return 0;
}

function cmdClose(args: Args): number {
  const { state, store } = loadState(args);
  const actor = args.actor ?? state.owner;
  const period = closePeriod(state, actor, required(args, "period"));
  saveState(store, state);
  print(`period ${period.id} closed; ledger hash ${period.ledgerHash ?? "?"}`);
  return 0;
}

function cmdSettle(args: Args): number {
  const { state, store } = loadState(args);
  const actor = args.actor ?? state.owner;
  const periodId = required(args, "period");
  const period = requirePeriod(state, periodId);
  if (period.status !== "quoted") {
    throw new UsageError(`period ${periodId} is ${period.status}; expected quoted`);
  }
  markSettled(state, actor, periodId, required(args, "proposal"), required(args, "tx"));
  saveState(store, state);
  print(`period ${periodId} marked settled`);
  return 0;
}

function cmdQuote(args: Args): number {
  const result = quoteFromArgs(args);
  if (args.json === "true") {
    process.stdout.write(`${serializeQuote(result.quote)}\n`);
    return 0;
  }
  print(formatQuote(result.quote, result.ledgerHash));
  return 0;
}

function cmdBuildProposal(args: Args): number {
  const fixture = loadFixture(required(args, "fixture"));
  const result = checkClosed(fixture, quote(fixture.periodId, fixture.obligations));
  const envelope = buildProposal(fixture.periodId, result.ledgerHash, result.quote, {
    daoAccount: required(args, "dao"),
    tokenId: required(args, "token"),
    proposer: args.proposer ?? required(args, "dao"),
  });
  const serialized = serializeProposal(envelope);
  if (args.out !== undefined) {
    writeFileSync(args.out, `${serialized}\n`, "utf8");
    print(`proposal written to ${args.out}`);
  } else {
    process.stdout.write(`${serialized}\n`);
  }
  return 0;
}

function cmdReport(args: Args): number {
  const fixture = loadFixture(required(args, "fixture"));
  const result = checkClosed(fixture, quote(fixture.periodId, fixture.obligations));
  const outDir = required(args, "out-dir");
  mkdirSync(outDir, { recursive: true });

  let proposal: ProposalEnvelope | undefined;
  if (args.proposal !== undefined) {
    proposal = JSON.parse(readFileSync(args.proposal, "utf8")) as ProposalEnvelope;
  }

  const input: ReportInput = {
    periodId: fixture.periodId,
    tokenId: fixture.tokenId,
    decimals: fixture.decimals,
    obligations: fixture.obligations,
    quote: result.quote,
    ledgerHash: result.ledgerHash,
    ...(proposal === undefined ? {} : { proposal }),
    execution:
      args.tx === undefined
        ? null
        : { proposalId: args["proposal-id"] ?? "unknown", txHash: args.tx },
  };

  writeFileSync(path.join(outDir, "report.html"), renderHtml(input), "utf8");
  writeFileSync(path.join(outDir, "report.md"), renderMarkdown(input), "utf8");
  writeFileSync(path.join(outDir, "payouts.csv"), renderCsv(input), "utf8");
  print(`wrote ${path.join(outDir, "report.html")}, report.md, payouts.csv`);
  print(`ledger hash ${result.ledgerHash}`);
  return 0;
}

async function cmdVerify(args: Args): Promise<number> {
  const fixture = loadFixture(required(args, "fixture"));

  if (args.expected !== undefined) {
    const result = verifyLedger({
      periodId: fixture.periodId,
      obligations: fixture.obligations,
      expectedHash: args.expected,
    });
    return reportVerification(result);
  }

  if (args.store !== undefined) {
    const { state } = loadState(args);
    const period = requirePeriod(state, required(args, "period"));
    if (period.ledgerHash === null) throw new UsageError(`period ${period.id} is not closed`);
    const result = verifyLedger({
      periodId: fixture.periodId,
      obligations: fixture.obligations,
      expectedHash: period.ledgerHash,
    });
    return reportVerification(result);
  }

  if (args.rpc !== undefined && args.contract !== undefined) {
    const contractId = required(args, "contract");
    const periodId = required(args, "period");
    const rpcUrl = args.rpc;
    const [hash, obligations, chainQuote] = await Promise.all([
      viewFunction({ rpcUrl, contractId, methodName: "get_ledger_hash", args: { period_id: periodId } }),
      viewFunction({ rpcUrl, contractId, methodName: "list_obligations", args: { period_id: periodId } }),
      viewFunction({
        rpcUrl,
        contractId,
        methodName: "quote_settlement",
        args: { period_id: periodId },
      }),
    ]);
    if (typeof hash !== "string") throw new UsageError("contract returned no ledger hash");
    const chainObligations = obligationsFromWire(obligations);
    compareRecordSets(fixture.obligations, chainObligations);
    const result = verifyLedger({
      periodId: fixture.periodId,
      obligations: fixture.obligations,
      expectedHash: hash,
      onChainQuote: quoteFromWire(chainQuote),
    });
    return reportVerification(result);
  }

  throw new UsageError("verify needs --expected, --store or --rpc/--contract");
}

// --- shared helpers -------------------------------------------------------

interface QuoteWithHash {
  readonly quote: Quote;
  readonly ledgerHash: string;
}

function quoteFromArgs(args: Args): QuoteWithHash {
  if (args.fixture !== undefined) {
    const fixture = loadFixture(args.fixture);
    return checkClosed(fixture, quote(fixture.periodId, fixture.obligations));
  }
  if (args.store !== undefined) {
    const { state } = loadState(args);
    const period = requirePeriod(state, required(args, "period"));
    if (period.ledgerHash === null) throw new UsageError(`period ${period.id} is not closed`);
    return {
      quote: quote(period.id, toObligations(period)),
      ledgerHash: period.ledgerHash,
    };
  }
  throw new UsageError("quote needs --fixture or --store/--period");
}

/**
 * A quote is only meaningful for a frozen record set. For fixtures, the
 * "closed" check is the hash of what was read: it is computed once here and
 * passed through, so the report and the proposal cannot show different hashes.
 */
function checkClosed(fixture: Fixture, result: Quote): QuoteWithHash {
  return { quote: result, ledgerHash: ledgerHash(fixture.periodId, fixture.obligations) };
}

function loadFixture(file: string): Fixture {
  return parseFixture(readFileSync(file, "utf8"));
}

function loadState(args: Args): { state: RegistryState; store: string } {
  const store = required(args, "store");
  const raw: unknown = JSON.parse(readFileSync(store, "utf8"));
  if (!isRegistryState(raw)) throw new UsageError(`${store} is not a registry state file`);
  if (raw.version !== REGISTRY_VERSION) {
    throw new UsageError(`${store} has registry version ${raw.version}; expected ${REGISTRY_VERSION}`);
  }
  return { state: raw, store };
}

function saveState(file: string, state: RegistryState): void {
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function isRegistryState(value: unknown): value is RegistryState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { owner?: unknown; periods?: unknown; version?: unknown };
  return (
    typeof candidate.owner === "string" &&
    typeof candidate.version === "number" &&
    typeof candidate.periods === "object" &&
    candidate.periods !== null
  );
}

function formatQuote(result: Quote, hash: string): string {
  const lines = [
    `period        ${result.periodId}`,
    `ledger hash   ${hash}`,
    `participants  ${result.participants}`,
    `payouts       ${result.baselineTransferCount} -> ${result.transferCount}  (reduced set, greedy, <= n-1)`,
    `value moved   ${result.gross} -> ${result.movedNet}  (minimal units)`,
    `mutuality     ${result.mutuality}`,
  ];
  if (result.advice !== null) lines.push(`note          ${result.advice}`);
  if (result.excludedDisputed.length > 0) {
    lines.push(`disputed      ${result.excludedDisputed.join(", ")} (excluded)`);
  }
  lines.push("", "net positions:");
  for (const position of result.netPositions) {
    lines.push(`  ${position.net > 0n ? "+" : ""}${position.net}  ${position.account}`);
  }
  lines.push("", "payouts:");
  for (const transfer of result.transfers) {
    lines.push(`  ${transfer.amount}  ${transfer.from} -> ${transfer.to}`);
  }
  return lines.join("\n");
}

function serializeQuote(result: Quote): string {
  return JSON.stringify(result, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString(10) : value,
  );
}

function reportVerification(result: ReturnType<typeof verifyLedger>): number {
  if (result.ok) {
    print(`OK  ${result.recomputedHash}`);
    print(`    payouts ${result.quote.baselineTransferCount} -> ${result.quote.transferCount}, mutuality ${result.quote.mutuality}`);
    return 0;
  }
  print(`FAIL  ${result.recomputedHash}`);
  for (const problem of result.problems) print(`      ${problem}`);
  return 1;
}

function obligationsFromWire(value: unknown): Obligation[] {
  if (!Array.isArray(value)) throw new UsageError("list_obligations did not return an array");
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new UsageError("bad obligation record");
    const record = entry as Record<string, unknown>;
    const { id, from, to, amount, memo, disputed } = record;
    if (
      typeof id !== "string" ||
      typeof from !== "string" ||
      typeof to !== "string" ||
      typeof amount !== "string" ||
      typeof memo !== "string" ||
      typeof disputed !== "boolean"
    ) {
      throw new UsageError(`malformed obligation record: ${JSON.stringify(record)}`);
    }
    return { id, from, to, amount: BigInt(amount), memo, disputed };
  });
}

function quoteFromWire(value: unknown): Quote {
  if (typeof value !== "object" || value === null) throw new UsageError("quote view returned junk");
  const record = value as Record<string, unknown>;
  const netPositions = record.netPositions;
  const transfers = record.transfers;
  if (!Array.isArray(netPositions) || !Array.isArray(transfers)) {
    throw new UsageError("quote view is missing positions or transfers");
  }
  return {
    periodId: String(record.periodId),
    participants: Number(record.participants),
    netPositions: netPositions.map((entry) => ({
      account: String((entry as Record<string, unknown>).account),
      net: BigInt(String((entry as Record<string, unknown>).net)),
    })),
    transfers: transfers.map((entry) => ({
      from: String((entry as Record<string, unknown>).from),
      to: String((entry as Record<string, unknown>).to),
      amount: BigInt(String((entry as Record<string, unknown>).amount)),
    })),
    baselineTransferCount: Number(record.baselineTransferCount),
    transferCount: Number(record.transferCount),
    gross: BigInt(String(record.gross)),
    movedNet: BigInt(String(record.movedNet)),
    mutuality: String(record.mutuality),
    advice: record.advice === null ? null : String(record.advice),
    excludedDisputed: Array.isArray(record.excludedDisputed)
      ? record.excludedDisputed.map((id) => String(id))
      : [],
  };
}

function compareRecordSets(local: readonly Obligation[], chain: readonly Obligation[]): void {
  const localById = new Map(local.map((o) => [o.id, o]));
  const chainById = new Map(chain.map((o) => [o.id, o]));
  const problems: string[] = [];
  for (const [id, record] of localById) {
    const other = chainById.get(id);
    if (other === undefined) {
      problems.push(`record ${id} is in the local ledger but not on chain`);
      continue;
    }
    if (
      other.from !== record.from ||
      other.to !== record.to ||
      other.amount !== record.amount ||
      other.memo !== record.memo ||
      other.disputed !== record.disputed
    ) {
      problems.push(`record ${id} differs between local ledger and chain`);
    }
  }
  for (const id of chainById.keys()) {
    if (!localById.has(id)) problems.push(`record ${id} is on chain but not in the local ledger`);
  }
  if (problems.length > 0) {
    throw new UsageError(problems.join("\n"));
  }
}

interface Args {
  readonly [key: string]: string | undefined;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) break;
    if (!token.startsWith("--")) throw new UsageError(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "") throw new UsageError("empty option name");
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    i++;
  }
  return args;
}

function required(args: Args, key: string): string {
  const value = args[key];
  if (value === undefined || value === "true") throw new UsageError(`missing --${key}`);
  return value;
}

function escapeForShell(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function print(message: string): void {
  process.stdout.write(`${message}\n`);
}

try {
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
} catch (error: unknown) {
  if (error instanceof UsageError) {
    process.stderr.write(`error: ${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else if (error instanceof RegistryError) {
    process.stderr.write(`error: ${error.code}: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
