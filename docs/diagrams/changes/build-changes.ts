import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const svg = (name: string) => themeSvg(readFileSync(join(dir, `${name}.svg`), "utf8").trim());

// Bake the dark theme into the SVG: var() inside presentation attributes
// does not resolve reliably, so resolve every Pele variable now.
const themeSvg = (text: string) =>
  text
    .replace(/var\(--_fm\)/g, "monospace")
    .replace(/var\(--_fg\)/g, "#ece9df")
    .replace(/var\(--_bg\)/g, "#141412")
    .replace(/var\(--_m\)/g, "#a3a099")
    .replace(/var\(--_l\)/g, "#ece9df")
    .replace(/var\(--_s\)/g, "#1e1e1b")
    .replace(/var\(--_a\)/g, "#262622")
    .replace(/var\(--_b\)/g, "#3a3a34")
    .replace(/var\(--_c\)/g, "#6aa2e8")
    .replace(/var\(--_r\)/g, "4px");

type Status = "kept" | "modified" | "removed" | "added";
type Row = [string, string, string, Status];

const pair = (id: string, before: string, after: string) => `
    <div class="pair">
      <div class="pane"><h4>Before — your design</h4><div class="diagram">${svg(before)}</div></div>
      <div class="pane"><h4>After — as built</h4><div class="diagram">${svg(after)}</div></div>
    </div>`;

const table = (head: [string, string, string], rows: Row[]) => `
    <table>
      <thead><tr><th>${head[0]}</th><th>${head[1]}</th><th>${head[2]}</th></tr></thead>
      <tbody>
        ${rows.map(([a, b, c, s]) => `<tr class="${s}"><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join("\n        ")}
      </tbody>
    </table>`;

const fieldTable = (rows: Row[]) => table(["Field", "Initial design", "As built"], rows);
const behaviorTable = (rows: Row[]) => table(["Area", "Initial design", "As built"], rows);

const sections: string[] = [];

sections.push(`
    <section id="overview">
      <h2>1. Architecture overview</h2>
      <p>The six blocks survive intact. Providers narrow, the journal becomes one date, the aggregator dissolves into the builder, and two stored-output tables appear.</p>
      ${pair("overview", "overview-before", "overview-after")}
      ${table(["Component", "Initial design", "As built"], [
        ["Providers", "SimpleFIN / Plaid / MX / CSV / Bank", "SimpleFIN / CSV / Bank. No Plaid, no MX.", "modified"],
        ["Adapter", "TransactionProvider Interface + Adapters", "Same interface plus a provider-neutral ingest orchestrator.", "modified"],
        ["Manual Entry", "Direct writes", "Direct writes, unchanged.", "kept"],
        ["Accounts", "Accounts table", "Unchanged.", "kept"],
        ["Transactions", "Single account key, one timestamp", "Source plus destination keys, posted plus transaction times.", "modified"],
        ["Recurrence Rules", "Single account key, effective dates", "Source plus destination keys, start and end dates, priority, annual cap.", "modified"],
        ["Checkpoints", "Value, projection day, trial index", "Balance, provider column. Day derives from the instant. No trial index.", "modified"],
        ["Monte Carlo Statistics", "Per-account bands plus day", "Portfolio bands only. Day derives from the instant.", "modified"],
        ["Preprocessor", "Generate and order events", "Unchanged, plus registry volatility check.", "kept"],
        ["Projection Engine", "Apply events and constraints", "Computes the full window and writes the suffix.", "modified"],
        ["Monte Carlo Orchestrator", "Sample stochastic rules", "Frozen seed. Statistics only, no trial rows.", "modified"],
        ["Statistics Aggregator", "Trial results into statistics", "Dissolved into the builder. No separate component.", "removed"],
        ["Change Journal", "Journal of actual changes", "Replaced by your single dirty_from date decision.", "removed"],
        ["Projection Slices / Manifest", "Yearly slices plus manifest", "Unchanged shape. Prefix adopted, suffix rebuilt.", "kept"],
        ["Find first invalid slice", "Journal plus slices feed it", "Same logic, fed by the dirty date.", "modified"],
        ["Evaluation Reader", "Reads through ProjectionReader", "Assembles stored rows plus live history.", "modified"],
        ["Evaluation Simulator", "Isolated what-if inputs", "Unchanged path.", "kept"],
        ["ProjectionReader", "Serves transactions, checkpoints, statistics, slices", "Also serves stored evaluation outputs and projection rows. Canonical assemble, else compute.", "modified"],
      ])}
    </section>`);

sections.push(`
    <section id="transaction">
      <h2>2. Transaction table</h2>
      <p>One account key cannot express transfers, so the key split in two. Upstream identity stays in sync keys, and the public event rides along as JSON.</p>
      ${pair("transaction", "transaction-before", "transaction-after")}
      ${fieldTable([
        ["id", "uuid PK", "uuid PK", "kept"],
        ["account_id", "uuid FK", "Split in two, removed", "removed"],
        ["source_account_id", "—", "uuid FK, nullable", "added"],
        ["dest_account_ids", "—", "uuid list FK, nullable", "added"],
        ["occurred_at", "timestamptz", "Split in two, removed", "removed"],
        ["posted_time", "—", "int, occurrence midnight UTC", "added"],
        ["transaction_time", "—", "int, occurrence midnight UTC", "added"],
        ["amount", "decimal", "Replaced by a fixed descriptor, removed", "removed"],
        ["amount_resolution", "—", "json, fixed literal on generated rows", "added"],
        ["source_type", "open enum", "user, banksync, or projected, lowercase", "modified"],
        ["provider_connection_id", "uuid FK", "Removed, identity lives in sync keys", "removed"],
        ["external_id", "string", "Removed, identity lives in sync keys", "removed"],
        ["recurrence_rule_id", "uuid FK", "Removed, origin lives in the event JSON", "removed"],
        ["projection_slice_id", "uuid FK, nullable", "uuid FK, nullable", "kept"],
        ["applied_amount", "decimal", "decimal, equals the realized amount", "kept"],
        ["outcome", "open string", "fulfilled or unfulfilled", "modified"],
        ["event_json", "—", "json, the full public event", "added"],
      ])}
    </section>`);

sections.push(`
    <section id="checkpoint">
      <h2>3. Checkpoint table</h2>
      <p>Days derive from instants and trials never persist, so two columns go. The provider column is new: it preserves per-bridge same-instant isolation after sources unified to one spelling.</p>
      ${pair("checkpoint", "checkpoint-before", "checkpoint-after")}
      ${fieldTable([
        ["id, account_id", "uuid keys", "uuid keys", "kept"],
        ["as_of_at", "timestamptz", "timestamptz", "kept"],
        ["value", "decimal", "Renamed to balance, kept code term", "modified"],
        ["projection_day", "date", "Removed, derives from as_of_at", "removed"],
        ["trial_index", "int", "Removed, trials never persist", "removed"],
        ["source_type", "open enum", "user, banksync, or projected, lowercase", "modified"],
        ["provider", "—", "string, the supplying bridge", "added"],
        ["projection_slice_id", "uuid FK, nullable", "Removed, facts carry no slice", "removed"],
      ])}
    </section>`);

sections.push(`
    <section id="statistics">
      <h2>4. Monte Carlo statistics table</h2>
      <p>Bands need quartiles, so three percentile columns appear. Rows are portfolio-level only: per-account, per-trial persistence does not fit in memory at the 1,000-trial default.</p>
      ${pair("statistics", "statistics-before", "statistics-after")}
      ${fieldTable([
        ["id, slice, account, as_of_at", "keys", "keys, account empty means portfolio", "modified"],
        ["projection_day", "date", "Removed, derives from as_of_at", "removed"],
        ["sample_count", "int", "int, equals the run count", "kept"],
        ["mean, median, p10, p90", "decimals", "decimals", "kept"],
        ["p25, p50, p75", "—", "decimals, linear interpolation identical to the domain", "added"],
        ["std_dev", "decimal", "decimal, population deviation of samples", "kept"],
        ["probability_below_zero", "decimal", "decimal, fraction of samples below zero", "kept"],
      ])}
    </section>`);

sections.push(`
    <section id="state">
      <h2>5. Projection state and slices</h2>
      <p>The state gains its missing start plus the evaluation config record the reader matches on. Slices are byte-for-byte your shape.</p>
      ${pair("state", "state-before", "state-after")}
      ${fieldTable([
        ["id, scope, revision, published_revision", "ints and ids", "unchanged", "kept"],
        ["dirty_from", "timestamptz, earliest affected instant", "Unix instant, zero means clean", "modified"],
        ["projection_start", "missing", "date, frozen from the first request", "added"],
        ["horizon_end", "timestamptz", "date, start plus horizon years", "kept"],
        ["calendar_timezone, engine_version", "strings", "UTC and v1 defaults", "kept"],
        ["trial_count, stochastic_seed", "int plus seed", "1000 default, first seed wins", "kept"],
        ["det_evaluations_json", "—", "canonical request tables for the deterministic build", "added"],
        ["stoch_evaluations_json", "—", "canonical request tables for the stochastic build", "added"],
        ["slice id, state, from, to, revision, status", "as designed", "unchanged, status always ready", "kept"],
      ])}
    </section>`);

sections.push(`
    <section id="rules">
      <h2>6. Accounts and recurrence rules</h2>
      <p>Code terms won over renames to avoid churning every reader. Currency stays on bridge links and deletion stays hard with link memory.</p>
      ${pair("rules", "rules-before", "rules-after")}
      ${fieldTable([
        ["account name", "string", "string", "kept"],
        ["currency", "on account", "Not added, lives on account links", "removed"],
        ["min/max_value", "decimals", "Kept as min/max_balance with NoFloor and NoCeiling sentinels", "modified"],
        ["deleted_at", "timestamptz", "Not added, hard delete plus link memory kept", "removed"],
        ["rule account_id", "uuid FK", "Split into source plus destinations", "removed"],
        ["schedule, execution_order, amount_resolver", "as designed", "unchanged", "kept"],
        ["effective_from, effective_until", "timestamptz", "Kept as start_date and end_date", "modified"],
        ["priority, annual_cap", "—", "ordering plus yearly cap the kernel needs", "added"],
      ])}
    </section>`);

sections.push(`
    <section id="workflow">
      <h2>7. Recurrence workflow</h2>
      <p>Your flow runs verbatim. The boxes that changed are the ones that persist: baselines write per-date checkpoints, the runner writes statistics only, and the reader assembles instead of recomputing.</p>
      ${pair("workflow", "workflow-before", "workflow-after")}
    </section>`);

sections.push(`
    <section id="new-tables">
      <h2>8. New tables with no before</h2>
      <p>Eight tables have no counterpart in your design, one per evaluation plus the timeline rows. Each evaluation gets typed scalar and date columns; variable-length evidence stays verbatim JSON so served output is byte-identical. Projection rows exist because timeline flows and impacts cannot be rebuilt from checkpoints alone without re-simulation.</p>
      <div class="pair single"><div class="pane"><h4>As built — new</h4><div class="diagram">${svg("new-tables")}</div></div></div>
    </section>`);

sections.push(`
    <section id="behavior">
      <h2>9. Behavior rules</h2>
      <p>Every rule the diagrams imply but do not show.</p>
      ${behaviorTable([
        ["Trial count", "1,000 in the workflow", "1,000 default, canonical per state", "kept"],
        ["Seed", "per-request seed", "First seed wins and freezes, else one random draw persists", "modified"],
        ["Unseeded runs", "fresh draws", "Always compute fresh, never stored", "kept"],
        ["Compute scope", "full projection", "Full window compute, suffix-only persistence", "modified"],
        ["History storage", "unspecified", "Never persisted, replays live every read", "added"],
        ["Canonical request", "unspecified", "Stored model, empty overrides, no cut, matching settings, run count, seed, and evaluation tables", "added"],
        ["Non-canonical requests", "unspecified", "Compute directly through the existing kernels", "added"],
        ["Amount work vs simulation work", "interleaved in one transition call", "Prepare calculates the request from snapshots; Apply resolves, mutates, and records; impossible states live only in Apply", "modified"],
        ["Schedule expansion", "inline in the kernel", "Preprocessor owns the projection-window expansion; the engine consumes dated occurrences", "modified"],
        ["Empty Monte Carlo runs", "always N trials", "No volatile inputs simulates once and folds the path into every trial", "modified"],
        ["Evaluation outputs", "unspecified", "One typed table per evaluation; scalars typed, evidence verbatim JSON; empty tables need no rows", "added"],
        ["Dirty on sync", "unspecified", "The store owns the single mark in ApplySyncPlan; the orchestrator inherits invalidation through it", "added"],
        ["Writes that never dirty", "unspecified", "Account moves (position order only), evaluations, pins, presets, links, safe spending, empty account creates, empty sync runs", "added"],
        ["Dirty granularity", "unspecified", "Creates and checkpoints use their instant; updates, deletes, moves, conversions, claims, accounts, and terms dirty from projection start with no preceding read", "added"],
        ["Dirty beyond the horizon", "unspecified", "Refresh outputs, adopt the manifest, clear the flag, no row rewrites", "added"],
        ["Historical flag", "unspecified", "First-row-wins replicated so served bands match built bands", "added"],
        ["Rounding", "unspecified", "Domain rounding replicated so served output is byte-identical", "added"],
        ["Outcome vocabulary", "open string", "fulfilled or unfulfilled", "modified"],
        ["Slice status values", "open string", "Always ready", "modified"],
        ["Scope id", "open uuid", "The user resource id", "modified"],
        ["Concurrent builds", "shared-run registry", "Registry plus per-user singleflight; stale publish is a no-op, never stale data", "modified"],
        ["What-if", "isolated inputs", "Unchanged simulator path", "kept"],
        ["Position and balances", "live replay", "Bypass slices, unchanged", "kept"],
        ["Routes", "replace routes now", "Same URLs, new reader behind them; renaming stays mechanical follow-up", "modified"],
        ["Migration", "no migration logic", "Fresh setup required, noted for operators; no runtime fallback anywhere", "kept"],
      ])}
    </section>`);

sections.push(`
    <section id="removed">
      <h2>10. Removed with no after</h2>
      <p>Deleted outright per your no-legacy rule, with the tests updated to the new behavior.</p>
      ${table(["System", "What it did", "Replacement"], [
        ["projection_artifacts table", "Stored complete results by content hash", "Slices plus rows plus outputs keyed by state and date", "removed"],
        ["Artifact get and put", "Best-effort result storage", "Direct compute or slice assembly", "removed"],
        ["BaseModelHash and EvaluationsHash", "Full-model JSON plus SHA-256 identity", "Canonical settings match, no hashes", "removed"],
        ["Base-path and evaluation caches", "Cross-request memoized paths", "Removed, every miss computes", "removed"],
        ["Stored Projection-Source", "Served SQLite results as stored", "Computed for fresh builds, shared for attached streams", "removed"],
        ["Per-provider row sources", "simplefin and plaid spellings", "One banksync spelling plus provider column", "removed"],
        ["Statistics Aggregator box", "Trial results into statistics", "Builder writes statistics inline", "removed"],
        ["Change Journal", "Journal of actual changes", "Your single dirty_from date decision", "removed"],
      ])}
    </section>`);

const nav = [
  "overview", "transaction", "checkpoint", "statistics", "state",
  "rules", "workflow", "new-tables", "behavior", "removed",
]
  .map((id, i) => `<a href="#${id}">${i + 1}. ${id}</a>`)
  .join("\n      ");

const counts = (() => {
  const all = sections.join("\n");
  const count = (s: string) => all.split(`class="${s}"`).length - 1;
  return { kept: count("kept"), modified: count("modified"), removed: count("removed"), added: count("added") };
})();

const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Initial design versus as built</title>
    <style>
      :root {
        color-scheme: dark;
        --pele-bg: #141412;
        --pele-fg: #ece9df;
        --pele-muted: #a3a099;
        --pele-line: #ece9df;
        --pele-surface: #1e1e1b;
        --pele-surface-alt: #262622;
        --pele-border: #3a3a34;
        --pele-accent: #6aa2e8;
        --pele-font: system-ui, sans-serif;
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: #141412; color: #ece9df; font-family: system-ui, sans-serif; line-height: 1.5; }
      header { position: sticky; top: 0; background: #1e1e1b; border-bottom: 1px solid #3a3a34; padding: 12px 24px; z-index: 10; }
      header h1 { font-size: 18px; margin: 0 0 4px; }
      header p { margin: 0 0 8px; color: #a3a099; font-size: 14px; }
      nav { display: flex; flex-wrap: wrap; gap: 4px 16px; }
      nav a { color: #6aa2e8; text-decoration: none; font-size: 14px; }
      nav a:hover { text-decoration: underline; }
      main { max-width: 1200px; margin: 0 auto; padding: 24px; }
      section { margin-bottom: 56px; scroll-margin-top: 140px; }
      section h2 { font-size: 22px; margin: 0 0 4px; }
      section > p { color: #a3a099; margin: 0 0 16px; max-width: 90ch; }
      .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
      .pair.single { grid-template-columns: 1fr; }
      @media (max-width: 900px) { .pair { grid-template-columns: 1fr; } }
      .pane h4 { margin: 0 0 8px; font-size: 14px; color: #a3a099; font-weight: 600; }
      .diagram { background: #1e1e1b; border: 1px solid #3a3a34; border-radius: 8px; padding: 16px; overflow-x: auto; }
      .diagram svg { display: block; margin: 0 auto; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 8px; }
      th { text-align: left; color: #a3a099; font-weight: 600; padding: 8px 12px; border-bottom: 1px solid #3a3a34; }
      td { padding: 8px 12px; border-bottom: 1px solid #262622; vertical-align: top; }
      td:first-child { font-family: ui-monospace, monospace; font-size: 13px; white-space: nowrap; }
      tr.kept td:first-child { border-left: 3px solid #4caf50; }
      tr.modified td:first-child { border-left: 3px solid #ffb300; }
      tr.removed td:first-child { border-left: 3px solid #ef5350; }
      tr.added td:first-child { border-left: 3px solid #42a5f5; }
      tr.kept { background: rgba(76, 175, 80, 0.05); }
      tr.modified { background: rgba(255, 179, 0, 0.06); }
      tr.removed { background: rgba(239, 83, 80, 0.07); }
      tr.added { background: rgba(66, 165, 245, 0.07); }
      .legend { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 0 0 24px; font-size: 14px; }
      .legend span::before { content: ""; display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px; }
      .legend .kept::before { background: #4caf50; }
      .legend .modified::before { background: #ffb300; }
      .legend .removed::before { background: #ef5350; }
      .legend .added::before { background: #42a5f5; }
    </style>
  </head>
  <body>
    <header>
      <h1>Initial design versus as built</h1>
      <p>Your flowchart plus ERD against the implementation. Green kept, amber modified, red removed, blue added.</p>
      <nav>
      ${nav}
      </nav>
    </header>
    <main>
      <div class="legend">
        <span class="kept">Kept (${counts.kept})</span>
        <span class="modified">Modified (${counts.modified})</span>
        <span class="removed">Removed (${counts.removed})</span>
        <span class="added">Added (${counts.added})</span>
      </div>
${sections.join("\n")}
    </main>
  </body>
</html>
`;

writeFileSync(join(dir, "changes.html"), html.replace(/[ \t]+\n/g, "\n").trimEnd() + "\n");
console.log(`wrote changes.html (${html.length} bytes)`);
