import { spawnSync } from 'node:child_process';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { generate } from '../auth/casdoor/generate.mjs';
import { writeBootstrap } from '../auth/casdoor/provision.mjs';
import { databaseName, installSnapshot, sampleDatabaseName, sampleSnapshot, snapshotFile, validateSnapshot } from './database.mjs';
import { composeEnvironment, loadConfig, originProfile, project, saveConfig, settings, withLock, writeComposeEnv } from './config.mjs';
import { checkServe, nodeHostname } from './tailnet.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const stateDir = resolve(root, 'tmp/dev');

function run(command, args, { capture = false, env = process.env, output } = {}) {
  const stdio = output === undefined ? (capture ? ['ignore', 'pipe', 'pipe'] : 'inherit') : ['ignore', output, 'inherit'];
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', stdio });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).${capture ? ` Check ${command} access and configuration.` : ' See the command output above.'}`);
  return result.stdout;
}

export function composeArgs(args) {
  return ['compose', '--project-directory', root, '-f', resolve(root, 'docker-compose.dev.yml'), '-p', project, ...args];
}

function compose(config, args) {
  return run('docker', composeArgs(args), { env: { ...process.env, ...composeEnvironment(config) } });
}

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function snapshot(config) {
  const directory = resolve(stateDir, 'snapshots');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = resolve(directory, `${Date.now()}-${randomUUID()}.db`);
  if (config.source.file) {
    await snapshotFile(config.source.file, destination);
  } else {
    const container = config.source.container;
    if (!container || container.startsWith('-')) throw new Error('A production source container is required');
    const info = JSON.parse(run('docker', ['inspect', container], { capture: true }))[0];
    const entry = info.Config.Env.find((item) => item.startsWith('NET_WORTH_ESTIMATOR_DB='));
    const source = entry?.slice(entry.indexOf('=') + 1) || '/data/net-worth-estimator.db';
    if (!source.startsWith('/') || resolve(source) !== source || !info.Mounts.some((mount) => source.startsWith(`${mount.Destination}/`))) {
      throw new Error('The production database must be an absolute path inside a mounted volume');
    }
    const owner = run('docker', ['exec', container, 'stat', '-c', '%u:%g', source], { capture: true }).trim();
    if (!/^[1-9]\d*:\d+$/.test(owner)) throw new Error('Automatic snapshots require a non-root database owner. Use --from with a SQLite backup instead.');
    // The source volume is read-only. The helper has no network or capabilities.
    run('docker', ['build', '-q', '-f', 'dev/snapshot.Dockerfile', '-t', 'waypoint-dev-snapshot:local', '.']);
    const output = await open(destination, 'wx', 0o600);
    try {
      run('docker', ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges:true', '--user', owner, '--tmpfs', '/tmp:rw,noexec,nosuid,size=512m',
        '--volumes-from', `${container}:ro`, 'waypoint-dev-snapshot:local', source, '--stdout'], { output: output.fd });
      validateSnapshot(destination);
    } catch (error) {
      await unlink(destination);
      throw error;
    } finally {
      await output.close();
    }
  }
  return destination;
}

async function setup(config) {
  if (originProfile(config.identity.APP_PUBLIC_URL, config.identity.CASDOOR_PUBLIC_URL)) {
    checkServe(config, JSON.parse(run('tailscale', ['status', '--json'], { capture: true })),
      JSON.parse(run('tailscale', ['serve', 'status', '--json'], { capture: true })));
  }
  const identityDir = resolve(stateDir, 'casdoor');
  if (!await exists(resolve(identityDir, 'conf/app.conf'))) await generate(settings(config), identityDir);
  if (!await exists(resolve(stateDir, 'data', databaseName))) await installSnapshot(await snapshot(config), resolve(stateDir, 'data'), resolve(stateDir, 'backups'));
  const bootstrapPath = resolve(identityDir, 'bootstrap.json');
  if (!await exists(bootstrapPath)) {
    compose(config, ['up', '-d', '--wait', 'casdoor']);
    await writeBootstrap(settings(config), identityDir);
  }
  const bootstrap = JSON.parse(await readFile(bootstrapPath, 'utf8'));
  if (bootstrap.issuer !== config.identity.CASDOOR_PUBLIC_URL || bootstrap.client_id !== config.identity.AUTH_CLIENT_ID ||
    bootstrap.redirect_uri !== `${config.identity.APP_PUBLIC_URL}/v1/auth/callback` || bootstrap.username !== config.identity.CASDOOR_USER_NAME) {
    throw new Error('Dev identity metadata does not match its saved configuration');
  }
  if (config.ownerSubject === null) {
    config.ownerSubject = bootstrap.subject;
    await saveConfig(stateDir, config);
  }
  if (!config.ownerSubject) throw new Error('Existing dev data needs an explicit ownerSubject in tmp/dev/config.json. Assign the verified owner before startup; no account inherits this plan automatically.');
  await writeComposeEnv(config, resolve(root, '.env.dev'));
  console.log(`Dev setup ready: ${config.identity.APP_PUBLIC_URL} (Casdoor: ${config.identity.CASDOOR_PUBLIC_URL})`);
  console.log('Start with: docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build --wait');
}

export async function main(args) {
  process.umask(0o077);
  const { values, positionals } = parseArgs({ args, allowPositionals: true,
    options: { from: { type: 'string' }, tailnet: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  const [command] = positionals;
  if (values.help) {
    console.log('Usage: scripts/dev setup [--tailnet] [--from backup.db] | refresh-db [--from backup.db] | publish-sample [--from approved-snapshot.db]');
    return;
  }
  if (command === 'grant') throw new Error('Access is automatic for each account\'s own plan. Casdoor manages resource permissions; no global editor grant is needed.');
  if (!['setup', 'refresh-db', 'publish-sample'].includes(command)) throw new Error('Use scripts/dev setup once. Use docker compose --env-file .env.dev -f docker-compose.dev.yml for up, down, ps, and logs.');
  if (positionals.length > 1) throw new Error('Unexpected dev arguments. Use scripts/dev --help.');
  if (values.tailnet && command !== 'setup') throw new Error('--tailnet applies only to setup');
  const source = values.from ? { file: resolve(values.from) } : undefined;
  await withLock(stateDir, async () => {
    const hostname = values.tailnet ? nodeHostname(JSON.parse(run('tailscale', ['status', '--json'], { capture: true }))) : undefined;
    const config = await loadConfig(stateDir, command === 'setup', source, hostname);
    if (command === 'setup') {
      if (source && await exists(resolve(stateDir, 'data', databaseName))) {
        throw new Error('Dev data already exists. Use refresh-db --from to replace it explicitly.');
      }
      if (source) { config.source = source; await saveConfig(stateDir, config); }
      await setup(config);
    } else if (command === 'publish-sample') {
      if (!config.ownerSubject) throw new Error('Assign the verified primary ownerSubject before publishing a sample.');
      const incoming = resolve(stateDir, 'snapshots', `sample-${Date.now()}-${randomUUID()}.db`);
      await mkdir(resolve(stateDir, 'snapshots'), { recursive: true, mode: 0o700 });
      await sampleSnapshot(source?.file ?? resolve(stateDir, 'data', databaseName), incoming);
      compose(config, ['stop', 'backend']);
      try {
        await installSnapshot(incoming, resolve(stateDir, 'data'), resolve(stateDir, 'backups'), sampleDatabaseName);
      } finally { compose(config, ['start', '--wait', 'backend']); }
      console.log('Sample snapshot published. Guests can read this financial data. The private primary plan and all account plans remain separate.');
    } else if (command === 'refresh-db') {
      if (source) config.source = source;
      const incoming = await snapshot(config);
      compose(config, ['stop', 'backend']);
      try {
        await installSnapshot(incoming, resolve(stateDir, 'data'), resolve(stateDir, 'backups'));
        await saveConfig(stateDir, config);
      } finally {
        compose(config, ['start', '--wait', 'backend']);
      }
      console.log('Dev financial database refreshed. The prior copy is in tmp/dev/backups/. Identity state is unchanged.');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
