import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { settingsFromEnv } from '../auth/casdoor/generate.mjs';

export const project = 'waypoint-dev';

export function newConfig(source = { container: 'net-worth-estimator' }) {
  const secret = () => randomBytes(24).toString('hex');
  return {
    version: 1, source, readers: [], editors: null,
    identity: {
      CASDOOR_PUBLIC_URL: 'http://localhost:8000', APP_PUBLIC_URL: 'http://localhost:5178',
      AUTH_CLIENT_ID: 'waypoint-dev', AUTH_CLIENT_SECRET: secret(),
      CASDOOR_ADMIN_PASSWORD: secret(), CASDOOR_USER_NAME: 'household',
      CASDOOR_USER_PASSWORD: secret(), CASDOOR_USER_DISPLAY_NAME: 'Development owner',
      CASDOOR_BACKCHANNEL_LOGOUT_URL: 'http://backend:8787/v1/auth/backchannel-logout',
    },
  };
}

export function settings(config) {
  if (config.version !== 1) throw new Error('Unsupported dev configuration version');
  if (!config.source || (typeof config.source.file === 'string') === (typeof config.source.container === 'string')) {
    throw new Error('Configure exactly one snapshot source: file or container');
  }
  if ((config.source.file !== undefined && (typeof config.source.file !== 'string' || !config.source.file.startsWith('/'))) ||
    (config.source.container !== undefined && (typeof config.source.container !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(config.source.container)))) {
    throw new Error('Snapshot sources require an absolute file path or a Docker container name');
  }
  const result = settingsFromEnv(config.identity);
  if (result.publicUrl !== 'http://localhost:8000' || result.appUrl !== 'http://localhost:5178') {
    throw new Error('Dev uses the fixed localhost frontend and identity origins');
  }
  for (const list of [config.readers, config.editors ?? []]) {
    if (!Array.isArray(list) || list.some((subject) => typeof subject !== 'string' || !subject || subject !== subject.trim() || subject === '*' || /[,\r\n]/.test(subject))) {
      throw new Error('Dev access requires explicit verified subjects');
    }
  }
  return result;
}

export function composeEnvironment(config, stateDir, inherited = process.env) {
  settings(config);
  return {
    ...inherited, ...config.identity,
    DEV_STATE_DIR: stateDir, DEV_UID: String(process.getuid()), DEV_GID: String(process.getgid()),
    CASDOOR_STATE_DIR: resolve(stateDir, 'casdoor'), CASDOOR_PORT: '8000',
    CASDOOR_UID: String(process.getuid()), CASDOOR_GID: String(process.getgid()),
    NET_WORTH_ESTIMATOR_AUTH_EDITORS: (config.editors ?? []).join(','),
    NET_WORTH_ESTIMATOR_AUTH_READERS: config.readers.join(','),
    NET_WORTH_ESTIMATOR_AUTH_SESSION_LIFETIME: '168h', NET_WORTH_ESTIMATOR_AUTH_RECHECK_INTERVAL: '30s',
    COMPOSE_PROFILES: '',
  };
}

export async function saveConfig(stateDir, config) {
  settings(config);
  const path = resolve(stateDir, 'config.json');
  const temporary = `${path}.${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  try { await rename(temporary, path); } finally { await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function loadConfig(stateDir, create, source) {
  try {
    const config = JSON.parse(await readFile(resolve(stateDir, 'config.json'), 'utf8'));
    settings(config);
    return config;
  } catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
  }
  const config = newConfig(source);
  await saveConfig(stateDir, config);
  return config;
}

// One short-lived lock protects bootstrap, grant edits, and financial refresh.
// Compose owns service processes. This file never acts as a process manager.
export async function withLock(stateDir, action) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const path = resolve(stateDir, 'operation.lock');
  let lock;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { lock = await open(path, 'wx', 0o600); break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await readFile(path, 'utf8'));
      let stale = false;
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); } catch (probe) { stale = probe.code === 'ESRCH'; }
      }
      if (!stale) throw new Error('Another dev command is active.');
      await unlink(path);
    }
  }
  if (!lock) throw new Error('Could not acquire the dev operation lock');
  try { await lock.writeFile(String(process.pid)); return await action(); }
  finally { await lock.close(); await unlink(path); }
}
