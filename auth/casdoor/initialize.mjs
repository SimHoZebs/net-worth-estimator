import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, settingsFromEnv, defaultStateDir } from './generate.mjs';
import { writeBootstrap } from './provision.mjs';

const settings = settingsFromEnv(process.env);
const stateDir = resolve(process.env.CASDOOR_STATE_DIR || defaultStateDir);
await generate(settings, stateDir);
const compose = ['compose', '-f', resolve(dirname(fileURLToPath(import.meta.url)), 'compose.yml'),
  '-p', process.env.CASDOOR_PROJECT || 'waypoint-casdoor'];
function docker(args) {
  const result = spawnSync('docker', [...compose, ...args], {
    stdio: 'inherit', env: { ...process.env, CASDOOR_STATE_DIR: stateDir },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Casdoor Compose command failed. Generated private state remains for diagnosis.');
}
docker(['up', '-d', '--wait']);
await writeBootstrap(settings, stateDir);
console.log('Casdoor is ready after one startup. Read the generated subject from the private state directory bootstrap.json.');
