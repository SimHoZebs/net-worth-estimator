import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { composeEnvironment, loadConfig, newConfig, originProfile, saveConfig, settings, tailnetOrigins, withLock, writeComposeEnv } from './config.mjs';
import { composeArgs, main } from './run.mjs';

test('Compose owns daily lifecycle commands; the helper only accepts setup and data operations', async () => {
  for (const command of ['up', 'down', 'status', 'logs', undefined]) {
    await assert.rejects(() => main(command ? [command] : []), /Use docker compose/);
  }
  await assert.rejects(() => main(['setup', '--no-build']), /Unknown option/);
  await assert.rejects(() => main(['refresh-db', '--tailnet']), /only to setup/);
  await assert.rejects(() => main(['publish-sample', 'extra']), /Unexpected/);
});

test('dev has one dedicated Compose file and exports only its runtime settings', () => {
  const config = newConfig();
  const env = composeEnvironment(config);
  assert.equal(env.DEV_APP_PUBLIC_URL, 'http://localhost:5178');
  assert.equal(env.DEV_CASDOOR_PUBLIC_URL, 'http://localhost:8000');
  assert.equal(env.DEV_OWNER_SUBJECT, '');
  assert.equal(env.DEV_AUTH_CLIENT_SECRET, config.identity.AUTH_CLIENT_SECRET);
  assert.equal(env.CASDOOR_ADMIN_PASSWORD, undefined);
  assert.equal(env.CASDOOR_USER_PASSWORD, undefined);
  assert.equal(env.CASDOOR_STATE_DIR, undefined);
  const args = composeArgs(['up']);
  assert.equal(args.filter((item) => item === '-f').length, 1);
  assert.ok(args.some((item) => item.endsWith('/docker-compose.dev.yml')));
  assert.equal(args.at(-1), 'up');
  assert.throws(() => settings({ ...config, source: {} }), /snapshot source/);
  assert.throws(() => settings({ ...config, ownerSubject: '*' }), /verified/);
  assert.throws(() => settings({ ...config, ownerSubject: ' ' }), /verified/);
  assert.equal(composeEnvironment({ ...config, ownerSubject: 'verified-user' }).DEV_OWNER_SUBJECT, 'verified-user');
});

test('runtime environment export is private, repeatable, and preserves existing edits', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'waypoint-dev-env-'));
  const path = resolve(dir, '.env.dev');
  const config = { ...newConfig(), ownerSubject: 'verified-owner' };
  try {
    await writeComposeEnv(config, path);
    const contents = await readFile(path, 'utf8');
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.ok(!contents.includes(config.identity.CASDOOR_ADMIN_PASSWORD));
    assert.ok(!contents.includes(config.identity.CASDOOR_USER_PASSWORD));
    const modified = (await stat(path)).mtimeMs;
    await writeComposeEnv(config, path);
    assert.equal((await stat(path)).mtimeMs, modified);
    await writeFile(path, contents + '# operator edit\n');
    await assert.rejects(() => writeComposeEnv(config, path), /differs/);
    assert.equal(await readFile(path, 'utf8'), contents + '# operator edit\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('native Compose consumes the exported environment and isolates dev from production settings', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'waypoint-dev-compose-'));
  const path = resolve(dir, '.env.dev');
  const config = { ...newConfig(undefined, 'test-node.example.ts.net'), ownerSubject: "opaque'${NOT_A_SECRET}" };
  try {
    await writeComposeEnv(config, path);
    const args = ['compose', '--env-file', path, '-f', resolve('docker-compose.dev.yml'), 'config'];
    const options = {
      encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME,
        APP_PUBLIC_URL: 'https://production.invalid', AUTH_CLIENT_SECRET: 'production-secret',
        COMPOSE_FILE: '/nonexistent/production-compose.yml', COMPOSE_PROFILES: 'unused-production-profile',
        DEV_STATE_DIR: '/production', CASDOOR_STATE_DIR: '/production', NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCESS_URL: 'production-bridge' },
    };
    const result = spawnSync('docker', [...args, '--format', 'json'], options);
    assert.equal(result.status, 0, result.stderr);
    const model = JSON.parse(result.stdout);
    assert.equal(model.name, 'waypoint-dev');
    assert.deepEqual(Object.keys(model.services).sort(), ['backend', 'casdoor', 'frontend']);
    assert.equal(model.volumes, undefined);
    const { backend, casdoor, frontend } = model.services;
    assert.equal(backend.build.dockerfile, 'backend/Dockerfile');
    assert.equal(frontend.build.dockerfile, 'frontend/Dockerfile');
    assert.equal(backend.image, 'waypoint-dev-backend');
    assert.equal(frontend.image, 'waypoint-dev-frontend');
    assert.equal(casdoor.image, 'casbin/casdoor:v4.23.0@sha256:e13c9aada231f7338a03ab0ae7054d0a9480e77283338ab9fc319d88fe2b3ce0');
    assert.equal(backend.environment.NET_WORTH_ESTIMATOR_AUTH_ISSUER, config.identity.CASDOOR_PUBLIC_URL);
    assert.equal(backend.environment.NET_WORTH_ESTIMATOR_AUTH_CLIENT_SECRET, config.identity.AUTH_CLIENT_SECRET);
    // Compose escapes dollars when it serializes a reusable Compose document.
    assert.equal(backend.environment.NET_WORTH_ESTIMATOR_PLAN_OWNER_SUBJECT, config.ownerSubject.replaceAll('$', () => '$$'));
    const interpolation = spawnSync('docker', [...args, '--environment'], options);
    assert.equal(interpolation.status, 0, interpolation.stderr);
    assert.ok(interpolation.stdout.split('\n').includes(`DEV_OWNER_SUBJECT=${config.ownerSubject}`));
    assert.equal(backend.environment.NET_WORTH_ESTIMATOR_AUTH_PROVIDER, 'casdoor');
    assert.equal(backend.environment.NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCESS_URL, '');
    assert.equal(backend.environment.NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK, '');
    assert.equal(backend.environment.NET_WORTH_ESTIMATOR_AUTH_TOKEN, '');
    assert.equal(backend.user, `${process.getuid()}:${process.getgid()}`);
    assert.equal(backend.volumes[0].source, resolve('tmp/dev/data'));
    assert.deepEqual(casdoor.volumes.map(v => v.source), ['conf', 'db', 'sessions'].map(p => resolve('tmp/dev/casdoor', p)));
    assert.equal(casdoor.volumes[0].read_only, true);
    for (const service of Object.values(model.services)) assert.equal(service.ports[0].host_ip, '127.0.0.1');
    assert.equal(backend.depends_on.casdoor.condition, 'service_healthy');
    assert.equal(frontend.depends_on.backend.condition, 'service_healthy');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('access needs no role configuration and retired grants do not reach the backend', async () => {
  const example = await readFile(resolve('.env.example'), 'utf8');
  assert.ok(!example.includes('NET_WORTH_ESTIMATOR_AUTH_EDITORS='));
  assert.ok(!example.includes('NET_WORTH_ESTIMATOR_AUTH_READERS='));
  assert.ok(example.includes('NET_WORTH_ESTIMATOR_PLAN_OWNER_SUBJECT='));
  const config = newConfig();
  assert.equal(Object.hasOwn(config, 'editors'), false);
  assert.equal(Object.hasOwn(config, 'readers'), false);
  const old = { ...config, readers: ['old-reader'], editors: ['old-owner'] };
  const env = composeEnvironment(old);
  assert.equal(env.NET_WORTH_ESTIMATOR_AUTH_EDITORS, undefined);
  assert.equal(env.NET_WORTH_ESTIMATOR_AUTH_READERS, undefined);
  await assert.rejects(() => main(['grant', 'subject', 'editor']), /Access is automatic/);
  const dir = await mkdtemp(resolve(tmpdir(), 'waypoint-dev-policy-'));
  try {
    await saveConfig(dir, old);
    const saved = await loadConfig(dir, true);
    assert.equal(saved.identity.AUTH_CLIENT_SECRET, config.identity.AUTH_CLIENT_SECRET);
    assert.deepEqual(saved.editors, old.editors);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('generated configuration persists without replacing credentials', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'waypoint-dev-config-'));
  try {
    const config = await loadConfig(dir, true);
    assert.equal((await stat(resolve(dir, 'config.json'))).mode & 0o777, 0o600);
    const again = await loadConfig(dir, true);
    assert.ok(config.identity.AUTH_CLIENT_SECRET === again.identity.AUTH_CLIENT_SECRET);
    config.source = { file: '/private/backup.db' };
    await saveConfig(dir, config);
    assert.deepEqual((await loadConfig(dir, false)).source, config.source);
    assert.ok((await loadConfig(dir, false)).identity.CASDOOR_USER_PASSWORD === again.identity.CASDOOR_USER_PASSWORD);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('tailnet origins require HTTPS, the same full DNS name, and the fixed public ports', () => {
  const host = 'test-node.example.ts.net';
  const config = newConfig(undefined, host);
  assert.equal(config.identity.APP_PUBLIC_URL, `https://${host}:5178`);
  assert.equal(config.identity.CASDOOR_PUBLIC_URL, `https://${host}:8000`);
  assert.equal(originProfile(config.identity.APP_PUBLIC_URL, config.identity.CASDOOR_PUBLIC_URL), host);
  assert.equal(settings(config).appUrl, config.identity.APP_PUBLIC_URL);
  assert.throws(() => tailnetOrigins('100.100.100.100'), /DNS name/);
  assert.throws(() => tailnetOrigins('outside.example.com'), /DNS name/);
  for (const issuer of [`http://${host}:8000`, 'https://other.example.ts.net:8000', `https://${host}:9000`]) {
    assert.throws(() => settings({ ...config, identity: { ...config.identity, CASDOOR_PUBLIC_URL: issuer } }));
  }
});

test('changing origin profiles does not silently overwrite existing identity configuration', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'waypoint-dev-origins-'));
  try {
    const config = await loadConfig(dir, true);
    await assert.rejects(() => loadConfig(dir, true, undefined, 'test-node.example.ts.net'), /another origin/);
    assert.ok((await loadConfig(dir, false)).identity.AUTH_CLIENT_SECRET === config.identity.AUTH_CLIENT_SECRET);
    assert.equal((await loadConfig(dir, false)).identity.APP_PUBLIC_URL, 'http://localhost:5178');
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
