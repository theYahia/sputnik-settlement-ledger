import type { Obligation, Quote } from "../ledger/types.ts";
import type { ProposalEnvelope } from "../proposal/build.ts";

/**
 * Reconciliation report.
 *
 * One self-contained HTML file plus Markdown and CSV, because the three
 * audiences differ: a judge opens the HTML, a maintainer diffs the Markdown,
 * and a treasury operator feeds the CSV to a bulk payout tool.
 *
 * Everything in the report is derived from the ledger and the quote that was
 * hashed into `ledger_hash`; nothing is typed by hand.
 */

export interface ReportInput {
  readonly periodId: string;
  readonly tokenId: string;
  readonly decimals: number;
  readonly obligations: readonly Obligation[];
  readonly quote: Quote;
  readonly ledgerHash: string;
  readonly proposal?: ProposalEnvelope;
  /** Optional on-chain execution facts, filled after the DAO executes. */
  readonly execution?: {
    readonly proposalId: string;
    readonly txHash: string;
  } | null;
  readonly explorerBase?: string;
}

export interface ParticipantScore {
  readonly account: string;
  readonly settledOnTime: number;
  readonly total: number;
}

/**
 * "Settled on time" is defined narrowly and stated in the report legend:
 * of the records naming an account, how many were not disputed at close.
 * It is not a statement about wall-clock time or payment order.
 */
export function participantScores(obligations: readonly Obligation[]): ParticipantScore[] {
  const totals = new Map<string, { settledOnTime: number; total: number }>();
  for (const o of obligations) {
    for (const account of [o.from, o.to]) {
      const entry = totals.get(account) ?? { settledOnTime: 0, total: 0 };
      entry.total += 1;
      if (!o.disputed) entry.settledOnTime += 1;
      totals.set(account, entry);
    }
  }
  return [...totals.entries()]
    .map(([account, { settledOnTime, total }]) => ({ account, settledOnTime, total }))
    .sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
}

export function renderMarkdown(input: ReportInput): string {
  const { quote: q } = input;
  const lines: string[] = [];
  lines.push(`# Settlement report — ${input.periodId}`, "");
  lines.push(`- Token: \`${input.tokenId}\` (${input.decimals} decimals)`);
  lines.push(`- Ledger hash: \`${input.ledgerHash}\``);
  lines.push(`- Participants with a net position: ${q.participants}`);
  lines.push(`- Payouts: **${q.baselineTransferCount} → ${q.transferCount}** (reduced set, greedy, ≤ n−1)`);
  lines.push(`- Value moved: **${q.gross} → ${q.movedNet}** minimal units`);
  lines.push(`- Mutuality: **${q.mutuality}**`);
  if (q.advice !== null) lines.push(`- Note: ${q.advice}`);
  if (input.execution) {
    lines.push(`- DAO proposal: ${input.execution.proposalId}, tx \`${input.execution.txHash}\``);
  }
  lines.push("");

  lines.push("## Net positions", "", "| account | net |", "|---|---:|");
  for (const p of q.netPositions) lines.push(`| \`${p.account}\` | ${p.net} |`);
  lines.push("");

  lines.push("## Payouts", "", "| from | to | amount |", "|---|---|---:|");
  for (const t of q.transfers) lines.push(`| \`${t.from}\` | \`${t.to}\` | ${t.amount} |`);
  lines.push("");

  if (q.excludedDisputed.length > 0) {
    lines.push("## Disputed records (excluded from settlement)", "");
    for (const o of input.obligations.filter((x) => x.disputed)) {
      lines.push(`- \`${o.id}\`: ${o.from} → ${o.to}, ${o.amount} — ${o.memo}`);
    }
    lines.push("");
  }

  lines.push(
    "## Settled on time (records not disputed at close)",
    "",
    "| account | settled on time |",
    "|---|---|",
  );
  for (const score of participantScores(input.obligations)) {
    lines.push(`| \`${score.account}\` | ${score.settledOnTime}/${score.total} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderCsv(input: ReportInput): string {
  const rows = ["from,receiver_id,amount,memo"];
  for (const t of input.quote.transfers) {
    rows.push([csvField(t.from), csvField(t.to), t.amount.toString(10), csvField(input.periodId)].join(","));
  }
  return `${rows.join("\n")}\n`;
}

export function renderHtml(input: ReportInput): string {
  const { quote: q } = input;
  const explorer = input.explorerBase ?? "https://testnet.nearblocks.io/txns/";
  const disputed = input.obligations.filter((o) => o.disputed);
  const scores = participantScores(input.obligations);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Settlement report — ${escapeHtml(input.periodId)}</title>
<style>
:root { color-scheme: light dark; --fg:#111; --muted:#666; --line:#ddd; --accent:#0b6; }
* { box-sizing: border-box; }
body { margin:0 auto; max-width: 68rem; padding:2rem 1.25rem 4rem; font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; color:var(--fg); }
h1 { font-size:1.6rem; margin:0 0 .25rem; }
h2 { font-size:1.1rem; margin:2rem 0 .5rem; }
p.lede { color:var(--muted); margin:0 0 1.5rem; }
.grid { display:grid; gap:.75rem; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr)); }
.card { border:1px solid var(--line); border-radius:.6rem; padding:.85rem 1rem; }
.card .k { color:var(--muted); font-size:.78rem; text-transform:uppercase; letter-spacing:.04em; }
.card .v { font-size:1.25rem; font-variant-numeric:tabular-nums; margin-top:.2rem; }
table { border-collapse:collapse; width:100%; }
th,td { text-align:left; padding:.4rem .55rem; border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums; }
th { color:var(--muted); font-weight:600; font-size:.8rem; text-transform:uppercase; letter-spacing:.03em; }
td.num,th.num { text-align:right; }
code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.86em; word-break:break-all; }
.note { border-left:3px solid var(--accent); padding:.5rem .8rem; background:color-mix(in srgb, var(--accent) 8%, transparent); }
.legend { color:var(--muted); font-size:.85rem; }
</style>
</head>
<body>
<h1>Settlement report — ${escapeHtml(input.periodId)}</h1>
<p class="lede">Token <code>${escapeHtml(input.tokenId)}</code> · ${input.decimals} decimals · ledger <code>${escapeHtml(input.ledgerHash)}</code></p>

<div class="grid">
  <div class="card"><div class="k">Payouts (baseline → reduced set)</div><div class="v">${q.baselineTransferCount} → ${q.transferCount}</div></div>
  <div class="card"><div class="k">Value moved (gross → net)</div><div class="v">${q.gross} → ${q.movedNet}</div></div>
  <div class="card"><div class="k">Mutuality</div><div class="v">${q.mutuality}</div></div>
  <div class="card"><div class="k">Participants</div><div class="v">${q.participants}</div></div>
</div>
${q.advice === null ? "" : `<p class="note">${escapeHtml(q.advice)}</p>`}
${input.execution ? `<p>Executed by DAO proposal <strong>${escapeHtml(input.execution.proposalId)}</strong>, transaction <a href="${escapeHtml(explorer + input.execution.txHash)}"><code>${escapeHtml(input.execution.txHash)}</code></a>.</p>` : ""}

<h2>Net positions</h2>
<table><thead><tr><th>Account</th><th class="num">Net (minimal units)</th></tr></thead><tbody>
${q.netPositions.map((p) => `<tr><td><code>${escapeHtml(p.account)}</code></td><td class="num">${p.net}</td></tr>`).join("\n")}
</tbody></table>

<h2>Payouts (reduced set)</h2>
<p class="legend">Greedy reduction of net positions. The minimum is NP-hard, so this is a reduced set, bounded by n−1 transfers for n non-zero positions.</p>
<table><thead><tr><th>From</th><th>To</th><th class="num">Amount</th></tr></thead><tbody>
${q.transfers
  .map(
    (t) =>
      `<tr><td><code>${escapeHtml(t.from)}</code></td><td><code>${escapeHtml(t.to)}</code></td><td class="num">${t.amount}</td></tr>`,
  )
  .join("\n")}
</tbody></table>

<h2>Disputed records (excluded from settlement)</h2>
${
  disputed.length === 0
    ? `<p class="legend">None.</p>`
    : `<table><thead><tr><th>Record</th><th>From</th><th>To</th><th class="num">Amount</th><th>Memo</th></tr></thead><tbody>
${disputed
  .map(
    (o) =>
      `<tr><td><code>${escapeHtml(o.id)}</code></td><td><code>${escapeHtml(o.from)}</code></td><td><code>${escapeHtml(o.to)}</code></td><td class="num">${o.amount}</td><td>${escapeHtml(o.memo)}</td></tr>`,
  )
  .join("\n")}
</tbody></table>`
}

<h2>Settled on time</h2>
<p class="legend">Of the records naming an account, how many were not disputed at close. Not a statement about wall-clock time or payout order.</p>
<table><thead><tr><th>Account</th><th class="num">Settled on time</th></tr></thead><tbody>
${scores.map((s) => `<tr><td><code>${escapeHtml(s.account)}</code></td><td class="num">${s.settledOnTime}/${s.total}</td></tr>`).join("\n")}
</tbody></table>
</body>
</html>
`;
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
