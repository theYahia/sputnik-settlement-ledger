# Submission checklist

Human gates are marked **[gate]**. Nothing here is executed by an agent without
explicit confirmation.

- [ ] Re-read the live hackathon rules immediately before submitting (last check: 2026-11-08).
- [ ] `npm test` green offline; `npm run typecheck` green. Both commands in `README.md`.
- [ ] Repository public before 2026-11-14T23:59Z. **[gate]**
- [ ] LICENSE present (MIT) — `LICENSE`.
- [ ] Project name collision checked: `sputnik-settlement-ledger` had no GitHub name match on
      2026-11-08.
- [ ] No rejected wording anywhere: search for `73%`, `minimal set`, `Trezu API`, `business`
      in the repo and in the repository description.
- [ ] Testnet runbook executed and its hashes recorded in the claims table
      (`docs/RUNBOOK-testnet.md`, `README.md`). **[gate: deploy, spend]**
- [ ] Demo video, in this order:
      1. star fixture → `quote` → `mutuality 0.0000`, `transfers k → k`, the advice line;
      2. mutual fixture → `quote` → both axes improve;
      3. `build-proposal` → one DAO proposal → vote → execution → `report` → `verify`.
- [ ] Demo post on X with **video**, @NEARProtocol, #NEARHackathon. **[gate]**
- [ ] Application payload shown to the human in full; `tracks: ["social", "realworld"]`;
      `requestId` generated once; not submitted twice. **[gate]**
- [ ] Remove local research exports containing personal data (`%LOCALAPPDATA%\lants-x-search`)
      once the submission is filed.

## Pre-submission wording audit

Run from the repository root; every match must be intentional and defensible:

```bash
grep -rn "73%\|minimal set\|Trezu API" --include="*.ts" --include="*.md" --include="*.json" .
```

Allowed phrasings: `reduced set`, `≤ n−1, greedy; exact minimization is NP-hard, out of scope`,
`Trezu integration is out of scope; we export a CSV compatible with bulk payouts`.
