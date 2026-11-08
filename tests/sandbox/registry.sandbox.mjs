/**
 * Sandbox test against a real wasm build.
 *
 * Requires Linux or macOS: the near-sdk-js toolchain (wasi-sdk) and the
 * near-sandbox binary are not published for win32, so this file is not part of
 * `npm test`. Run it on a CI runner or a Linux box:
 *
 *   npm run build:contract
 *   npm install --no-save near-workspaces
 *   npm run test:sandbox
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WASM = fileURLToPath(new URL("../../build/registry.wasm", import.meta.url));

let workspaces = null;
try {
  workspaces = await import("near-workspaces");
} catch {
  workspaces = null;
}

test("registry contract: record, close and quote match the offline module", async (t) => {
  if (workspaces === null) {
    t.skip("near-workspaces is not installed");
    return;
  }
  if (!existsSync(WASM)) {
    t.skip("build/registry.wasm is missing; run npm run build:contract first");
    return;
  }

  const { quote } = await import("../../src/settlement/quote.ts");
  const { ledgerHash } = await import("../../src/ledger/hash.ts");

  const worker = await workspaces.Worker.init();
  try {
    const root = worker.rootAccount;
    const dao = await root.createSubAccount("ledger-dao");
    const registry = await root.createSubAccount("registry");
    const alfa = await root.createSubAccount("alfa");
    const bravo = await root.createSubAccount("bravo");
    const mallory = await root.createSubAccount("mallory");

    await registry.deploy(WASM);
    await registry.call(registry, "init", { owner: dao.accountId });

    const period = "2026-Q4";
    await dao.call(registry, "create_period", {
      period_id: period,
      members: [alfa.accountId, bravo.accountId],
    });

    await alfa.call(registry, "record_obligation", {
      period_id: period,
      from: alfa.accountId,
      to: bravo.accountId,
      amount: "180000000000000000000",
      memo: "ci minutes",
    });
    await bravo.call(registry, "record_obligation", {
      period_id: period,
      from: bravo.accountId,
      to: alfa.accountId,
      amount: "140000000000000000000",
      memo: "landing page",
    });

    await t.test("an outsider cannot record an obligation", async () => {
      await assert.rejects(
        mallory.call(registry, "record_obligation", {
          period_id: period,
          from: mallory.accountId,
          to: alfa.accountId,
          amount: "1",
          memo: "spam",
        }),
        /NOT_MEMBER/,
      );
    });

    await t.test("quoting an open period is refused", async () => {
      await assert.rejects(registry.view("quote_settlement", { period_id: period }), /PERIOD_NOT_CLOSED/);
    });

    await dao.call(registry, "close_period", { period_id: period });
    const hash = await registry.view("get_ledger_hash", { period_id: period });

    const obligations = [
      {
        id: "ob-1",
        from: alfa.accountId,
        to: bravo.accountId,
        amount: 180000000000000000000n,
        memo: "ci minutes",
        disputed: false,
      },
      {
        id: "ob-2",
        from: bravo.accountId,
        to: alfa.accountId,
        amount: 140000000000000000000n,
        memo: "landing page",
        disputed: false,
      },
    ];
    assert.equal(hash, ledgerHash(period, obligations));

    const remote = await registry.view("quote_settlement", { period_id: period });
    const local = quote(period, obligations);
    assert.deepEqual(normalize(remote), normalize({ ...local, ledgerHash: hash }));

    await t.test("a disputed record is excluded from settlement", async () => {
      await dao.call(registry, "create_period", {
        period_id: "2026-Q5",
        members: [alfa.accountId],
      });
      await alfa.call(registry, "record_obligation", {
        period_id: "2026-Q5",
        from: alfa.accountId,
        to: bravo.accountId,
        amount: "5",
        memo: "contested",
      });
      await alfa.call(registry, "dispute_obligation", { period_id: "2026-Q5", obligation_id: "ob-1" });
      await dao.call(registry, "close_period", { period_id: "2026-Q5" });
      const disputedQuote = await registry.view("quote_settlement", { period_id: "2026-Q5" });
      assert.deepEqual(disputedQuote.excludedDisputed, ["ob-1"]);
      assert.equal(disputedQuote.transferCount, 0);
    });
  } finally {
    await worker.tearDown();
  }
});

function normalize(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, inner) => (typeof inner === "bigint" ? inner.toString(10) : inner)),
  );
}
