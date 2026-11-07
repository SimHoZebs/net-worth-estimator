# Vercel frontend

Use the repository root as the project directory and Node.js 24 or newer.
The root `vercel.mjs` exports programmatic configuration. It reads deployment
settings before the build and uses direct external rewrites, not Functions.

Set these variables in Vercel's Environment Variables settings:

| Variable | Example |
| --- | --- |
| `BACKEND_URL` | `https://your-api.onrender.com` |
| `NET_WORTH_ESTIMATOR_PUBLIC_URL` | `https://app.example.com` |
| `NET_WORTH_ESTIMATOR_PROXY_SECRET` | The same private secret as the API |
| `NET_WORTH_ESTIMATOR_AUTH_ISSUER` | The canonical Better Auth issuer origin |
| `NET_WORTH_ESTIMATOR_AUTH_CLIENT_ID` | The registered application client ID |
| `NET_WORTH_ESTIMATOR_AUTH_CLIENT_SECRET` | The registered application client secret |
| `NET_WORTH_ESTIMATOR_GUEST_SUBJECT` | The provisioned guest OIDC subject (anonymous traffic resolves to it) |
| `NET_WORTH_ESTIMATOR_AUTHZ_DB` | Private provisioned Casbin policy database path |

Both URLs must be HTTPS origins without paths or credentials. Configuration
fails on missing settings or unsafe secrets.
The upstream URL stays in routing configuration, outside the frontend bundle.
The secret uses a deployment environment reference, not a literal config value.

Only the configured frontend hostname matches the API proxy route. Alternate
Vercel hostnames serve static files but do not proxy API requests. Give previews
their own exact hostname, isolated backend, identity client, database, and secret.
Never give untrusted preview code production access. Register each callback and
post-logout URL during Better Auth provisioning explicitly.

Static files retain normal static-host behavior. Pages are real routes
served through an SPA catch-all rewrite to `index.html`; in-page interactions
are query parameters on the page URL. Unknown paths serve the app, which
normalizes them to the outlook landing page.

## Production deployment

Vercel's Git integration does not deploy production. `vercel.mjs` disables Git
deployments for `main`, and `.github/workflows/vercel-release.yml` creates a
production deployment through the Vercel REST API only after the `Tests`
workflow succeeds for the pushed `main` commit. Preview branches keep their Git
deployments.

The config pins Bun `1.4.x`. The frontend build runs `typecheck` once before
`vite build`, which needs Bun 1.4.

Vercel installs dependencies before it evaluates `vercel.mjs`. Set the
project-level Install Command so that first install also uses `.bun-version`:

```sh
vercel project update net-worth-estimator --scope simhozebs-projects \
  --install-command 'npx --yes bun@$(cat .bun-version) install --frozen-lockfile' --yes
```

The config-level Install Command cannot control that first install. Keep every
workspace package manifest in the upload. `.vercelignore` retains the auth
manifest but excludes its source, fixtures, and generated assets.

Set these repository settings in GitHub:

| Name | Kind | Value |
| --- | --- | --- |
| `VERCEL_TOKEN` | Secret | A project-scoped Vercel access token |
| `VERCEL_ORG_ID` | Variable | The Vercel team ID |
| `VERCEL_PROJECT_ID` | Variable | The Vercel project ID |

Create the token in Vercel account settings with project scope for this project
and a finite expiry. Vercel shows the value once. Store it with
`gh secret set VERCEL_TOKEN`. Until `VERCEL_PROJECT_ID` is set, the workflow
skips instead of failing.

The workflow creates a deployment with `gitSource` pinned to the exact tested
`main` commit, then polls it until `READY`. Vercel builds with the project's
production environment variables, so the runner does not need `BACKEND_URL`,
the public URL, or the proxy secret. A manual dispatch requests the current
`main` commit and requires a green `main` push Tests run for it.

Leave the project's Ignored Build Step empty. A skip command also cancels API
and CLI deployments. During a database or API-contract migration, disable the
deploy workflow for the window and run it again after Northflank finishes; see
[the migration SOP](MIGRATIONS.md).

See [the deployment index](README.md) for the shared runtime and reverse-proxy contracts.

## Provider references

- [Vercel programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts)
- [Pin the Bun version for builds](https://vercel.com/kb/guide/how-to-pin-a-specific-bun-version-for-vercel-builds)
- [Vercel external rewrites and secret headers](https://vercel.com/docs/routing/rewrites)
- [Vercel external-proxy inactivity timeout](https://vercel.com/changelog/cdn-origin-timeout-increased-to-two-minutes)
