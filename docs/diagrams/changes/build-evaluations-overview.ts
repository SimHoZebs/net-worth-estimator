import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
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
const svg = (name: string) => themeSvg(readFileSync(join(dir, `${name}.svg`), "utf8").trim());

const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Evaluations — ERDs, Sequence, and Flow (Pele)</title>
    <style>
      :root { color-scheme: dark; --pele-bg:#141412; --pele-fg:#ece9df; --pele-muted:#a3a099; --pele-line:#ece9df; --pele-surface:#1e1e1b; --pele-surface-alt:#262622; --pele-border:#3a3a34; --pele-accent:#6aa2e8; --pele-font:system-ui,sans-serif; }
      *{box-sizing:border-box}
      body{margin:0;background:#141412;color:#ece9df;font-family:system-ui,sans-serif;line-height:1.5}
      header{background:#1e1e1b;border-bottom:1px solid #3a3a34;padding:12px 24px}
      header h1{font-size:18px;margin:0 0 4px}
      header p{margin:0;color:#a3a099;font-size:14px;max-width:100ch}
      main{max-width:1200px;margin:0 auto;padding:24px}
      section{margin-bottom:40px}
      section h2{font-size:20px;margin:0 0 4px}
      section p{color:#a3a099;margin:0 0 16px;max-width:90ch}
      .pair{display:grid;grid-template-columns:1fr;gap:16px;margin-bottom:16px}
      .pair.single{grid-template-columns:1fr}
      .pane h4{margin:0 0 8px;font-size:14px;color:#a3a099;font-weight:600}
      .diagram{background:#1e1e1b;border:1px solid #3a3a34;border-radius:8px;padding:16px;overflow-x:auto}
      .diagram svg{display:block;margin:0 auto;max-width:100%;height:auto}
      .legend{display:flex;gap:16px;font-size:14px;color:#a3a099;margin:0 0 16px}
      .legend span::before{content:"";display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px}
      .legend .kept::before{background:#4caf50}
      .legend .modified::before{background:#ffb300}
      .legend .added::before{background:#42a5f5}
      table{width:100%;border-collapse:collapse;font-size:14px}
      td,th{padding:8px 12px;border-bottom:1px solid #262622;text-align:left;vertical-align:top}
      th{color:#a3a099}
      td:first-child{font-family:ui-monospace,monospace;font-size:13px;white-space:nowrap}
      tr.kept td:first-child{border-left:3px solid #4caf50}
      tr.modified td:first-child{border-left:3px solid #ffb300}
      tr.added td:first-child{border-left:3px solid #42a5f5}
    </style>
  </head>
  <body>
    <header><h1>Evaluations — ERDs, Sequence, and Flow</h1><p>Generated with <code>@simhozebs/pele-cli@0.1.1</code> from <code>er-*.mmd</code>, <code>seq-*.mmd</code>, <code>flow-*.mmd</code> in this folder. Three views: storage (ERD), lifecycles (sequence), and evaluator wiring (flow). The last section contrasts current evaluators with background analysis.</p></header>
    <main>
      <section id="erds">
        <h2>1. Storage — ERDs (kept / added)</h2>
        <p>Left: evaluation storage (projection manifest + 7 outputs). Right: analysis storage (evidence + runs + findings + feedback + promotions). They share only <code>users(id)</code>; no join between <code>projection_states</code> and <code>analysis_*</code> exists.</p>
        <div class="pair">
          <div class="pane"><h4>Evaluation — projection + envelopes (kept, amber)</h4><div class="diagram">${svg("er-evaluation-storage")}</div></div>
          <div class="pane"><h4>Analysis — evidence + findings + feedback (added, blue)</h4><div class="diagram">${svg("er-analysis-storage")}</div></div>
        </div>
      </section>
      <section id="sequence">
        <h2>2. Lifecycles — Sequence (modified / added)</h2>
        <p>Top-left: before (sync per-request, path assumed present). Top-right: after (same chain, optional path + dependents gate). Bottom: background analysis (async worker, never touches the projection pipeline).</p>
        <div class="pair">
          <div class="pane"><h4>Before — sync per request (modified)</h4><div class="diagram">${svg("seq-evaluation-before")}</div></div>
          <div class="pane"><h4>After — optional path, no worker (modified/added)</h4><div class="diagram">${svg("seq-evaluation-after")}</div></div>
        </div>
        <div class="pair single"><div class="pane"><h4>Background Analysis (added, blue)</h4><div class="diagram">${svg("seq-analysis")}</div></div></div>
      </section>
      <section id="flow">
        <h2>3. Evaluator wiring — Flowchart (kept)</h2>
        <p>All seven shipped evaluators share one runtime: <code>FinancialModel + EvaluationTables → Prepare → Simulate → BuildProjectionPath → EvaluateDeterministic (one pass, input order) → EvaluationResultTables → shared renderer → 7 outputs → Frontend</code>. Readers (green/amber) and Simulators (amber) both consume <code>EvaluationTimeline</code>; stochastic evaluators also need <code>MonteCarloSample</code>.</p>
        <div class="pair single"><div class="pane"><h4>Seven evaluators → one renderer</h4><div class="diagram">${svg("flow-evaluation-creation")}</div></div></div>
      </section>
      <section id="contrast">
        <h2>4. Current evaluator vs Analysis — contrast</h2>
        <table>
          <tr><th>Dimension</th><th>Evaluation Reader</th><th>Background Analysis</th></tr>
          <tr class="modified"><td>Question</td><td>Forecast: will goal cross on this projection?</td><td>Evidence: what can we infer from saved bank facts?</td></tr>
          <tr class="added"><td>Input</td><td><code>EvaluationContext{Timeline,Model,Sample}</code></td><td><code>AnalysisSnapshot{Revision,Transactions}</code> (facts: Description/Payee/Memo)</td></tr>
          <tr class="modified"><td>Lifecycle</td><td>sync per request; builder is sole recomputer</td><td>async 15s worker, 60s lease, 30s backoff, superseded, 20s deadline</td></tr>
          <tr class="added"><td>Storage</td><td>7 <code>*_outputs</code> envelopes at <code>built_revision</code></td><td><code>analysis_* + transaction_source_facts</code> (identity, dismissed, review, promotions)</td></tr>
          <tr class="kept"><td>Freshness signal</td><td><code>revision/published_revision/dirty_from</code></td><td><code>analysis_inputs.revision</code> (fact triggers)</td></tr>
          <tr class="added"><td>Trigger</td><td>frontend fetch / non-canonical params</td><td>fact insert/update/delete, pending/void flip</td></tr>
        </table>
      </section>
    </main>
  </body>
</html>
`;
writeFileSync(join(dir, "evaluations-overview.html"), html.replace(/[ \t]+\n/g, "\n").trimEnd() + "\n");
console.log(`wrote evaluations-overview.html (${html.length} bytes)`);
