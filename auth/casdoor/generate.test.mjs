import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { settingsFromEnv, buildSeed, buildConfig, generate } from './generate.mjs';

const env = {
  CASDOOR_PUBLIC_URL: 'http://localhost:8000', APP_PUBLIC_URL: 'http://localhost:5178',
  AUTH_CLIENT_ID: 'waypoint-test', AUTH_CLIENT_SECRET: 'test-client-secret-000',
  CASDOOR_ADMIN_PASSWORD: 'test-admin-password-000',
  CASDOOR_USER_NAME: 'household', CASDOOR_USER_PASSWORD: 'test-member-password-000',
};

test('requires explicit distinct secrets and HTTPS outside loopback', () => {
  for (const key of Object.keys(env)) assert.throws(() => settingsFromEnv({ ...env, [key]: '' }));
  assert.throws(() => settingsFromEnv({ ...env, CASDOOR_PUBLIC_URL: 'http://auth.example.test' }));
  assert.throws(() => settingsFromEnv({ ...env, APP_PUBLIC_URL: 'http://192.168.0.1' }));
  assert.throws(() => settingsFromEnv({ ...env, CASDOOR_PUBLIC_URL: 'https://auth.example.test/path' }));
  assert.throws(() => settingsFromEnv({ ...env, CASDOOR_ADMIN_PASSWORD: env.CASDOOR_USER_PASSWORD }));
  assert.throws(() => settingsFromEnv({ ...env, CASDOOR_ADMIN_PASSWORD: 'linebreak\nconfig=bad' }));
  for (const override of [
    { CASDOOR_USER_PASSWORD: 'x'.repeat(73) }, { CASDOOR_USER_NAME: 'bad/name' },
    { CASDOOR_USER_EMAIL: 'not-email' }, { CASDOOR_USER_DISPLAY_NAME: 'two\nlines' },
    { CASDOOR_BACKCHANNEL_LOGOUT_URL: 'http://backend:8787/wrong' },
    { CASDOOR_BACKCHANNEL_LOGOUT_URL: 'http://user:password@backend:8787/v1/auth/backchannel-logout' },
  ]) assert.throws(() => settingsFromEnv({ ...env, ...override }));
  assert.equal(settingsFromEnv({ ...env, CASDOOR_PUBLIC_URL: 'https://auth.example.test/' }).publicUrl, 'https://auth.example.test');
});

test('seeds one normal user, code/refresh grants, sessions, passkeys, and a fresh cert', () => {
  const settings = settingsFromEnv(env);
  const seed = buildSeed(settings);
  assert.equal(seed.users.length, 1);
  assert.equal(seed.users[0].name, 'household');
  assert.equal(Object.hasOwn(seed.users[0], 'id'), false);
  assert.ok(seed.users.every((user) => user.owner === 'waypoint' && !user.isAdmin));
  assert.deepEqual(seed.organizations[0].passwordOptions, ['AtLeast8']);
  const app = seed.applications.find((app) => app.name === 'waypoint');
  assert.deepEqual(app.grantTypes, ['authorization_code', 'refresh_token']);
  assert.equal(app.backchannelLogoutUri, 'http://localhost:5178/v1/auth/backchannel-logout');
  assert.equal(app.tokenFormat, 'JWT-Standard');
  assert.equal(app.refreshExpireInHours, 720);
  assert.deepEqual(app.redirectUris, ['http://localhost:5178/v1/auth/callback', 'http://localhost:5178/']);
  assert.equal(app.clientSecret, env.AUTH_CLIENT_SECRET);
  assert.equal(app.enableWebAuthn, true);
  assert.equal(app.enableSignUp, true);
  assert.equal(app.disableSelfSignup, false);
  assert.equal(app.signinItems.find((item) => item.name === 'Signup link').visible, true);
  assert.deepEqual(app.signupItems.filter((item) => item.visible).map((item) => item.name),
    ['Username', 'Display name', 'Password', 'Confirm password']);
  assert.equal(seed.applications.find((item) => item.name === 'app-built-in').enableSignUp, false);
  assert.equal(app.signinMethods.find((method) => method.name === 'WebAuthn').rule, 'None');
  assert.equal(app.enableSigninSession, true);
  assert.equal(app.cookieExpireInHours, 720);
  assert.ok(['Signin methods', 'Username', 'Password', 'Login button'].every((name) =>
    app.signinItems.some((item) => item.name === name && item.visible)));
  assert.equal(app.signinItems.find((item) => item.name === 'Forgot password?').rule, 'Auto sign in - True');
  assert.equal(seed.certs[0].privateKey, undefined);
  assert.match(buildConfig(settings), /initDataMerge = true/);
  assert.match(buildConfig(settings), /initDataNewOnly = false/);
  assert.match(buildConfig(settings), /_pragma=busy_timeout\(5000\)&_pragma=journal_mode\(WAL\)/);
});

test('additional browser addresses add exact callbacks without changing identities or issuer', () => {
  const baseline = settingsFromEnv(env);
  const settings = settingsFromEnv({ ...env,
    NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS: JSON.stringify({ 'http://localhost:18081': 'http://localhost:18083' }),
  });
  const before = buildSeed(baseline);
  const after = buildSeed(settings);
  const app = after.applications.find(app => app.name === 'waypoint');
  assert.deepEqual(app.redirectUris, [
    'http://localhost:5178/v1/auth/callback', 'http://localhost:5178/',
    'http://localhost:18081/v1/auth/callback', 'http://localhost:18081/',
  ]);
  app.redirectUris = before.applications.find(app => app.name === 'waypoint').redirectUris;
  assert.deepEqual(after, before);
  assert.equal(buildConfig(settings), buildConfig(baseline));
  for (const aliases of [null, [], { 'http://host.test': 'http://localhost:8000' },
    { 'http://localhost:5178': 'http://localhost:18083' },
    { 'http://localhost:18081': 'http://localhost:5178' },
    { 'http://localhost:18081/path': 'http://localhost:18083' }]) {
    assert.throws(() => settingsFromEnv({ ...env, NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS: JSON.stringify(aliases) }));
  }
});

test('creates private files without overwriting existing configuration', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'casdoor-generator-test-'));
  try {
    await generate(settingsFromEnv(env), dir);
    for (const file of ['app.conf', 'init_data.json']) {
      assert.equal((await stat(resolve(dir, 'conf', file))).mode & 0o777, 0o600);
    }
    assert.equal((await stat(resolve(dir, 'db'))).mode & 0o777, 0o700);
    assert.equal(JSON.parse(await readFile(resolve(dir, 'conf/init_data.json'), 'utf8')).users.length, 1);
    await assert.rejects(() => generate(settingsFromEnv(env), dir), /Config already exists/);
  } finally {
    for (const file of ['app.conf', 'init_data.json']) await unlink(resolve(dir, 'conf', file));
    for (const part of ['conf', 'db', 'sessions']) await rmdir(resolve(dir, part));
    await rmdir(dir);
  }
});

test('refuses existing identity data even when its configuration is missing', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'casdoor-existing-test-'));
  const db = resolve(dir, 'db/casdoor.db');
  try {
    await mkdir(resolve(dir, 'db'));
    await writeFile(db, 'existing identity data');
    await assert.rejects(() => generate(settingsFromEnv(env), dir), /Identity state already exists/);
    assert.equal(await readFile(db, 'utf8'), 'existing identity data');
    await assert.rejects(() => stat(resolve(dir, 'conf/app.conf')), { code: 'ENOENT' });
  } finally {
    await unlink(db);
    await rmdir(resolve(dir, 'db'));
    await rmdir(dir);
  }
});
