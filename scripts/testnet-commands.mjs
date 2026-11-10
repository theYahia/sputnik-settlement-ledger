#!/usr/bin/env node
// Prints near-cli-rs commands for the testnet runbook. Signs and sends nothing.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { planTestnet } from "../src/testnet/commands.ts";

const USAGE = `Usage: node scripts/testnet-commands.mjs --prefix <p> --owner <account> --dao <account>
         [--fixture fixtures/workgroups.json] [--out-dir out] [--proposal-id <n>] [--tx <hash>]

Writes <out-dir>/workgroups.<prefix>.json (fixture renamed to your accounts, ids as the
registry assigns them) and prints the commands in runbook order.
`;

function parse(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    args[token.slice(2)] = argv[++i];
  }
  return args;
}

try {
  const args = parse(process.argv.slice(2));
  if (args.prefix === undefined || args.owner === undefined || args.dao === undefined) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  const fixtureFile = args.fixture ?? "fixtures/workgroups.json";
  const outDir = args["out-dir"] ?? "out";
  const plan = planTestnet(readFileSync(fixtureFile, "utf8"), {
    prefix: args.prefix,
    owner: args.owner,
    dao: args.dao,
    ...(args["proposal-id"] === undefined ? {} : { proposalId: args["proposal-id"] }),
    ...(args.tx === undefined ? {} : { txHash: args.tx }),
  });

  mkdirSync(outDir, { recursive: true });
  const fixtureOut = path.join(outDir, `workgroups.${args.prefix}.json`);
  writeFileSync(fixtureOut, plan.fixtureJson, "utf8");

  const lines = [
    `# fixture for this deployment: ${fixtureOut}`,
    `# expected ledger hash: ${plan.ledgerHash}`,
    `# expected quote: ${plan.expectedPayouts}`,
    `# registry ${plan.registry}  token ${plan.token}`,
  ];
  let stage = "";
  for (const command of plan.commands) {
    if (command.stage !== stage) {
      stage = command.stage;
      lines.push("", `# --- ${stage}`);
    }
    lines.push(command.text);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
} catch (error) {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
