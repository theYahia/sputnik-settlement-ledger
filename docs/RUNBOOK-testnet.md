# Testnet runbook

Everything here touches a live network, so it is a **human gate**: the tooling
prepares the commands, a person signs each transaction and confirms the result.
Mainnet is never used; there is no spend beyond testnet funds.

This runbook is written for Windows PowerShell 5.1 (the machine the demo was built
on) and works the same on Linux/macOS. Record every hash you produce in the claims
table of `README.md`.

## 0. Prerequisites

- Node >= 22.18, `near-cli-rs` (`near`) with a testnet key in the keychain and
  roughly 15 NEAR on the owner account (DAO 6, registry and token accounts 6.5 each
  by default; unused balance stays on the accounts).
- On Windows use `npm.cmd` if script execution is restricted, and avoid `.ps1`
  files: every helper here is a Node script.
- JSON arguments are always passed through `file-args` (a file under `out/args/`).
  Inline JSON breaks on PowerShell quoting.
- PowerShell 5.1 `>` writes UTF-16. Use `--commands-out` instead of redirection.
- The wasm toolchain is Linux/macOS only. The `build-wasm` GitHub Actions workflow
  builds `build/registry.wasm` and `build/ledger-token.wasm`; download the artifact
  into `build/`. Locally only `npm run build:bundle` works on Windows.

```
npm.cmd install --ignore-scripts
npm.cmd test
npm.cmd run typecheck
```

## 1. Generate the commands

The ledger hash covers account names and obligation ids, so the fixture is renamed
to your accounts first. The generator only writes files; it signs nothing.

```
node scripts/testnet-commands.mjs --prefix <prefix> --owner <owner>.testnet --dao <name>.sputnikv2.testnet --commands-out out/commands.txt
```

It writes `out/commands.txt`, `out/args/*.json` and `out/workgroups.<prefix>.json`,
and prints the expected ledger hash. Use that fixture (not `fixtures/workgroups.json`)
for `build-proposal`, `report` and `verify`.

Stages in `out/commands.txt`: `accounts`, `token`, `registry`, `obligations`,
`dispute`, `close`, then the proposal steps. `storage_deposit` for the DAO and the
six groups is part of `token` (the step a plain bulk payout skips and then fails on).
Each `record_obligation` is signed by its `from` account.

Run a stage with:

```
node scripts/run-stage.mjs out/commands.txt <stage>
```

Do not rerun a failed stage as a whole (repeating `create-account` fails); run the
remaining commands from the file one by one. `run-stage.mjs` skips accounts that
already exist.

Registry owner: for the demo it is your own account (`close_period` and
`mark_settled` are owner-only; with the DAO as owner they would need their own
proposals). This is a deliberate simplification.

## 2. DAO

The factory on testnet is `sputnikv2.testnet`; the DAO becomes
`<name>.sputnikv2.testnet`. Council is your account only, vote threshold 1 of 1.
The generator writes the arguments to `out/args/dao-create.json`:

```
near contract call-function as-transaction sputnikv2.testnet create file-args out/args/dao-create.json prepaid-gas '150 Tgas' attached-deposit '6 NEAR' sign-as <owner>.testnet network-config testnet sign-with-keychain send
```

Check `proposal_bond` (1 NEAR by default) and the threshold with `get_policy`.
Views without arguments are easiest through RPC with `args_base64: e30=`.

## 3. Check the chain against the offline numbers

`out/args/period.json` is `{"period_id":"2026-Q4-workgroups"}`:

```
near contract call-function as-read-only registry.<prefix>.testnet get_ledger_hash file-args out/args/period.json network-config testnet now
near contract call-function as-read-only registry.<prefix>.testnet quote_settlement file-args out/args/period.json network-config testnet now
```

Expect `17 -> 4`, `mutuality 0.8960`, `ob-18` excluded, and the hash printed by the
generator.

## 4. Proposal

```
node src/cli/index.ts build-proposal --fixture out/workgroups.<prefix>.json --dao <name>.sputnikv2.testnet --token token.<prefix>.testnet --proposer <owner>.testnet --out out/proposal.json
node src/cli/index.ts build-proposal --fixture out/workgroups.<prefix>.json --dao <name>.sputnikv2.testnet --token token.<prefix>.testnet --proposer <owner>.testnet --add-proposal-args --out out/add-proposal.json
```

`out/add-proposal.json` is exactly the `add_proposal` argument
(`{"proposal":{"description","kind"}}`); `out/proposal.json` is the full envelope for
`report`.

```
near contract call-function as-transaction <name>.sputnikv2.testnet add_proposal file-args out/add-proposal.json prepaid-gas '100 Tgas' attached-deposit '1 NEAR' sign-as <owner>.testnet network-config testnet sign-with-keychain send
```

The returned number is the proposal id. Then write `{"id":<id>,"action":"VoteApprove"}`
to `out/args/act.json` and approve; it needs **300 Tgas** because the four
`ft_transfer` calls run from the same transaction:

```
near contract call-function as-transaction <name>.sputnikv2.testnet act_proposal file-args out/args/act.json prepaid-gas '300 Tgas' attached-deposit '0 NEAR' sign-as <owner>.testnet network-config testnet sign-with-keychain send
```

With a one-member council the approval executes the proposal. Save the transaction
hash of this call as the execution hash.

## 5. Confirm

Regenerate the commands with the real ids so `out/args/NN-mark_settled.json` is
filled in (do not rerun `act_proposal`):

```
node scripts/testnet-commands.mjs --prefix <prefix> --owner <owner>.testnet --dao <name>.sputnikv2.testnet --proposal-id <id> --tx <execution tx hash> --commands-out out/commands.txt
```

`mark_settled` runs on the contract (the local `ssl settle` only updates an offline
mirror). Run the `mark_settled` line from `out/commands.txt`, then:

```
node src/cli/index.ts verify --fixture out/workgroups.<prefix>.json --rpc https://rpc.testnet.near.org --contract registry.<prefix>.testnet --period 2026-Q4-workgroups
node src/cli/index.ts report --fixture out/workgroups.<prefix>.json --out-dir out/report --proposal out/proposal.json --proposal-id <id> --tx <execution tx hash>
```

`verify` must print `OK`. Then check every group's `ft_balance_of` against the net
positions (for the demo: `infra` 60, `research` 5, DAO 9935, others 0, in whole
tokens) and fill the claims table in `README.md`.
