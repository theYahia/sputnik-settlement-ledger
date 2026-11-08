import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseFixture } from "../src/ledger/parse.ts";
import { quote } from "../src/settlement/quote.ts";
import { ledgerHash } from "../src/ledger/hash.ts";
import {
  participantScores,
  renderCsv,
  renderHtml,
  renderMarkdown,
  type ReportInput,
} from "../src/report/render.ts";
import type { Obligation } from "../src/ledger/types.ts";

function reportInput(): ReportInput {
  const fixture = parseFixture(
    readFileSync(fileURLToPath(new URL("../fixtures/workgroups.json", import.meta.url)), "utf8"),
  );
  return {
    periodId: fixture.periodId,
    tokenId: fixture.tokenId,
    decimals: fixture.decimals,
    obligations: fixture.obligations,
    quote: quote(fixture.periodId, fixture.obligations),
    ledgerHash: ledgerHash(fixture.periodId, fixture.obligations),
  };
}

test("HTML report is self-contained and states both axes plus the hash", () => {
  const input = reportInput();
  const html = renderHtml(input);
  assert.match(html, /^<!doctype html>/i);
  assert.ok(!html.includes("<link"), "no external stylesheet");
  assert.ok(!html.includes("<script"), "no scripts");
  assert.ok(html.includes(input.ledgerHash));
  assert.ok(html.includes("17 → 4"));
  assert.ok(html.includes("Mutuality"));
  assert.ok(html.includes("ob-18"), "disputed record is listed");
  assert.ok(html.includes("infra.ledger-dao.testnet"));
});

test("Markdown report mirrors the same numbers", () => {
  const input = reportInput();
  const markdown = renderMarkdown(input);
  assert.ok(markdown.includes(`Ledger hash: \`${input.ledgerHash}\``));
  assert.ok(markdown.includes("**17 → 4**"));
  assert.ok(markdown.includes("Mutuality: **0.8960**"));
  assert.ok(markdown.includes("ob-18"));
});

test("CSV export has one row per payout, ready for a bulk payout tool", () => {
  const input = reportInput();
  const csv = renderCsv(input);
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines[0], "from,receiver_id,amount,memo");
  assert.equal(lines.length, input.quote.transferCount + 1);
  assert.ok(csv.includes("infra.ledger-dao.testnet"));
  assert.ok(!csv.includes("ob-18"), "disputed obligations are not paid");
});

test("settled-on-time scores count records, not time", () => {
  const scores = participantScores(reportInput().obligations);
  const events = scores.find((s) => s.account === "events.ledger-dao.testnet");
  assert.ok(events !== undefined);
  assert.equal(events.total, 6);
  assert.equal(events.settledOnTime, 5);
});

test("reports escape hostile memo text instead of injecting it", () => {
  const hostile: Obligation[] = [
    {
      id: "ob-1",
      from: "alfa.ledger-dao.testnet",
      to: "bravo.ledger-dao.testnet",
      amount: 10n,
      memo: '<script>alert("x")</script>',
      disputed: true,
    },
  ];
  const html = renderHtml({
    periodId: "p",
    tokenId: "t.testnet",
    decimals: 0,
    obligations: hostile,
    quote: quote("p", hostile),
    ledgerHash: ledgerHash("p", hostile),
  });
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("&lt;script&gt;alert"));
});

test("CSV quotes fields that contain separators", () => {
  const csv = renderCsv({
    periodId: 'p,with"comma',
    tokenId: "t.testnet",
    decimals: 0,
    obligations: [],
    quote: quote("p", []),
    ledgerHash: ledgerHash("p", []),
  });
  assert.equal(csv.trimEnd().split("\n").length, 1);
});
