// Disposable real-service checks. Requires frontend's Playwright and Chromium.
import assert from 'node:assert/strict';
import { createHash, randomBytes, createPublicKey, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { settingsFromEnv, defaultStateDir } from './generate.mjs';
import { casdoorSession } from './provision.mjs';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const settings = settingsFromEnv(process.env);
const appOrigin = new URL(settings.appUrl);
assert.ok(appOrigin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(appOrigin.hostname),
  'Smoke checks require an unused loopback HTTP application origin');
const bootstrap = JSON.parse(await readFile(resolve(process.env.CASDOOR_STATE_DIR || defaultStateDir, 'bootstrap.json'), 'utf8'));
assert.equal(bootstrap.issuer, settings.publicUrl);
assert.equal(bootstrap.username, settings.username);
const callback = `${settings.appUrl}/v1/auth/callback`;
const discoveryResponse = await fetch(`${settings.publicUrl}/.well-known/openid-configuration`);
assert.equal(discoveryResponse.status, 200);
const discovery = await discoveryResponse.json();
assert.equal(discovery.issuer, settings.publicUrl);
assert.ok(discovery.code_challenge_methods_supported.includes('S256'));
const jwks = await (await fetch(discovery.jwks_uri)).json();
assert.ok(jwks.keys.length >= 2, 'Built-in and separate app signing keys exist');

// A real listener also catches remembered-login HTTP redirects. Playwright's
// route handler only intercepts the first URL in an HTTP redirect chain.
const callbackServer = createServer((_, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  response.end('OIDC response captured');
});
await new Promise((resolve, reject) => {
  callbackServer.once('error', reject);
  callbackServer.listen(Number(appOrigin.port || 80), '127.0.0.1', resolve);
});
const browser = await chromium.launch({ headless: true }).catch((error) => {
  callbackServer.close();
  throw error;
});
let context;
let page;
let latestTokens;
let latestNonce;
let verifier;

async function newBrowserSession() {
  if (context) await context.close();
  context = await browser.newContext();
  page = await context.newPage();
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    console.error(`Request failed: ${url.origin}${url.pathname} (${request.failure()?.errorText})`);
  });
}

async function authorization() {
  verifier = randomBytes(32).toString('base64url');
  latestNonce = randomBytes(16).toString('hex');
  const url = new URL(discovery.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: settings.clientId, redirect_uri: callback, response_type: 'code',
    scope: 'openid profile email offline_access', state: 'casdoor-smoke', nonce: latestNonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  await page.goto(url.href);
}

async function exchange(codeVerifier = verifier) {
  await page.waitForURL((url) => url.origin === settings.appUrl && url.searchParams.has('code'));
  const responseUrl = new URL(page.url());
  assert.equal(responseUrl.pathname, '/v1/auth/callback');
  assert.equal(responseUrl.searchParams.get('state'), 'casdoor-smoke');
  assert.equal(responseUrl.searchParams.get('iss'), discovery.issuer);
  const response = await fetch(discovery.token_endpoint, {
    method: 'POST', headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: responseUrl.searchParams.get('code'),
      redirect_uri: callback, code_verifier: codeVerifier,
    }),
  });
  const tokens = await response.json();
  if (codeVerifier !== verifier) {
    assert.ok(tokens.error, 'Wrong PKCE verifier must fail');
    assert.equal(tokens.id_token, undefined);
    return;
  }
  assert.equal(response.status, 200);
  assert.ok(tokens.id_token, 'Code exchange must return an ID token');
  assert.ok(tokens.refresh_token, 'Code exchange must return a persistent grant');
  const [header, payload, signature] = tokens.id_token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  const metadata = JSON.parse(Buffer.from(header, 'base64url'));
  assert.equal(metadata.alg, 'RS256');
  const key = jwks.keys.find((key) => key.kid === metadata.kid);
  assert.ok(key, 'ID-token kid must exist in discovery JWKS');
  assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(signature, 'base64url')));
  assert.equal(claims.iss, discovery.issuer);
  assert.equal(claims.sub, bootstrap.subject);
  assert.ok([claims.aud].flat().includes(settings.clientId));
  assert.equal(claims.nonce, latestNonce);
  const userinfo = await (await fetch(discovery.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })).json();
  assert.equal(userinfo.sub, bootstrap.subject);
  latestTokens = tokens;
}

async function password() {
  await page.locator('#username').fill(settings.username);
  await page.locator('#password').fill(settings.password);
  assert.equal(await page.getByRole('checkbox', { name: 'Auto sign in' }).isChecked(), true);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
}

async function logout() {
  const url = new URL(discovery.end_session_endpoint);
  url.search = new URLSearchParams({
    client_id: settings.clientId, id_token_hint: latestTokens.id_token,
    post_logout_redirect_uri: `${settings.appUrl}/`,
  });
  await page.goto(url.href).catch(() => assert.fail('Provider logout navigation failed'));
  await page.waitForURL(`${settings.appUrl}/`).catch(() => assert.fail('Provider logout redirect failed'));
}

async function serverSessionHours() {
  const cookie = (await context.cookies(settings.publicUrl)).find((cookie) => cookie.name === 'casdoor_session_id');
  const response = await context.request.get(`${settings.publicUrl}/api/get-session?sessionPkId=${encodeURIComponent(`waypoint/${settings.username}/waypoint`)}`);
  const session = await response.json();
  assert.equal(session.status, 'ok');
  const hashedId = createHash('sha256').update(cookie.value).digest('hex');
  const info = session.data.sessionInfos.find((info) => info.sessionId === hashedId);
  assert.ok(info, 'Current session exists in durable session metadata');
  return (Date.parse(info.expireTime) - Date.now()) / 3_600_000;
}

try {
  await newBrowserSession();
  await authorization();
  await password();
  await exchange();
  console.log('PASS discovery, password UI, generated ID-token subject, nonce, audience, refresh grant, and userinfo');

  const cookie = (await context.cookies(settings.publicUrl)).find((cookie) => cookie.name === 'casdoor_session_id');
  assert.ok(cookie?.httpOnly);
  assert.ok(cookie.expires > Date.now() / 1000 + 29 * 86400, 'Remember-browser cookie lasts 30 days');
  assert.ok(await serverSessionHours() > 719);
  await authorization();
  await exchange();
  console.log('PASS remembered browser reauthorization without credentials');

  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
  await page.goto(`${settings.publicUrl}/account`);
  const registrationResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/webauthn/signup/finish') && response.request().method() === 'POST');
  const credentialSection = page.getByText('WebAuthn credentials', { exact: true }).locator('..').locator('..');
  await credentialSection.getByRole('button', { name: 'Add', exact: true }).click();
  const registered = await (await registrationResponse).json();
  assert.equal(registered.status, 'ok');
  const credentials = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  assert.ok(credentials.credentials.length > 0);
  console.log('PASS real WebAuthn registration with a Chromium virtual authenticator');

  if (process.env.CASDOOR_RESTART_CONTAINER) {
    const result = spawnSync('docker', ['restart', process.env.CASDOOR_RESTART_CONTAINER], { encoding: 'utf8' });
    assert.equal(result.status, 0, 'Explicit test-container restart must succeed');
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        healthy = (await fetch(`${settings.publicUrl}/api/health`, { signal: AbortSignal.timeout(2000) })).ok;
      } catch { /* Server is not ready yet. */ }
      if (healthy) break;
      await setTimeout(500);
    }
    assert.ok(healthy);
    const after = await (await fetch(discovery.jwks_uri)).json();
    assert.deepEqual(after.keys.map((key) => key.kid).sort(), jwks.keys.map((key) => key.kid).sort());
    await authorization();
    await exchange();
    console.log('PASS container restart preserves signing keys and remembered browser session');
  }

  await logout();
  await authorization();
  await page.getByRole('tab', { name: 'Passkey', exact: true }).click();
  await page.locator('#username').fill(settings.username);
  await page.getByRole('button', { name: 'Sign in with WebAuthn', exact: true }).click();
  await exchange();
  console.log('PASS passkey UI login, PKCE, and signed ID token after logout');
  const passkeyHours = await serverSessionHours();
  assert.ok(passkeyHours > 23 && passkeyHours <= 24);
  console.log('UPSTREAM LIMIT: passkey login caps its remembered session at 24 hours in v4.23.0');

  await authorization();
  await exchange(randomBytes(32).toString('base64url'));
  console.log('PASS wrong PKCE verifier rejected');

  const request = casdoorSession(settings.publicUrl);
  const rejected = await fetch(`${settings.publicUrl}/api/login/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password', client_id: settings.clientId, client_secret: settings.clientSecret,
      username: settings.username, password: settings.password,
    }),
  });
  assert.ok((await rejected.json()).error, 'Password grant is disabled');
  const adminLogin = await fetch(`${settings.publicUrl}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'login', application: 'app-built-in', organization: 'built-in', username: 'admin', password: '123', signinMethod: 'Password' }),
  });
  assert.equal((await adminLogin.json()).status, 'error');
  const app = await request('/api/get-default-application?id=admin%2Fwaypoint');
  assert.equal(app.data.organization, 'waypoint');
  assert.equal(app.data.enableSignUp, true);
  assert.equal(app.data.disableSelfSignup, false);
  const builtIn = await request('/api/get-default-application?id=admin%2Fbuilt-in');
  assert.equal(builtIn.data.enableSignUp, false);
  assert.equal((await request('/api/get-init-admin-status')).data, false);
  await request('/api/login', { method: 'POST', body: {
    type: 'login', signinMethod: 'Password', application: 'waypoint',
    organization: 'waypoint', username: settings.username, password: settings.password,
  } });
  await assert.rejects(() => request('/api/get-users?owner=built-in'));
  await request('/api/logout', { method: 'POST' });
  console.log('PASS ordinary signup is available, while password grant and public admin signup remain disabled');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => callbackServer.close((error) => error ? reject(error) : resolve()));
}
