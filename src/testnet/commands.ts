import { parseFixture, type Fixture } from "../ledger/parse.ts";
import { ledgerHash } from "../ledger/hash.ts";
import { quote } from "../settlement/quote.ts";

/**
 * Generates the `near-cli-rs` commands for the testnet runbook. It only builds
 * strings: nothing here signs or sends anything.
 *
 * The ledger hash covers account names and obligation ids, so a fixture cannot
 * simply be replayed under a different account prefix. The fixture is rewritten
 * first (accounts renamed, ids renumbered to what the registry assigns on
 * chain: `ob-1`, `ob-2`, ...), and the commands plus the expected hash are
 * derived from that rewritten copy.
 */

const FIXTURE_ACCOUNT_SUFFIX = ".ledger-dao.testnet";
const FIXTURE_TOKEN = "ledger-token.testnet";
const PREFIX_PATTERN = /^[a-z0-9]+([-_][a-z0-9]+)*$/;
const MAX_PREFIX_LENGTH = 40;
const STORAGE_DEPOSIT = "0.00125 NEAR";
const MINT_AMOUNT = "10000000000000000000000";

export interface TestnetOptions {
  /** Funded testnet account; every account below is a subaccount of it. */
  readonly prefix: string;
  /** Account that owns registry and token and signs owner-only calls. */
  readonly owner: string;
  /** Sputnik DAO account (for example `name.sputnikv2.testnet`). */
  readonly dao: string;
  readonly proposalId?: string;
  readonly txHash?: string;
}

export interface PlannedCommand {
  readonly stage: string;
  readonly contract: string;
  readonly method: string;
  /** JSON text passed to `json-args`. */
  readonly args: string;
  readonly signer: string;
  readonly text: string;
}

export interface TestnetPlan {
  readonly fixture: Fixture;
  readonly fixtureJson: string;
  readonly ledgerHash: string;
  readonly registry: string;
  readonly token: string;
  readonly accounts: readonly string[];
  readonly commands: readonly PlannedCommand[];
  readonly expectedPayouts: string;
}

export function planTestnet(fixtureJson: string, options: TestnetOptions): TestnetPlan {
  validatePrefix(options.prefix);
  const source = parseFixture(fixtureJson);
  const rename = (account: string): string => {
    if (!account.endsWith(FIXTURE_ACCOUNT_SUFFIX)) {
      throw new Error(`fixture account ${account} does not end with ${FIXTURE_ACCOUNT_SUFFIX}`);
    }
    return `${account.slice(0, -FIXTURE_ACCOUNT_SUFFIX.length)}.${options.prefix}.testnet`;
  };

  const registry = `registry.${options.prefix}.testnet`;
  const token = `token.${options.prefix}.testnet`;

  const obligations = source.obligations.map((o, index) => ({
    ...o,
    id: `ob-${index + 1}`,
    from: rename(o.from),
    to: rename(o.to),
  }));
  const fixture: Fixture = {
    periodId: source.periodId,
    tokenId: token,
    decimals: source.decimals,
    obligations,
  };

  const accounts = [...new Set(obligations.flatMap((o) => [o.from, o.to]))].sort();
  const periodId = fixture.periodId;
  const hash = ledgerHash(periodId, obligations);
  const result = quote(periodId, obligations);

  const commands: PlannedCommand[] = [];
  const call = (
    stage: string,
    contract: string,
    method: string,
    args: unknown,
    signer: string,
    gas: string,
    deposit: string,
    rawArgs?: string,
  ): void => {
    const json = rawArgs ?? JSON.stringify(args);
    const argsText = rawArgs === undefined ? shq(json) : rawArgs;
    commands.push({
      stage,
      contract,
      method,
      args: json,
      signer,
      text:
        `near contract call-function as-transaction ${contract} ${method} json-args ${argsText} ` +
        `prepaid-gas '${gas}' attached-deposit '${deposit}' sign-as ${signer} ` +
        `network-config testnet sign-with-keychain send`,
    });
  };

  const funded = `${options.prefix}.testnet`;
  for (const account of [registry, token, ...accounts]) {
    commands.push({
      stage: "accounts",
      contract: account,
      method: "create-account",
      args: "",
      signer: funded,
      text:
        `near account create-account fund-myself ${account} '${account === registry || account === token ? "5" : "1"} NEAR' ` +
        `autogenerate-new-keypair save-to-keychain sign-as ${funded} network-config testnet sign-with-keychain send`,
    });
  }

  commands.push({
    stage: "token",
    contract: token,
    method: "deploy",
    args: "",
    signer: options.owner,
    text:
      `near contract deploy ${token} use-file build/ledger-token.wasm with-init-call init json-args ` +
      `${shq(JSON.stringify({ owner: options.owner, name: "Settlement Ledger Token", symbol: "SLT", decimals: fixture.decimals }))} ` +
      `prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send`,
  });
  for (const account of [options.dao, ...accounts]) {
    call("token", token, "storage_deposit", { account_id: account }, options.owner, "30 Tgas", STORAGE_DEPOSIT);
  }
  call("token", token, "mint", { account_id: options.dao, amount: MINT_AMOUNT }, options.owner, "30 Tgas", "0 NEAR");

  commands.push({
    stage: "registry",
    contract: registry,
    method: "deploy",
    args: "",
    signer: options.owner,
    text:
      `near contract deploy ${registry} use-file build/registry.wasm with-init-call init json-args ` +
      `${shq(JSON.stringify({ owner: options.owner }))} ` +
      `prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send`,
  });
  call("registry", registry, "create_period", { period_id: periodId, members: accounts }, options.owner, "100 Tgas", "0 NEAR");
  for (const o of obligations) {
    call(
      "obligations",
      registry,
      "record_obligation",
      { period_id: periodId, from: o.from, to: o.to, amount: o.amount.toString(10), memo: o.memo },
      o.from,
      "100 Tgas",
      "0 NEAR",
    );
  }
  for (const o of obligations.filter((entry) => entry.disputed)) {
    call("dispute", registry, "dispute_obligation", { period_id: periodId, obligation_id: o.id }, o.to, "100 Tgas", "0 NEAR");
  }
  call("close", registry, "close_period", { period_id: periodId }, options.owner, "100 Tgas", "0 NEAR");

  const proposalId = options.proposalId ?? "<PROPOSAL_ID>";
  const txHash = options.txHash ?? "<EXECUTION_TX_HASH>";
  call(
    "proposal",
    options.dao,
    "add_proposal",
    undefined,
    options.owner,
    "100 Tgas",
    "1 NEAR",
    '"$(cat out/add-proposal.json)"',
  );
  call("proposal", options.dao, "act_proposal", { id: proposalIdValue(proposalId), action: "VoteApprove" }, options.owner, "300 Tgas", "0 NEAR");
  call(
    "settled",
    registry,
    "mark_settled",
    { period_id: periodId, proposal_id: proposalId, tx_hash: txHash },
    options.owner,
    "100 Tgas",
    "0 NEAR",
  );

  const fixtureOut = {
    periodId: fixture.periodId,
    tokenId: fixture.tokenId,
    decimals: fixture.decimals,
    obligations: obligations.map((o) => ({
      id: o.id,
      from: o.from,
      to: o.to,
      amount: o.amount.toString(10),
      memo: o.memo,
      ...(o.disputed ? { disputed: true } : {}),
    })),
  };

  return {
    fixture,
    fixtureJson: `${JSON.stringify(fixtureOut, null, 2)}\n`,
    ledgerHash: hash,
    registry,
    token,
    accounts,
    commands,
    expectedPayouts: `${result.baselineTransferCount} -> ${result.transferCount}, mutuality ${result.mutuality}`,
  };
}

/** Quoted placeholder stays a string so the JSON remains valid before the id is known. */
function proposalIdValue(id: string): number | string {
  return /^[0-9]+$/.test(id) ? Number(id) : id;
}

export function validatePrefix(prefix: string): void {
  if (prefix.length === 0 || prefix.length > MAX_PREFIX_LENGTH || !PREFIX_PATTERN.test(prefix)) {
    throw new Error(
      `invalid prefix "${prefix}": use 1-${MAX_PREFIX_LENGTH} chars of [a-z0-9], with single - or _ between them`,
    );
  }
}

function shq(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export { FIXTURE_TOKEN };

