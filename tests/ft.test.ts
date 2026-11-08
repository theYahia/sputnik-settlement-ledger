import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STORAGE_DEPOSIT_YOCTO,
  TokenError,
  ftBalanceOf,
  ftTransfer,
  initToken,
  mint,
  storageDeposit,
  type TokenState,
} from "../src/ft/token.ts";

const OWNER = "ledger-dao.testnet";
const ALFA = "alfa.ledger-dao.testnet";
const BRAVO = "bravo.ledger-dao.testnet";
const STRANGER = "mallory.testnet";

function funded(): TokenState {
  const state = initToken(OWNER, "Settlement Ledger Token", "SLT", 18);
  for (const account of [OWNER, ALFA, BRAVO]) {
    storageDeposit(state, account, STORAGE_DEPOSIT_YOCTO);
  }
  mint(state, OWNER, OWNER, "1000");
  mint(state, OWNER, ALFA, "500");
  return state;
}

test("storage_deposit registers an account exactly once", () => {
  const state = initToken(OWNER, "T", "T", 18);
  storageDeposit(state, ALFA, STORAGE_DEPOSIT_YOCTO);
  assert.ok(state.registered.includes(ALFA));
  assert.throws(
    () => storageDeposit(state, ALFA, STORAGE_DEPOSIT_YOCTO),
    (error: unknown) => error instanceof TokenError && error.code === "INVALID_ARGUMENT",
  );
});

test("deposit below the storage cost is refused", () => {
  const state = initToken(OWNER, "T", "T", 18);
  assert.throws(
    () => storageDeposit(state, ALFA, STORAGE_DEPOSIT_YOCTO - 1n),
    (error: unknown) => error instanceof TokenError && error.code === "INVALID_ARGUMENT",
  );
});

test("ft_transfer moves the exact amount and keeps the supply constant", () => {
  const state = funded();
  ftTransfer(state, ALFA, BRAVO, "150", "2026-Q4");
  assert.equal(ftBalanceOf(state, ALFA), "350");
  assert.equal(ftBalanceOf(state, BRAVO), "150");
  assert.equal(state.totalSupply, "1500");
});

test("ft_transfer fails for an account without storage deposit", () => {
  const state = funded();
  assert.throws(
    () => ftTransfer(state, ALFA, STRANGER, "1", ""),
    (error: unknown) => error instanceof TokenError && error.code === "NOT_REGISTERED",
  );
});

test("ft_transfer cannot overdraw", () => {
  const state = funded();
  assert.throws(
    () => ftTransfer(state, ALFA, BRAVO, "501", ""),
    (error: unknown) => error instanceof TokenError && error.code === "INSUFFICIENT_BALANCE",
  );
});

test("ft_transfer validates amount and memo", () => {
  const state = funded();
  for (const amount of ["0", "-1", "1.5", ""]) {
    assert.throws(
      () => ftTransfer(state, ALFA, BRAVO, amount, ""),
      (error: unknown) => error instanceof TokenError && error.code === "INVALID_AMOUNT",
    );
  }
  assert.throws(
    () => ftTransfer(state, ALFA, BRAVO, "1", "x".repeat(129)),
    (error: unknown) => error instanceof TokenError && error.code === "INVALID_ARGUMENT",
  );
});

test("only the owner mints", () => {
  const state = funded();
  assert.throws(
    () => mint(state, ALFA, ALFA, "1"),
    (error: unknown) => error instanceof TokenError && error.code === "NOT_OWNER",
  );
});

test("a full settlement batch applies every transfer in order", () => {
  const state = funded();
  const before = { ...state.balances };
  for (const transfer of [
    { from: ALFA, to: BRAVO, amount: "100" },
    { from: BRAVO, to: OWNER, amount: "40" },
    { from: ALFA, to: OWNER, amount: "25" },
  ]) {
    ftTransfer(state, transfer.from, transfer.to, transfer.amount, "batch");
  }
  assert.equal(ftBalanceOf(state, ALFA), "375");
  assert.equal(ftBalanceOf(state, BRAVO), "60");
  assert.equal(ftBalanceOf(state, OWNER), "1065");
  const total = Object.values(state.balances).reduce((acc, value) => acc + BigInt(value), 0n);
  assert.equal(total, BigInt(state.totalSupply));
  assert.notDeepEqual(state.balances, before);
});
