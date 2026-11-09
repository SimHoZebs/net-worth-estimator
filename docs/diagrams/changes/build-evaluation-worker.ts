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
    <title>Evaluation worker — before vs after (Pele)</title>
    <style>
      :root { color-scheme: dark; --pele-bg:#141412; --pele-fg:#ece9df; --pele-muted:#a3a099; --pele-line:#ece9df; --pele-surface:#1e1e1b; --pele-surface-alt:#262622; --pele-border:#3a3a34; --pele-accent:#6aa2e8; --pele-font:system-ui,sans-serif; }
      *{box-sizing:border-box}
      body{margin:0;background:#141412;color:#ece9df;font-family:system-ui,sans-serif;line-height:1.5}
      header{position:static;background:#1e1e1b;border-bottom:1px solid #3a3a34;padding:12px 24px}
      header h1{font-size:18px;margin:0 0 4px}
      header p{margin:0;color:#a3a099;font-size:14px;max-width:100ch}
      main{max-width:1200px;margin:0 auto;padding:24px}
      .pair{display:grid;grid-template-columns:1fr;gap:16px;margin-bottom:24px}
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
    <header><h1>Evaluation reader — optional projection path</h1><p>Generated with <code>@simhozebs/pele-cli</code> from <code>evaluation-worker-before.mmd</code> / <code>evaluation-worker-after.mmd</code>. How the data is made: <code>FinancialModel + EvaluationTables</code> → <code>PrepareSimulationRequest → Simulate → BuildProjectionPath</code> → <code>NewEvaluationRuntimeSet → EvaluateDeterministic (one pass, input order) → EvaluationResultTables</code> (envelopes + diagnostics) → <code>shared result renderer</code> (<code>deterministic</code> + <code>stochastic SSE</code>) → <code>7 outputs</code> → <code>Frontend</code>. Inputs are identical on both sides. Before runs that chain synchronously per request and assumes <code>ProjectionPath</code> present. After keeps the chain synchronous — no worker — and adds only <code>NeedsProjectionPath</code>: nil paths report <code>projection-unavailable → indeterminate</code> instead of panicking. Status is derived from the existing projection manifest via passive <code>GET /v1/evaluations/status</code>.</p></header>
    <main>
      <div class="legend"><span class="kept">Kept</span><span class="modified">Modified</span><span class="added">Added</span></div>
      <div class="pair">
        <div class="pane"><h4>Before — sync, path assumed present</h4><div class="diagram">${svg("evaluation-worker-before")}</div></div>
        <div class="pane"><h4>After — optional path, no worker</h4><div class="diagram">${svg("evaluation-worker-after")}</div></div>
      </div>
      <table>
        <tr><th>Data creation step</th><th>Before</th><th>After</th></tr>
        <tr class="kept"><td>Inputs</td><td>FinancialModel + EvaluationTables (registry ParseConfig)</td><td>identical — same struct, same loader</td></tr>
        <tr class="kept"><td>ProjectionPath</td><td>PrepareSimulationRequest → Simulate → BuildProjectionPath (per request)</td><td>same pipeline; may return nil when unwritable or absent</td></tr>
        <tr class="modified"><td>Needs gate</td><td>ctx.Path assumed; nil panics plugin</td><td>NeedsProjectionPath; nil → projection-unavailable indeterminate</td></tr>
        <tr class="kept"><td>Evaluation</td><td>EvaluateDeterministic (one pass) → EvaluationResultTables</td><td>same runtime, nil-safe via EvaluateProjectionPathOptional</td></tr>
        <tr class="kept"><td>Renderer</td><td>shared result renderer → deterministic + stochastic SSE</td><td>unchanged renderer and 7 outputs</td></tr>
        <tr class="added"><td>Status</td><td>embedded in deterministic response</td><td>GET /v1/evaluations/status derived from projection manifest (passive, no-store)</td></tr>
      </table>
    </main>
  </body>
</html>
`;
writeFileSync(join(dir, "evaluation-worker.html"), html.replace(/[ \t]+\n/g, "\n").trimEnd() + "\n");
console.log(`wrote evaluation-worker.html (${html.length} bytes)`);
