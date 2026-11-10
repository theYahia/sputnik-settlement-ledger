# Sputnik Settlement Ledger

A community with a shared Sputnik treasury tracks who owes what in a spreadsheet and pays by
hand. Nothing ties the payout back to the record. Settlement Ledger records obligations
on-chain, computes net positions, compiles them into a single Sputnik proposal, and emits a
report anyone can re-run and re-verify against the on-chain ledger hash.

**Why not a spreadsheet?** A spreadsheet can net numbers too. What it cannot do is bind the
record to the execution: here the close of a period freezes a canonical ledger hash, the
proposal description carries that hash, the DAO executes the exact actions compiled from it,
and `verify` recomputes the hash from the records. A third party can check the payout was the
one the ledger implied — without trusting the operator.

**What this is not.** We don't batch — Sputnik already does. We compile a ledger into the
batch, deterministically and verifiably. Custody and approvals stay in Sputnik; we add no
signing path.

```
obligations → close (ledger hash) → quote (net positions) → proposal (ft_transfer batch) → execute → verify
```

## Quickstart (offline, no keys, no network)

Requires Node >= 22.18 (native TypeScript execution) and nothing else.

```bash
npm install --ignore-scripts   # Windows: the SDK toolchain is Linux/macOS-only
npm test                 # 60 tests: invariants, contract logic, golden proposal, CLI, reports
npm run typecheck        # app + contract typecheck

node src/cli/index.ts quote --fixture fixtures/star.json
node src/cli/index.ts quote --fixture fixtures/workgroups.json
node src/cli/index.ts report --fixture fixtures/workgroups.json --out-dir out
node src/cli/index.ts build-proposal --fixture fixtures/workgroups.json \
  --dao ledger-dao.testnet --token ledger-token.testnet --out out/proposal.json
```

### The demo claim: the tool says when it is useless

`fixtures/star.json` is a treasury paying four working groups with nothing flowing back:

```
payouts       4 -> 4  (reduced set, greedy, <= n-1)
value moved   2750000000000000000000 -> 2750000000000000000000
mutuality     0.0000
note          netting saves nothing here, use a plain bulk payout
```

`fixtures/workgroups.json` is one treasury whose working groups owe each other:

```
payouts       17 -> 4
value moved   625000000000000000000 -> 65000000000000000000
mutuality     0.8960
disputed      ob-18 (excluded)
```

Both axes are reported because either alone is easy to game: counting only transfers hides the
case where the same money still moves, counting only volume hides the case where far fewer
payouts are needed. The star fixture scores zero on both and the tool says so.

## do X — see Y

| Do this | See | What it proves |
|---|---|---|
| `npm test` | `tests/settlement.invariants.test.ts` | Σ net = 0, Σ positive nets = value moved, transfers ≤ n−1, nobody pays more than their debit, no non-positive transfer, permutation-invariant, disputed records never move money |
| `npm test` | `tests/settlement.star.test.ts` | a star scores `mutuality 0.0000`, `transfers k → k`, and emits the honest advice string |
| `npm test` | `tests/registry.test.ts` | owner-only close, member-only records, outsider rejected, frozen hash, closed periods immutable, quote parity across the JSON persistence boundary |
| `npm test` | `tests/proposal.golden.test.ts` | fixture → exactly one proposal JSON payload, byte for byte; one `ft_transfer` per payout; memo carries the period |
| `npm test` | `tests/verify.test.ts` | substituting one record or flipping one dispute flag fails verification; an on-chain quote that drifts from the offline one fails |
| `npm test` | `tests/report.test.ts` | one self-contained HTML file, Markdown twin, bulk-payout CSV, escaped memo text |
| `npm test` | `tests/cli.test.ts` | record → dispute → close → quote → settle, plus `report` and `verify` exit codes end to end |
| `npm test` | `tests/testnet-commands.test.ts` | the testnet command generator renames the fixture to your accounts, signs each record as its obligor, and `add_proposal` args are exactly `description` + `kind` |
| `npm test` | `tests/ft.test.ts` | the demo token refuses transfers to accounts without `storage_deposit` |
| `npm run build:bundle` | `build/registry.js` | the near-sdk-js bundle builds with the bindgen exporter (works on Windows; wasm link needs Linux) |
| `npm run verify -- --rpc …` | `src/verify/verify.ts`, `src/chain/rpc.ts` | live contract hash and records match the local ledger and the offline quote |

## Architecture

```
src/ledger/      obligation model, canonical serialization, SHA-256, period registry logic
src/settlement/  pure functions: net positions, greedy reduction, quote (both axes)
src/proposal/    ledger → Sputnik FunctionCall proposal compiler
src/report/      HTML / Markdown / CSV renderers
src/verify/      hash and quote reconciliation
src/chain/       minimal RPC view caller (no signing, no client library)
src/cli/         the `ssl` command
src/contract/    near-sdk-js shims: registry and a minimal NEP-141 token
src/ft/          token core, testable offline
fixtures/        the star case, the mutual case, the golden proposal
tests/           node:test + fast-check, all offline
docs/            testnet runbook (stage 4, human gate)
```

The contract and the CLI import **the same** settlement modules. There is no second
implementation of netting anywhere, which is why `quote_settlement` cannot drift from
`ssl quote`. `tests/registry.test.ts` asserts that parity through the same JSON boundary the
contract uses to persist state.

### Contract methods

| Method | Kind | Access |
|---|---|---|
| `init(owner)` | init | once |
| `create_period(period_id, members)` | change | owner |
| `record_obligation(period_id, from, to, amount, memo)` | change | period member |
| `dispute_obligation` / `undispute_obligation` | change | member or owner, open period only |
| `close_period(period_id)` | change | owner; freezes `ledger_hash`, makes records immutable |
| `mark_settled(period_id, proposal_id, tx_hash)` | change | owner, after execution |
| `quote_settlement(period_id)` | view | anyone; requires a closed period |
| `get_period`, `list_obligations`, `get_ledger_hash`, `get_owner` | view | anyone |

## Boundaries

- **A reduced set, not a minimal one.** Minimum-cardinality settlement is NP-hard (partition
  into zero-sum subsets). The greedy reduction is deterministic (tie-break by account id) and
  bounded by `n−1` transfers for `n` non-zero positions. Exact minimization is out of scope.
- **Atomicity only for one contract.** The batch is atomic because every action calls the same
  NEP-141 contract. Native NEAR transfers to several receivers are not atomic and are not an
  execution path here.
- **No custody, no multisig.** The contract holds records, not funds; it has no transfer or
  signing method. Rules say "don't rebuild the multisig", and we don't.
- **No cross-token netting.** That needs an oracle or swap and takes FX risk at settlement time.
- **No dispute machinery beyond a flag.** A disputed record is excluded from settlement and
  stays in the hash. Disputes close with the period; reopening a period is a new period.
- **No policy engine.** Tiers, auto-approval, spending limits are a different product.
- **Trezu integration is out of scope; we export a CSV compatible with bulk payouts.**
- **`settled on time` is narrow by design**: of the records naming an account, how many were
  not disputed at close. It says nothing about wall-clock time or payment order.

## Status and what remains unproven

- Offline: complete and green (`npm test`, `npm run typecheck`).
- Wasm build and the sandbox run need Linux/macOS: `npm run build:contract` and
  `npm run test:sandbox` (see `docs/RUNBOOK-testnet.md`). On Windows only the JS bundle is
  built (`npm run build:bundle`).
- Testnet deployment, the DAO proposal, and the executed transaction are **pending a human
  gate**; the runbook is the checklist. Until they exist, the claims table below has no tx
  hashes, and this README does not pretend otherwise.
- **Demand is unproven.** No interviews were conducted. The share of mutual obligations inside
  real DAOs is unmeasured — which is exactly why the product reports when netting is useless.
- **An off-chain competitor** (Splitwise / Settle Up) solves the reconciliation problem more
  conveniently and without revealing the graph of financial relationships. The addition here is
  verifiable binding between record and execution, not convenience.

## Claims → file → test → tx

| Claim | File | Test | Tx |
|---|---|---|---|
| Net positions always sum to zero | `src/settlement/net-positions.ts` | `tests/settlement.invariants.test.ts` (invariant 1) | — |
| Settlement never needs more than n−1 transfers | `src/settlement/reduce.ts` | invariant 3 | — |
| A star ledger saves exactly nothing, and says so | `src/settlement/quote.ts` | `tests/settlement.star.test.ts` | — |
| Disputed records never move money | `src/settlement/net-positions.ts` | invariants 7, `tests/registry.test.ts` | — |
| The ledger hash is canonical and order-independent | `src/ledger/canonical.ts`, `src/ledger/hash.ts` | `tests/ledger.hash.test.ts` | — |
| Editing one record breaks verification | `src/verify/verify.ts` | `tests/verify.test.ts` | — |
| A ledger compiles to one deterministic proposal | `src/proposal/build.ts` | `tests/proposal.golden.test.ts` | — |
| On-chain quote equals the offline quote | `src/ledger/registry.ts` | `tests/registry.test.ts` | — |
| The registry rejects non-member records | `src/ledger/registry.ts` | `tests/registry.test.ts` | — |
| The batch is atomic for one token contract | `src/proposal/build.ts` | `tests/proposal.golden.test.ts` (single receiver for all actions) | — |
| `ft_transfer` fails without `storage_deposit` | `src/ft/token.ts` | `tests/ft.test.ts` | — |
| Verification passes against the deployed contract | `src/verify/verify.ts` | pending stage 4 | — |

## Commands

```
ssl init --store <file> --owner <account>
ssl create-period --store <file> --period <id> --members a,b,c
ssl record --store <file> --period <id> --from a --to b --amount <minimal-units> --memo text
ssl dispute|undispute --store <file> --period <id> --obligation ob-1
ssl close --store <file> --period <id>
ssl settle --store <file> --period <id> --proposal <id> --tx <hash>
ssl quote --fixture <file> [--json] | ssl quote --store <file> --period <id>
ssl build-proposal --fixture <file> --dao <account> --token <account> [--out <file>]
ssl report --fixture <file> --out-dir <dir> [--proposal <file>] [--tx <hash> --proposal-id <id>]
ssl verify --fixture <file> --expected <hash>
ssl verify --fixture <file> --store <file> --period <id>
ssl verify --fixture <file> --rpc <url> --contract <account> --period <id>
```

Amounts are integers in the token's minimal units. No floating point touches the settlement
path. `record` also prints the equivalent `near-cli-rs` call, because the local mirror is a
mirror, not the source of truth.

## Built during NEAR HACKATHON

Everything in this repository was written inside the hackathon window (2026-10-19 to 2026-11-14)
by one person working with an AI coding assistant; a large share of the code and tests was
AI-generated and then reviewed and run by the author. Libraries: `near-sdk-js` (contracts),
`fast-check` (property tests), `typescript`, `@types/node`. No code from earlier projects.

## NEAR's role

- Named accounts are the signers of ledger records: each `record_obligation` is signed by the
  obligor, so an entry is attributed, not an anonymous spreadsheet row.
- The payout is a Sputnik `FunctionCall` proposal with all `ft_transfer` actions against one
  NEP-141 contract, which makes the batch atomic.
- The ledger hash frozen at `close_period` is written into the proposal description, so voters
  and verifiers can tie the execution to the record.

## License

MIT.

