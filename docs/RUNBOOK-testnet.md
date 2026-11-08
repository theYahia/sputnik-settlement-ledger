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

## 1. Accounts

Use one treasury prefix so the demo reads clearly.

```bash
near account create-account fund-myself registry.<prefix>.testnet '5 NEAR' \
  const '100 Tgas' sign-as <funded>.testnet network-config testnet sign-with-keychain send
near account create-account fund-myself token.<prefix>.testnet '5 NEAR' ...
```

Working-group accounts used by `fixtures/workgroups.json` (substitute your
prefix): `design`, `devrel`, `events`, `infra`, `ops`, `research`.

## 2. Token

```bash
near contract deploy token.<prefix>.testnet use-file build/ledger-token.wasm \
  with-init-call init json-args \
  '{"owner":"<dao>","name":"Settlement Ledger Token","symbol":"SLT","decimals":18}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as <owner> network-config testnet sign-with-keychain send
```

`storage_deposit` for every recipient **before** the batch. This is the step
that a plain bulk payout silently skips and then fails on:

```bash
for acct in <dao> design.<prefix>.testnet devrel.<prefix>.testnet \
            events.<prefix>.testnet infra.<prefix>.testnet \
            ops.<prefix>.testnet research.<prefix>.testnet; do
  near contract call-function as-transaction token.<prefix>.testnet storage_deposit \
    json-args "{\"account_id\":\"$acct\"}" prepaid-gas '30 Tgas' \
    attach-deposit '0.00125 NEAR' sign-as <owner> network-config testnet sign-with-keychain send
done
```

Fund the treasury:

```bash
near contract call-function as-transaction token.<prefix>.testnet mint \
  json-args '{"account_id":"<dao>","amount":"10000000000000000000000"}' \
  prepaid-gas '30 Tgas' attach-deposit '0 NEAR' sign-as <token owner> ...
```

## 3. Registry

```bash
near contract deploy registry.<prefix>.testnet use-file build/registry.wasm \
  with-init-call init json-args '{"owner":"<dao>"}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as <owner> ...
```

Create a period. Members are the only accounts allowed to record obligations;
`close_period` and `mark_settled` are owner-only.

```bash
near contract call-function as-transaction registry.<prefix>.testnet create_period \
  json-args '{"period_id":"2026-Q4","members":["design.<prefix>.testnet","devrel.<prefix>.testnet","events.<prefix>.testnet","infra.<prefix>.testnet","ops.<prefix>.testnet","research.<prefix>.testnet"]}' \
  prepaid-gas '100 Tgas' attach-deposit '0 NEAR' sign-as <dao> ...
```

Record the fixture obligations. Each record must be signed by a member: this is
the "named accounts" property — the ledger entry is attributed to an account,
not to an anonymous row in a spreadsheet.

```bash
near contract call-function as-transaction registry.<prefix>.testnet record_obligation \
  json-args '{"period_id":"2026-Q4","from":"design.<prefix>.testnet","to":"infra.<prefix>.testnet","amount":"40000000000000000000","memo":"shared CI minutes, October"}' \
  prepaid-gas '100 Tgas' attach-deposit '0 NEAR' sign-as design.<prefix>.testnet ...
# ... repeat for every obligation in fixtures/workgroups.json
# then the disputed one:
near contract call-function as-transaction registry.<prefix>.testnet dispute_obligation \
  json-args '{"period_id":"2026-Q4","obligation_id":"ob-18"}' ... sign-as <member> ...
```

Close and read the numbers back from the chain:

```bash
near contract call-function as-transaction registry.<prefix>.testnet close_period \
  json-args '{"period_id":"2026-Q4"}' ... sign-as <dao> ...
near contract call-function as-read-only registry.<prefix>.testnet quote_settlement \
  json-args '{"period_id":"2026-Q4"}' network-config testnet now
near contract call-function as-read-only registry.<prefix>.testnet get_ledger_hash \
  json-args '{"period_id":"2026-Q4"}' network-config testnet now
```

`quote_settlement` must return the same numbers as `ssl quote --fixture`:
`17 -> 4` payouts, `625… -> 65…` value moved, `mutuality 0.8960`.

## 4. DAO and proposal

Create the DAO with the `sputnik-dao.near` factory on testnet (council = one
account is enough for the demo), then build the proposal locally:

```bash
node src/cli/index.ts build-proposal \
  --fixture fixtures/workgroups.json \
  --dao <dao> --token token.<prefix>.testnet --proposer <proposer> \
  --out out/proposal.json
```

Post it. `add_proposal` takes `{"proposal": <the object from out/proposal.json
without the outer "proposal" wrapper>}` — Sputnik's `ProposalInput` wants
`description`, `kind`, and an optional `link`. Approve with
`act_proposal {"id":<n>,"action":"VoteApprove"}`; Sputnik executes the actions
when the policy threshold is met.

## 5. Confirm

```bash
node src/cli/index.ts mark_settled --store out/state.json --period 2026-Q4 \
  --proposal <proposal id> --tx <execute tx hash>

node src/cli/index.ts verify \
  --fixture fixtures/workgroups.json \
  --rpc https://rpc.testnet.near.org \
  --contract registry.<prefix>.testnet \
  --period 2026-Q4

node src/cli/index.ts report --fixture fixtures/workgroups.json \
  --out-dir out --proposal out/proposal.json \
  --proposal-id <id> --tx <tx hash>
```

`verify` must print `OK` and the report must show the same ledger hash and the
same payouts. Then check every recipient's `ft_balance_of` against the net
positions, and fill the claims table in `README.md`.
