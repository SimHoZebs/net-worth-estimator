import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { brandingPlan, brandingTarget, digest, serializePlan } from './apply-branding.mjs';

const escapeHtml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export async function writeBrandingApproval(target, directory) {
  const plan = brandingPlan(target);
  const bytes = serializePlan(plan);
  const sha256 = digest(bytes);
  const details = Object.entries(plan.fields).map(([key, value]) =>
    `<details><summary>${key}</summary><pre>${escapeHtml(typeof value === 'string' ? value : JSON.stringify(value, null, 2))}</pre></details>`).join('\n');
  const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Waypoint branding approval</title>
${plan.fields.headerHtml}
<style>${plan.fields.formCss}
body{margin:0;background:#fafaf9;color:#292524;font-size:16px;line-height:1.6}
main{max-width:68rem;margin:auto;padding:2rem 1.25rem}h1{font-size:2rem;line-height:1.2}h2{margin-block-start:2rem}
.preview{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr));gap:1.5rem}
.preview>div{padding:2rem;border:1px solid #d6d3d1;border-radius:1rem}.preview img{width:186px;height:40px}
.preview .dark-logo{background:#1c1917}.preview aside{border-radius:1rem}.preview footer{padding:1rem}
pre{padding:1rem;background:#f5f5f4;white-space:pre-wrap;overflow-wrap:anywhere;font-size:0.8125rem}summary{cursor:pointer;padding:.75rem 0}
a{color:#007a55}:focus-visible{outline:3px solid #007a55;outline-offset:3px}code{overflow-wrap:anywhere}
</style>
<main>
<h1>Waypoint hosted identity branding</h1>
<p>Review the exact fields and target before approval. This page does not apply changes.</p>
<p>Target: <code>${escapeHtml(JSON.stringify(plan.target))}</code></p>
<p>Approved file: <a href="plan.json">plan.json</a><br>SHA-256: <code>${sha256}</code></p>
<h2>Visible branding</h2>
<p>Browser title: <strong>${escapeHtml(plan.fields.title)}</strong>. Casdoor retains its native forms, tabs, buttons, errors, and recovery screens.</p>
<div class="preview">
<div><img src="${plan.fields.logo}" alt="Waypoint light logo"><p>Light wordmark and the existing Waypoint mark.</p></div>
<div class="dark-logo"><img src="${plan.fields.logoDark}" alt="Waypoint dark logo"></div>
${plan.fields.formSideHtml}
<div><footer>${plan.fields.footerHtml}</footer><p>The side panel appears on desktop. Mobile retains the logo and footer.</p></div>
</div>
<h2>Exact presentation fields</h2>
<p>The JSON file is authoritative. Each section below shows its exact field value, including embedded font and SVG data.</p>
${details}
<h2>Limits</h2>
<p>This changes application presentation only. It does not change permissions, plan ownership, OIDC, account policy, passwords, or passkeys.</p>
<p>Account management and passkey enrollment remain Casdoor screens. Device passkey prompts remain browser and operating-system screens.</p>
</main></html>\n`;
  await mkdir(directory, { mode: 0o700 });
  for (const [name, value] of Object.entries({ 'plan.json': bytes, 'plan.sha256': `${sha256}  plan.json\n`, 'review.html': html })) {
    await writeFile(resolve(directory, name), value, { flag: 'wx', mode: 0o600 });
  }
  return { directory: resolve(directory), sha256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { output: { type: 'string' } } });
  if (!values.output) throw new Error('Use --output <new-local-directory>');
  const result = await writeBrandingApproval(brandingTarget(process.env), resolve(values.output));
  console.log(`Offline approval artifact: ${result.directory}/review.html`);
  console.log(`Branding SHA-256: ${result.sha256}`);
}
