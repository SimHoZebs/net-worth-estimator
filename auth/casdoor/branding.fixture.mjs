// Optional, disposable fixture. Never reads repository identity state or env secrets.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { generate, settingsFromEnv } from './generate.mjs';
import { brandingFields } from './branding.mjs';
import { writeBootstrap } from './provision.mjs';

export async function startBrandingFixture(binary, build) {
  if (!binary || !build) throw new Error('Explicit copied Casdoor binary and build paths are required');
  binary = await realpath(binary);
  build = await realpath(build);
  // This asset name identifies the frontend in the repository's pinned image.
  if (!(await readFile(resolve(build, 'index.html'), 'utf8')).includes('/assets/index-cnXxJbP8.js')) {
    throw new Error('Expected the copied frontend from the pinned Casdoor v4.23.0 image');
  }
  const socket = createServer();
  await new Promise((done, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', done); });
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  const root = await mkdtemp(resolve(tmpdir(), 'waypoint-branding-provider-'));
  const secret = () => randomBytes(24).toString('hex');
  const settings = settingsFromEnv({
    CASDOOR_PUBLIC_URL: `http://127.0.0.1:${port}`, APP_PUBLIC_URL: 'http://localhost:18882',
    AUTH_CLIENT_ID: 'branding-fixture', AUTH_CLIENT_SECRET: secret(),
    CASDOOR_ADMIN_PASSWORD: secret(), CASDOOR_USER_NAME: 'branding-fixture', CASDOOR_USER_PASSWORD: secret(),
  });
  await generate(settings, root);
  const configPath = resolve(root, 'conf/app.conf');
  const config = (await readFile(configPath, 'utf8'))
    .replace('httpport = 8000', `httpport = ${port}\nhttpaddr = 127.0.0.1`)
    .replace('file:/data/casdoor.db', `file:${root}/db/casdoor.db`)
    .replace('frontendBaseDir = /web/build', `frontendBaseDir = ${build}`)
    .replace('initDataFile = /conf/init_data.json', `initDataFile = ${root}/conf/init_data.json`);
  await writeFile(configPath, config, { mode: 0o600 });
  const seedPath = resolve(root, 'conf/init_data.json');
  const seed = JSON.parse(await readFile(seedPath, 'utf8'));
  const application = seed.applications.find((app) => app.name === 'waypoint');
  // Exercise an existing instance, not just the new-seed path.
  for (const field of brandingFields) delete application[field];
  application.title = 'Before Waypoint branding';
  application.formBackgroundUrl = 'https://example.invalid/previous-background.svg';
  await writeFile(seedPath, `${JSON.stringify(seed)}\n`, { mode: 0o600 });
  await mkdir(resolve(root, 'tmp'), { mode: 0o700 });

  let output = '';
  let spawnError;
  const child = spawn(binary, [], { cwd: root, env: { PATH: process.env.PATH, HOME: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', (error) => { spawnError = error; });
  const capture = (data) => { output = (output + data).slice(-32_768); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((done) => child.once('exit', done));
      child.kill('SIGTERM');
      await exited;
    }
  };
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (spawnError || child.exitCode !== null) throw new Error('Disposable Casdoor failed to start');
      try {
        const response = await fetch(`${settings.publicUrl}/api/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) break;
      } catch { /* Only this fixture's loopback listener is polled. */ }
      await setTimeout(200);
    }
    await writeBootstrap(settings, root);
  } catch (error) {
    await stop();
    await writeFile(resolve(root, 'provider.log'), output, { mode: 0o600 });
    throw new Error(`${error.message}. Disposable diagnostics: ${root}/provider.log`);
  }
  return { root, settings, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await startBrandingFixture(process.env.CASDOOR_BRANDING_TEST_SERVER, process.env.CASDOOR_BRANDING_TEST_BUILD);
  const { brandingTarget, brandingPlan, applyBranding } = await import('./apply-branding.mjs');
  try {
    const target = brandingTarget({ CASDOOR_PUBLIC_URL: fixture.settings.publicUrl, AUTH_CLIENT_ID: fixture.settings.clientId });
    await applyBranding(brandingPlan(target), { stateDir: fixture.root,
      backupFile: resolve(fixture.root, 'branding-before.json'), adminPassword: fixture.settings.adminPassword });
  } catch (error) {
    await fixture.stop();
    throw error;
  }
  console.log(`Disposable branding fixture: ${fixture.settings.publicUrl}`);
  console.log(`Disposable state: ${fixture.root}`);
  console.log(`Preview process: ${process.pid}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await fixture.stop(); });
}
