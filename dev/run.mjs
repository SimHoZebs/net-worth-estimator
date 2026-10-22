import { spawnSync } from 'node:child_process';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { generate } from '../auth/casdoor/generate.mjs';
import { writeBootstrap } from '../auth/casdoor/provision.mjs';
import { databaseName, installSnapshot, snapshotFile, validateSnapshot } from './database.mjs';
import { composeEnvironment, loadConfig, project, saveConfig, settings, withLock } from './config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const stateDir = resolve(root, 'tmp/dev');
const composeFiles = ['docker-compose.yml', 'auth/compose.casdoor.yml', 'dev/compose.yml'];

function run(command, args, { capture = false, env = process.env, output } = {}) {
  const stdio = output === undefined ? (capture ? ['ignore', 'pipe', 'pipe'] : 'inherit') : ['ignore', output, 'inherit'];
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', stdio });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).${capture ? ' Check Docker access and the configured source container.' : ' See the command output above.'}`);
  return result.stdout;
}

export function composeArgs(args) {
  return ['compose', '--project-directory', root, ...composeFiles.flatMap((path) => ['-f', resolve(root, path)]), '-p', project, ...args];
}

function compose(config, args, capture = false) {
  return run('docker', composeArgs(args), { capture, env: composeEnvironment(config, stateDir) });
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

async function up(config) {
  const identityDir = resolve(stateDir, 'casdoor');
  if (!await exists(resolve(identityDir, 'conf/app.conf'))) await generate(settings(config), identityDir);
  if (!await exists(resolve(stateDir, 'data', databaseName))) await installSnapshot(await snapshot(config), resolve(stateDir, 'data'), resolve(stateDir, 'backups'));
  compose(config, ['up', '-d', '--wait', 'casdoor']);
  const bootstrapPath = resolve(identityDir, 'bootstrap.json');
  if (!await exists(bootstrapPath)) await writeBootstrap(settings(config), identityDir);
  const bootstrap = JSON.parse(await readFile(bootstrapPath, 'utf8'));
  if (bootstrap.issuer !== config.identity.CASDOOR_PUBLIC_URL || bootstrap.client_id !== config.identity.AUTH_CLIENT_ID ||
    bootstrap.redirect_uri !== `${config.identity.APP_PUBLIC_URL}/v1/auth/callback` || bootstrap.username !== config.identity.CASDOOR_USER_NAME) {
    throw new Error('Dev identity metadata does not match its saved configuration');
  }
  if (config.editors === null) {
    config.editors = [bootstrap.subject];
    await saveConfig(stateDir, config);
  }
  compose(config, ['up', '-d', '--build', '--wait']);
  console.log('Dev ready: http://localhost:5178 (Casdoor: http://localhost:8000)');
}

export async function main(args) {
  process.umask(0o077);
  const { values, positionals } = parseArgs({ args, allowPositionals: true,
    options: { from: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  const [command = 'up', subject, role = 'editor'] = positionals;
  if (values.help) {
    console.log('Usage: scripts/dev up [--from backup.db] | down | refresh-db [--from backup.db] | status | logs [service] | grant SUBJECT [reader|editor]');
    return;
  }
  if (!['up', 'down', 'refresh-db', 'status', 'logs', 'grant'].includes(command)) throw new Error('Unknown dev command. Use scripts/dev --help.');
  const maxArguments = command === 'grant' ? 3 : command === 'logs' ? 2 : 1;
  if (positionals.length > maxArguments) throw new Error('Unexpected dev arguments. Use scripts/dev --help.');
  if (values.from && !['up', 'refresh-db'].includes(command)) throw new Error('--from applies only to up or refresh-db');
  const source = values.from ? { file: resolve(values.from) } : undefined;
  if (['logs', 'status'].includes(command)) {
    const config = await loadConfig(stateDir, false);
    compose(config, command === 'status' ? ['ps'] : ['logs', '-f', ...(subject ? [subject] : [])]);
    return;
  }
  await withLock(stateDir, async () => {
    if (command === 'down' && !await exists(resolve(stateDir, 'config.json'))) return;
    const config = await loadConfig(stateDir, command === 'up', source);
    if (command === 'up') {
      if (source && await exists(resolve(stateDir, 'data', databaseName))) {
        throw new Error('Dev data already exists. Use refresh-db --from to replace it explicitly.');
      }
      if (source) { config.source = source; await saveConfig(stateDir, config); }
      await up(config);
    } else if (command === 'down') {
      compose(config, ['down']);
      console.log('Dev stopped. Financial data, identities, passkeys, and sessions are retained in tmp/dev/.');
    } else if (command === 'refresh-db') {
      if (source) config.source = source;
      const incoming = await snapshot(config);
      compose(config, ['stop', 'backend']);
      try {
        await installSnapshot(incoming, resolve(stateDir, 'data'), resolve(stateDir, 'backups'));
        await saveConfig(stateDir, config);
      } finally {
        compose(config, ['up', '-d', '--wait', 'backend']);
      }
      console.log('Dev financial database refreshed. The prior copy is in tmp/dev/backups/. Identity state is unchanged.');
    } else if (command === 'grant') {
      if (!subject || subject === '*' || subject.includes(',') || !['reader', 'editor'].includes(role)) throw new Error('Use grant VERIFIED_SUBJECT reader|editor');
      config.editors = (config.editors ?? []).filter((item) => item !== subject);
      config.readers = config.readers.filter((item) => item !== subject);
      config[role === 'editor' ? 'editors' : 'readers'].push(subject);
      await saveConfig(stateDir, config);
      compose(config, ['up', '-d', '--wait', 'backend']);
      console.log('Dev grant applied. Reload the application.');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
