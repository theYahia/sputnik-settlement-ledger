# Testnet runbook — stage 4

Everything here touches a live network, so it is a **human gate**: the agent
prepares the commands, a person runs them and confirms each result. Mainnet is
never used; there is no spend beyond testnet faucet funds.

Record every hash you produce in the claims table at the end of `README.md`.

## 0. Prerequisites

- Linux or macOS for the wasm build (the near-sdk-js toolchain ships wasi-sdk
  for those platforms only). Windows can run everything else.
- `near-cli-rs` (`near`) with a testnet key, funded through the faucet.
- Node LTS.

```bash
npm ci                    # Linux/macOS: near-sdk-js post-install downloads its toolchain
npm test
npm run typecheck
npm run build:contract    # build/registry.wasm
npm run build:token       # build/ledger-token.wasm
```

On Windows the SDK install has no toolchain to fetch, so use
`npm install --ignore-scripts` there; only `npm run build:bundle` works locally.

## 1. Generate the commands

The ledger hash covers account names and obligation ids, so the fixture is
renamed to your accounts first (ids become `ob-1`.. as the registry assigns
them). The generator only prints commands; it signs nothing.

```bash
node scripts/testnet-commands.mjs --prefix <prefix> --owner <owner>.testnet \
  --dao <name>.sputnikv2.testnet > out/commands.sh
```

It also writes `out/workgroups.<prefix>.json` and prints the expected ledger
hash. Use that fixture (not `fixtures/workgroups.json`) for `build-proposal`,
`report` and `verify` below. `<prefix>.testnet` must be a funded testnet account.

Order in `out/commands.sh`: accounts, token deploy, `storage_deposit` for the DAO
and the six groups (the step a plain bulk payout skips and then fails on), `mint`
to the DAO, registry deploy, `create_period`, 17 `record_obligation` (each signed
by its `from`), `dispute_obligation ob-18`, `close_period`, then the proposal
steps. Run them one by one and keep each tx hash.

Registry owner: for the demo use your own account (`close_period` and
`mark_settled` are owner-only; with the DAO as owner they would need their own
proposals). Say so in the README as a simplification.

## 2. DAO

Sputnik factory on testnet is `sputnikv2.testnet`; the DAO becomes
`<name>.sputnikv2.testnet`. Council = your account.

```bash
ARGS=$(echo '{"config":{"name":"<name>","purpose":"settlement demo","metadata":""},"policy":["<owner>.testnet"]}' | base64 -w0)
near contract call-function as-transaction sputnikv2.testnet create \
  json-args "{\"name\":\"<name>\",\"args\":\"$ARGS\"}" \
  prepaid-gas '150 Tgas' attached-deposit '6 NEAR' sign-as <owner>.testnet \
  network-config testnet sign-with-keychain send
near contract call-function as-read-only <name>.sputnikv2.testnet get_policy \
  json-args {} network-config testnet now
```

Note `proposal_bond` from `get_policy` (default 1 NEAR) and the vote threshold.

## 3. Check the chain against the offline numbers

```bash
near contract call-function as-read-only registry.<prefix>.testnet quote_settlement \
  json-args '{"period_id":"2026-Q4-workgroups"}' network-config testnet now
near contract call-function as-read-only registry.<prefix>.testnet get_ledger_hash \
  json-args '{"period_id":"2026-Q4-workgroups"}' network-config testnet now
```

Expect `17 -> 4`, `mutuality 0.8960`, and the hash printed by the generator.
The period id comes from the fixture: `2026-Q4-workgroups`.

## 4. Proposal

```bash
node src/cli/index.ts build-proposal --fixture out/workgroups.<prefix>.json \
  --dao <name>.sputnikv2.testnet --token token.<prefix>.testnet \
  --proposer <owner>.testnet --out out/proposal.json
node src/cli/index.ts build-proposal --fixture out/workgroups.<prefix>.json \
  --dao <name>.sputnikv2.testnet --token token.<prefix>.testnet \
  --proposer <owner>.testnet --add-proposal-args --out out/add-proposal.json
```

`out/add-proposal.json` is exactly the `add_proposal` argument
(`{"proposal":{"description","kind"}}`); `out/proposal.json` is the full envelope
for `report`. The generated `add_proposal` command attaches the bond (1 NEAR by
default; match `get_policy`). The returned number is the proposal id.

`act_proposal {"id":<n>,"action":"VoteApprove"}` needs **300 Tgas**: the four
`ft_transfer` calls run from the same transaction. With a one-member council the
approval executes it; save the transaction hash.

## 5. Confirm

`mark_settled` runs on the contract (the local `ssl settle` only updates an offline mirror):

```bash
near contract call-function as-transaction registry.<prefix>.testnet mark_settled \
  json-args '{"period_id":"2026-Q4-workgroups","proposal_id":"<id>","tx_hash":"<execute tx hash>"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as <owner>.testnet \
  network-config testnet sign-with-keychain send

node src/cli/index.ts verify --fixture out/workgroups.<prefix>.json \
  --rpc https://rpc.testnet.near.org --contract registry.<prefix>.testnet \
  --period 2026-Q4-workgroups

node src/cli/index.ts report --fixture out/workgroups.<prefix>.json \
  --out-dir out --proposal out/proposal.json --proposal-id <id> --tx <tx hash>
```

`verify` must print `OK`. Then check every group's `ft_balance_of` against the
net positions and fill the claims table in `README.md`.
