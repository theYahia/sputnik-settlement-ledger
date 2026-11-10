import { parseFixture, type Fixture } from "../ledger/parse.ts";
import { ledgerHash } from "../ledger/hash.ts";
import { quote } from "../settlement/quote.ts";

/**
 * Generates the `near-cli-rs` commands for the testnet runbook. It only builds
 * strings and argument files: nothing here signs or sends anything.
 *
 * JSON arguments are written to files and passed with `file-args`, so the same
 * commands work in PowerShell, cmd and bash without any quoting rules.
 *
 * The ledger hash covers account names and obligation ids, so a fixture cannot
 * simply be replayed under a different account prefix. The fixture is rewritten
 * first (accounts renamed, ids renumbered to what the registry assigns on
 * chain: `ob-1`, `ob-2`, ...), and the commands plus the expected hash are
 * derived from that rewritten copy.
 */

const FIXTURE_ACCOUNT_SUFFIX = ".ledger-dao.testnet";
const PREFIX_PATTERN = /^[a-z0-9]+([-_][a-z0-9]+)*$/;
const MAX_PREFIX_LENGTH = 40;
const STORAGE_DEPOSIT = "0.00125 NEAR";
const MINT_AMOUNT = "10000000000000000000000";
const ARGS_DIR = "out/args";

export interface TestnetOptions {
  /** Funded testnet account; every account below is a subaccount of it. */
  readonly prefix: string;
  /** Account that owns registry and token and signs owner-only calls. */
  readonly owner: string;
  /** Sputnik DAO account (for example `name.sputnikv2.testnet`). */
  readonly dao: string;
  readonly proposalId?: string;
  readonly txHash?: string;
  /** Attached to `add_proposal`; must match `proposal_bond` of the DAO policy. */
  readonly proposalBond?: string;
  /** Balance of each contract account; it pays for the wasm storage. */
  readonly contractBalance?: string;
  /** Balance of each working-group account; it only pays gas. */
  readonly groupBalance?: string;
}

export interface ArgsFile {
  readonly path: string;
  readonly content: string;
}

export interface PlannedCommand {
  readonly stage: string;
  readonly contract: string;
  readonly method: string;
  /** JSON text of the call arguments, empty for non-call commands. */
  readonly args: string;
  readonly signer: string;
  readonly text: string;
  readonly argsFile: ArgsFile | null;
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
  let counter = 0;
  const nextArgsFile = (method: string, json: string): ArgsFile => {
    counter += 1;
    return { path: `${ARGS_DIR}/${String(counter).padStart(2, "0")}-${method}.json`, content: json };
  };

  const call = (
    stage: string,
    contract: string,
    method: string,
    args: unknown,
    signer: string,
    gas: string,
    deposit: string,
  ): void => {
    const json = JSON.stringify(args);
    const file = nextArgsFile(method, json);
    commands.push({
      stage,
      contract,
      method,
      args: json,
      signer,
      argsFile: file,
      text:
        `near contract call-function as-transaction ${contract} ${method} file-args ${file.path} ` +
        `prepaid-gas '${gas}' attached-deposit '${deposit}' sign-as ${signer} ` +
        `network-config testnet sign-with-keychain send`,
    });
  };

  const deploy = (
    stage: string,
    contract: string,
    wasm: string,
    initArgs: unknown,
    signer: string,
  ): void => {
    const json = JSON.stringify(initArgs);
    const file = nextArgsFile(`init-${contract.split(".")[0]}`, json);
    commands.push({
      stage,
      contract,
      method: "deploy",
      args: json,
      signer,
      argsFile: file,
      text:
        `near contract deploy ${contract} use-file ${wasm} with-init-call init file-args ${file.path} ` +
        `prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send`,
    });
  };

  const funded = `${options.prefix}.testnet`;
  const contractBalance = options.contractBalance ?? "8 NEAR";
  const groupBalance = options.groupBalance ?? "0.3 NEAR";
  for (const account of [registry, token, ...accounts]) {
    const balance = account === registry || account === token ? contractBalance : groupBalance;
    commands.push({
      stage: "accounts",
      contract: account,
      method: "create-account",
      args: "",
      signer: funded,
      argsFile: null,
      text:
        `near account create-account fund-myself ${account} '${balance}' ` +
        `autogenerate-new-keypair save-to-keychain sign-as ${funded} network-config testnet sign-with-keychain send`,
    });
  }

  deploy(
    "token",
    token,
    "build/ledger-token.wasm",
    { owner: options.owner, name: "Settlement Ledger Token", symbol: "SLT", decimals: fixture.decimals },
    token,
  );
  for (const account of [options.dao, ...accounts]) {
    call("token", token, "storage_deposit", { account_id: account }, options.owner, "30 Tgas", STORAGE_DEPOSIT);
  }
  call("token", token, "mint", { account_id: options.dao, amount: MINT_AMOUNT }, options.owner, "30 Tgas", "0 NEAR");

  deploy("registry", registry, "build/registry.wasm", { owner: options.owner }, registry);
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
  commands.push({
    stage: "proposal",
    contract: options.dao,
    method: "add_proposal",
    args: "",
    signer: options.owner,
    argsFile: null,
    text:
      `near contract call-function as-transaction ${options.dao} add_proposal file-args out/add-proposal.json ` +
      `prepaid-gas '100 Tgas' attached-deposit '${options.proposalBond ?? "1 NEAR"}' sign-as ${options.owner} ` +
      `network-config testnet sign-with-keychain send`,
  });
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
