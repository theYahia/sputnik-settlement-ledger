import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseFixture } from "../src/ledger/parse.ts";
import { ledgerHash } from "../src/ledger/hash.ts";
import { planTestnet } from "../src/testnet/commands.ts";
import { buildProposal, serializeAddProposalArgs } from "../src/proposal/build.ts";
import { quote } from "../src/settlement/quote.ts";

const FIXTURE = readFileSync(
  fileURLToPath(new URL("../fixtures/workgroups.json", import.meta.url)),
  "utf8",
);
const OPTIONS = { prefix: "demo1", owner: "demo1.testnet", dao: "ssl.sputnikv2.testnet" } as const;

test("one record_obligation per fixture record, signed by the obligor", () => {
  const plan = planTestnet(FIXTURE, OPTIONS);
  const source = parseFixture(FIXTURE);
  const records = plan.commands.filter((c) => c.method === "record_obligation");
  assert.equal(records.length, source.obligations.length);
  records.forEach((command, index) => {
    const args = JSON.parse(command.args) as Record<string, unknown>;
    assert.equal(command.signer, args.from);
    assert.match(String(args.amount), /^[0-9]+$/);
    assert.equal(args.amount, source.obligations[index]?.amount.toString(10));
    assert.ok(String(args.from).endsWith(".demo1.testnet"));
  });
});

test("dispute is raised on ob-18 by a period member after recording", () => {
  const plan = planTestnet(FIXTURE, OPTIONS);
  const dispute = plan.commands.find((c) => c.method === "dispute_obligation");
  assert.ok(dispute !== undefined);
  assert.equal(JSON.parse(dispute.args).obligation_id, "ob-18");
  assert.ok(plan.accounts.includes(dispute.signer));
  const methods = plan.commands.map((c) => c.method);
  assert.ok(methods.lastIndexOf("record_obligation") < methods.indexOf("dispute_obligation"));
  assert.ok(methods.indexOf("dispute_obligation") < methods.indexOf("close_period"));
});

test("renamed fixture hash is stable, differs from the template, and keeps the quote", () => {
  const plan = planTestnet(FIXTURE, OPTIONS);
  const source = parseFixture(FIXTURE);
  assert.notEqual(plan.ledgerHash, ledgerHash(source.periodId, source.obligations));
  const reparsed = parseFixture(plan.fixtureJson);
  assert.equal(ledgerHash(reparsed.periodId, reparsed.obligations), plan.ledgerHash);
  assert.equal(plan.expectedPayouts, "17 -> 4, mutuality 0.8960");
  assert.equal(quote(reparsed.periodId, reparsed.obligations).transferCount, 4);
});

test("every recipient gets storage_deposit before the proposal", () => {
  const plan = planTestnet(FIXTURE, OPTIONS);
  const methods = plan.commands.map((c) => c.method);
  const deposits = plan.commands.filter((c) => c.method === "storage_deposit");
  assert.equal(deposits.length, plan.accounts.length + 1);
  assert.ok(methods.lastIndexOf("storage_deposit") < methods.indexOf("add_proposal"));
  const act = plan.commands.find((c) => c.method === "act_proposal");
  assert.ok(act?.text.includes("300 Tgas"));
});

test("invalid prefix is rejected", () => {
  assert.throws(() => planTestnet(FIXTURE, { ...OPTIONS, prefix: "Bad Prefix" }), /invalid prefix/);
  assert.throws(() => planTestnet(FIXTURE, { ...OPTIONS, prefix: "" }), /invalid prefix/);
});

test("add_proposal args contain exactly description and kind", () => {
  const source = parseFixture(FIXTURE);
  const result = quote(source.periodId, source.obligations);
  const envelope = buildProposal(source.periodId, ledgerHash(source.periodId, source.obligations), result, {
    daoAccount: "d.testnet",
    tokenId: "t.testnet",
    proposer: "p.testnet",
  });
  const parsed = JSON.parse(serializeAddProposalArgs(envelope)) as { proposal: Record<string, unknown> };
  assert.deepEqual(Object.keys(parsed), ["proposal"]);
  assert.deepEqual(Object.keys(parsed.proposal), ["description", "kind"]);
});
