import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, stat, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildBranding, brandingFields } from './branding.mjs';
import { buildSeed } from './generate.mjs';
import { digest } from './apply-branding.mjs';
import { brandingTarget, approvedPlan } from './apply-branding.mjs';
import { writeBrandingApproval } from './branding.approval.mjs';

test('seeds only Waypoint presentation, without replacing Casdoor credential forms', () => {
  const fields = buildBranding();
  assert.deepEqual(Object.keys(fields).sort(), [...brandingFields].sort());
  const seed = buildSeed({ appUrl: 'https://app.example.test' });
  const app = seed.applications.find((app) => app.name === 'waypoint');
  for (const [field, value] of Object.entries(fields)) assert.deepEqual(app[field], value);
  assert.equal(app.signinHtml, undefined);
  assert.equal(app.signupHtml, undefined);
  assert.equal(seed.applications[0].logo, undefined, 'Built-in administrator UI remains unchanged');
  assert.deepEqual(app.grantTypes, ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code']);
  assert.equal(app.enableWebAuthn, true);
  assert.equal(app.formOffset, 4);
  assert.deepEqual(fields.themeData, { isEnabled: true, themeType: 'default', colorPrimary: '#007a55', borderRadius: 6, isCompact: false });
  assert.equal(fields.formCssMobile, fields.formCss, 'Casdoor selects one complete sheet per viewport');
});

test('bundles local Manrope and script-free SVG assets without external requests', () => {
  const fields = buildBranding();
  const font = readFileSync(new URL('./branding/manrope-latin-wght-normal.woff2', import.meta.url));
  assert.equal(digest(font), 'a30ddcd349703aff7464c34bef3fffdff405ee50c113440d7c8693c02d210972');
  assert.ok(fields.headerHtml.includes(font.toString('base64')));
  assert.match(fields.headerHtml, /font-display:swap/);
  for (const field of ['logo', 'logoDark', 'favicon']) {
    assert.match(fields[field], /^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(fields[field].split(',')[1], 'base64').toString();
    assert.match(svg, /<svg /);
    assert.doesNotMatch(svg, /<script|<text|<image|https?:\/\/(?!www.w3.org\/2000\/svg)/i);
  }
  for (const field of ['headerHtml', 'footerHtml', 'formSideHtml']) {
    assert.doesNotMatch(fields[field], /<script|<form|<input|on[a-z]+\s*=|https?:\/\//i);
  }
  assert.doesNotMatch(fields.footerHtml + fields.formSideHtml, /private|invite|grant|editor|reader/i);
  assert.doesNotMatch(fields.formCss, /@import|url\(|animation:|display:\s*none/i);
  assert.match(fields.formCss, /:focus-visible/);
  assert.match(fields.formCss, /forced-colors/);
  assert.match(fields.formCss, /font-size: 1rem/);
});

test('preserves the frontend Brand mark geometry', () => {
  const brand = readFileSync(new URL('../../frontend/src/components/Brand.tsx', import.meta.url), 'utf8');
  const mark = readFileSync(new URL('./branding/mark.svg', import.meta.url), 'utf8');
  assert.match(brand, /m5 23 6-15 6 12 5-9 5 12/);
  assert.match(mark, /m5 23 6-15 6 12 5-9 5 12/);
});

test('writes a reproducible offline approval bundle with exact fields and visible content', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'casdoor-branding-approval-'));
  const directory = resolve(root, 'review');
  try {
    const target = brandingTarget({ CASDOOR_PUBLIC_URL: 'https://identity.example.test', AUTH_CLIENT_ID: 'waypoint' });
    const result = await writeBrandingApproval(target, directory);
    const bytes = await readFile(resolve(directory, 'plan.json'), 'utf8');
    const plan = approvedPlan(bytes, result.sha256, target);
    assert.deepEqual(plan.fields, buildBranding());
    assert.equal(plan.fields.footerHtml, "", "provider footer stays removed");
    assert.equal(await readFile(resolve(directory, 'plan.sha256'), 'utf8'), `${digest(bytes)}  plan.json\n`);
    const html = await readFile(resolve(directory, 'review.html'), 'utf8');
    assert.ok(html.includes(plan.fields.formSideHtml));
    assert.ok(html.includes(plan.fields.footerHtml));
    assert.match(html, /does not apply changes/);
    assert.doesNotMatch(html, /<script|<form|<input/i);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(resolve(directory, 'plan.json'))).mode & 0o777, 0o600);
    await assert.rejects(() => writeBrandingApproval(target, directory), { code: 'EEXIST' });
  } finally {
    for (const file of ['plan.json', 'plan.sha256', 'review.html']) await unlink(resolve(directory, file));
    await rmdir(directory);
    await rmdir(root);
  }
});
