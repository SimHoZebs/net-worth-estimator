import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

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

const svg = (name: string) => themeSvg(readFileSync(join(dir, `${name}.svg`), "utf8").trim());

const sections: Array<{ id: string; title: string; blurb: string }> = [
  { id: "architecture-overview", title: "1. Architecture overview", blurb: "The six blocks end to end: ingestion, unified model, shared pipeline, incremental cache control, evaluation plugins, unified read API." },
  { id: "data-ingestion", title: "2. Data ingestion", blurb: "Providers supply transactions through the ingest orchestrator plus adapters. Manual entry writes directly." },
  { id: "unified-data-model", title: "3. Unified data model", blurb: "Accounts, transactions, recurrence rules, checkpoints, and Monte Carlo statistics. Source decides fact versus output." },
  { id: "recurrence-workflow", title: "4. Recurrence workflow", blurb: "Rules classify as deterministic or stochastic, run through the baseline engine or the Monte Carlo runner, and land in the unified reader." },
  { id: "incremental-slices", title: "5. Incremental slices", blurb: "One projection state owns yearly slices. Slices generate transactions, statistics, and evaluation outputs. No generated checkpoints persist." },
  { id: "slice-lifecycle", title: "6. Slice lifecycle", blurb: "Writes mark a single dirty date. The first invalid slice starts the suffix rebuild; the prefix is adopted and the revision publishes." },
  { id: "evaluation-plugins", title: "7. Evaluation plugins", blurb: "The reader answers from stored rows. The simulator runs branch evaluations, including isolated what-if inputs." },
  { id: "unified-read-api", title: "8. Unified read API", blurb: "Canonical requests assemble from slices. Anything else computes directly through the existing kernels." },
];

const nav = sections.map((s) => `<a href="#${s.id}">${s.title}</a>`).join("\n      ");

const body = sections
  .map((s) => {
    const svg = themeSvg(readFileSync(join(dir, `${s.id}.svg`), "utf8").trim());
    return `    <section id="${s.id}">
      <h2>${s.title}</h2>
      <p>${s.blurb}</p>
      <div class="diagram">${svg}</div>
    </section>`;
  })
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unified Projection Architecture</title>
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
      body {
        margin: 0;
        background: #141412;
        color: #ece9df;
        font-family: system-ui, sans-serif;
        line-height: 1.5;
      }
      header {
        position: sticky;
        top: 0;
        background: #1e1e1b;
        border-bottom: 1px solid #3a3a34;
        padding: 12px 24px;
      }
      header h1 { font-size: 18px; margin: 0 0 8px; }
      nav { display: flex; flex-wrap: wrap; gap: 4px 16px; }
      nav a { color: #6aa2e8; text-decoration: none; font-size: 14px; }
      nav a:hover { text-decoration: underline; }
      main { max-width: 1100px; margin: 0 auto; padding: 24px; }
      section { margin-bottom: 56px; scroll-margin-top: 110px; }
      section h2 { font-size: 22px; margin: 0 0 4px; }
      section p { color: #a3a099; margin: 0 0 16px; max-width: 80ch; }
      .diagram {
        background: #1e1e1b;
        border: 1px solid #3a3a34;
        border-radius: 8px;
        padding: 24px;
        overflow-x: auto;
      }
      .diagram svg { display: block; margin: 0 auto; }
    </style>
  </head>
  <body>
    <header>
      <h1>Unified Projection Architecture</h1>
      <nav>
      ${nav}
      </nav>
    </header>
    <main>
${body}
    </main>
  </body>
</html>
`;

writeFileSync(join(dir, "index.html"), html.replace(/[ \t]+\n/g, "\n").trimEnd() + "\n");
console.log(`wrote index.html (${html.length} bytes)`);
