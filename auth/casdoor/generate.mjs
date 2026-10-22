import { mkdir, writeFile, chmod, stat, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildBranding } from './branding.mjs';
import { buildPermissionSeed } from './permissions.mjs';

export const defaultStateDir = resolve(dirname(fileURLToPath(import.meta.url)), 'data');

export function origin(value, name) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !loopback)) {
    throw new Error(`${name} requires HTTPS except on loopback`);
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an origin without credentials, path, query, or fragment`);
  }
  return url.origin;
}

export function settingsFromEnv(env) {
  const required = (name) => {
    if (!env[name]) throw new Error(`${name} is required`);
    return env[name];
  };
  const secret = (name) => {
    const value = required(name);
    if (!/^[A-Za-z0-9_-]{16,72}$/.test(value)) {
      throw new Error(`${name} must contain 16–72 URL-safe characters`);
    }
    return value;
  };
  const settings = {
    publicUrl: origin(required('CASDOOR_PUBLIC_URL'), 'CASDOOR_PUBLIC_URL'),
    appUrl: origin(required('APP_PUBLIC_URL'), 'APP_PUBLIC_URL'),
    clientId: required('AUTH_CLIENT_ID'),
    clientSecret: secret('AUTH_CLIENT_SECRET'),
    adminPassword: secret('CASDOOR_ADMIN_PASSWORD'),
    username: required('CASDOOR_USER_NAME'),
    password: secret('CASDOOR_USER_PASSWORD'),
    email: env.CASDOOR_USER_EMAIL || '',
    displayName: env.CASDOOR_USER_DISPLAY_NAME || required('CASDOOR_USER_NAME'),
  };
  settings.browserOrigins = {};
  if (env.NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS) {
    const aliases = JSON.parse(env.NET_WORTH_ESTIMATOR_AUTH_BROWSER_ORIGINS);
    if (!aliases || Array.isArray(aliases) || typeof aliases !== 'object') {
      throw new Error('AUTH_BROWSER_ORIGINS must map app origins to Casdoor origins');
    }
    for (const [app, provider] of Object.entries(aliases)) {
      const appUrl = origin(app, 'browser app URL');
      const providerUrl = origin(provider, 'browser Casdoor URL');
      if (appUrl === settings.appUrl && providerUrl !== settings.publicUrl) {
        throw new Error('AUTH_BROWSER_ORIGINS cannot replace the primary browser endpoint');
      }
      if (new URL(appUrl).protocol !== new URL(settings.appUrl).protocol
        || new URL(appUrl).protocol !== new URL(providerUrl).protocol) {
        throw new Error('Browser aliases must use the primary app scheme');
      }
      settings.browserOrigins[appUrl] = providerUrl;
    }
    const appHosts = new Set([settings.appUrl, ...Object.keys(settings.browserOrigins)].map(value => new URL(value).host));
    for (const provider of [settings.publicUrl, ...Object.values(settings.browserOrigins)]) {
      if (appHosts.has(new URL(provider).host)) throw new Error('Browser app and provider hosts must be distinct');
    }
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(settings.clientId)) {
    throw new Error('AUTH_CLIENT_ID must contain 1–100 URL-safe characters');
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(settings.username)) {
    throw new Error('CASDOOR_USER_NAME must contain 1–64 URL-safe characters');
  }
  if (settings.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email)) {
    throw new Error('CASDOOR_USER_EMAIL must be an email address');
  }
  if (settings.displayName.length > 128 || /[\r\n]/.test(settings.displayName)) {
    throw new Error('CASDOOR_USER_DISPLAY_NAME must fit on one line within 128 characters');
  }
  const backchannel = new URL(env.CASDOOR_BACKCHANNEL_LOGOUT_URL || `${settings.appUrl}/v1/auth/backchannel-logout`);
  if (!['http:', 'https:'].includes(backchannel.protocol) || backchannel.username || backchannel.password || backchannel.search || backchannel.hash || backchannel.pathname !== '/v1/auth/backchannel-logout') {
    throw new Error('CASDOOR_BACKCHANNEL_LOGOUT_URL must be an HTTP/S URL ending in /v1/auth/backchannel-logout without credentials or query');
  }
  settings.backchannelUrl = backchannel.href;
  if (new Set([settings.clientSecret, settings.adminPassword, settings.password]).size !== 3) {
    throw new Error('Use a different secret for every credential');
  }
  return settings;
}

export function buildSeed(settings) {
  return {
    ...buildPermissionSeed(),
    organizations: [{
      owner: 'admin', name: 'waypoint', displayName: 'Waypoint',
      websiteUrl: settings.appUrl, passwordType: 'bcrypt', passwordOptions: ['AtLeast8'],
      countryCodes: ['US'], languages: ['en'], defaultApplication: 'waypoint',
      defaultTokenFormat: 'JWT', isProfilePublic: false, dcrPolicy: 'disabled',
    }],
    applications: [
      // Merge only these fields into the built-in app. Preserve its protections and keys.
      { owner: 'admin', name: 'app-built-in', enableSignUp: false, disableSelfSignup: true },
      {
        owner: 'admin', name: 'waypoint', displayName: 'Waypoint',
        ...buildBranding(),
        organization: 'waypoint', cert: 'cert-waypoint',
        homepageUrl: `${settings.appUrl}/`, enablePassword: true,
        enableSignUp: true, disableSelfSignup: false, enableWebAuthn: true,
        enableSigninSession: true, enableAutoSignin: true,
        clientId: settings.clientId, clientSecret: settings.clientSecret,
        signinMethods: [
          { name: 'Password', displayName: 'Password', rule: 'All' },
          { name: 'WebAuthn', displayName: 'Passkey', rule: 'None' },
        ],
        signinItems: [
          ...['Signin methods', 'Username', 'Password', 'Login button'].map((name) => ({ name, visible: true, rule: 'None' })),
          // Casdoor attaches its remember-browser checkbox to this item, even when hidden.
          { name: 'Forgot password?', visible: false, rule: 'Auto sign in - True' },
          { name: 'Signup link', visible: true, rule: 'None' },
        ],
        signupItems: [
          { name: 'ID', visible: false, required: true, prompted: false, rule: 'Random' },
          ...['Username', 'Display name', 'Password', 'Confirm password'].map((name) => ({
            name, visible: true, required: true, prompted: false, rule: 'None',
          })),
        ],
        grantTypes: ['authorization_code', 'refresh_token'],
        backchannelLogoutUri: settings.backchannelUrl,
        redirectUris: [...new Set([settings.appUrl, ...Object.keys(settings.browserOrigins || {})])]
          .flatMap(app => [`${app}/v1/auth/callback`, `${app}/`]),
        tokenFormat: 'JWT-Standard', tokenSigningMethod: 'RS256', expireInHours: 1,
        refreshExpireInHours: 720,
        cookieExpireInHours: 720, failedSigninLimit: 5, failedSigninFrozenTime: 15,
      },
    ],
    users: [{
      owner: 'waypoint', name: settings.username, type: 'normal-user',
      displayName: settings.displayName, email: settings.email,
      password: settings.password, signupApplication: 'waypoint',
      isAdmin: false, isForbidden: false, isDeleted: false,
    }],
    // AddCert creates a fresh key pair and x509 certificate. Merge mode preserves it.
    certs: [{
      owner: 'admin', name: 'cert-waypoint', displayName: 'Waypoint signing key',
      scope: 'JWT', type: 'x509', cryptoAlgorithm: 'RS256', bitSize: 4096, expireInYears: 2,
    }],
  };
}

export function buildConfig(settings) {
  return `appname = Waypoint identity
httpport = 8000
runmode = prod
copyrequestbody = true
driverName = sqlite
dataSourceName = file:/data/casdoor.db?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)
dbName = casdoor
showSql = false
origin = ${settings.publicUrl}
originFrontend = ${settings.publicUrl}
frontendBaseDir = /web/build
defaultApplication = waypoint
defaultLanguage = en
forceLanguage = en
isDemoMode = false
showGithubCorner = false
enableErrorMask = true
enableGzip = true
initAdminPassword = ${settings.adminPassword}
initDataFile = /conf/init_data.json
initDataNewOnly = false
initDataMerge = true
sessionCookieLifeTime = 2592000
logConfig = {"adapter":"console"}
`;
}

export async function generate(settings, stateDir = defaultStateDir) {
  // Refuse a second generation. Overwriting config can silently mismatch an existing DB.
  try {
    await stat(resolve(stateDir, 'conf/app.conf'));
    throw new Error('Config already exists. Keep it for restarts. Use a new state directory for fresh initialization.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const part of ['conf', 'db', 'sessions']) {
    try {
      if ((await readdir(resolve(stateDir, part))).length) {
        throw new Error('Identity state already exists. Restore its configuration instead of reinitializing it.');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  for (const part of ['', 'conf', 'db', 'sessions']) {
    const path = resolve(stateDir, part);
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
  }
  await writeFile(resolve(stateDir, 'conf/init_data.json'), `${JSON.stringify(buildSeed(settings), null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await writeFile(resolve(stateDir, 'conf/app.conf'), buildConfig(settings), { mode: 0o600, flag: 'wx' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await generate(settingsFromEnv(process.env), process.env.CASDOOR_STATE_DIR || defaultStateDir);
  console.log('Generated private Casdoor config and seed. Start the service, then run provision.mjs.');
}
