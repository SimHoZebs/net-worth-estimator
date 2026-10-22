import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { composeEnvironment, loadConfig, newConfig, saveConfig, settings, withLock } from './config.mjs';
import { composeArgs } from './run.mjs';

test('dev reuses production Compose files and fixes the public origins', () => {
  const config = newConfig();
  const env = composeEnvironment(config, '/private/dev', { CASDOOR_PORT: '9999', APP_PUBLIC_URL: 'https://prod.invalid', COMPOSE_PROFILES: 'unsafe' });
  assert.equal(env.APP_PUBLIC_URL, 'http://localhost:5178');
  assert.equal(env.CASDOOR_PUBLIC_URL, 'http://localhost:8000');
  assert.equal(env.CASDOOR_PORT, '8000');
  assert.equal(env.COMPOSE_PROFILES, '');
  assert.equal(env.CASDOOR_STATE_DIR, '/private/dev/casdoor');
  assert.equal(env.NET_WORTH_ESTIMATOR_AUTH_EDITORS, '');
  const args = composeArgs(['up']);
  assert.ok(args.some((item) => item.endsWith('/docker-compose.yml')));
  assert.ok(args.some((item) => item.endsWith('/auth/compose.casdoor.yml')));
  assert.ok(args.some((item) => item.endsWith('/dev/compose.yml')));
  assert.equal(args.at(-1), 'up');
  assert.throws(() => settings({ ...config, editors: ['*'] }), /explicit/);
  assert.throws(() => settings({ ...config, readers: [' '] }), /explicit/);
  assert.throws(() => settings({ ...config, source: {} }), /snapshot source/);
});

test('generated configuration and grants persist without replacing credentials', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'waypoint-dev-config-'));
  try {
    const config = await loadConfig(dir, true);
    assert.equal((await stat(resolve(dir, 'config.json'))).mode & 0o777, 0o600);
    const again = await loadConfig(dir, true);
    assert.ok(config.identity.AUTH_CLIENT_SECRET === again.identity.AUTH_CLIENT_SECRET);
    config.editors = ['verified-owner'];
    await saveConfig(dir, config);
    assert.deepEqual((await loadConfig(dir, false)).editors, ['verified-owner']);
    assert.ok((await loadConfig(dir, false)).identity.CASDOOR_USER_PASSWORD === again.identity.CASDOOR_USER_PASSWORD);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('operation locks reject overlap and recover an interrupted process', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'waypoint-dev-lock-'));
  try {
    await withLock(dir, async () => {
      assert.equal(Number(await readFile(resolve(dir, 'operation.lock'), 'utf8')), process.pid);
      await assert.rejects(() => withLock(dir, async () => {}), /active/);
    });
    await writeFile(resolve(dir, 'operation.lock'), '2147483647', { mode: 0o600 });
    let completed = false;
    await withLock(dir, async () => { completed = true; });
    assert.equal(completed, true);
    await assert.rejects(() => stat(resolve(dir, 'operation.lock')), { code: 'ENOENT' });
    await assert.rejects(() => withLock(dir, async () => { throw new Error('operation failed'); }), /operation failed/);
    await assert.rejects(() => stat(resolve(dir, 'operation.lock')), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
