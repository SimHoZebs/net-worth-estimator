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
| `NET_WORTH_ESTIMATOR_AUTH_ISSUER` | The Casdoor issuer origin |
| `NET_WORTH_ESTIMATOR_AUTH_CLIENT_ID` | The registered application client ID |
| `NET_WORTH_ESTIMATOR_AUTH_CLIENT_SECRET` | The registered application client secret |
| `NET_WORTH_ESTIMATOR_OWNER_SUBJECT` | The verified owner OIDC subject |
| `NET_WORTH_ESTIMATOR_GUEST_SUBJECT` | The provisioned guest OIDC subject (anonymous traffic resolves to it) |
| `NET_WORTH_ESTIMATOR_AUTH_ORGANIZATION` | Optional; defaults to `waypoint` |

Both URLs must be HTTPS origins without paths or credentials. Configuration
fails on missing settings or unsafe secrets.
The upstream URL stays in routing configuration, outside the frontend bundle.
The secret uses a deployment environment reference, not a literal config value.

Only the configured frontend hostname matches the API proxy route. Alternate
Vercel hostnames serve static files but do not proxy API requests. Give previews
their own exact hostname, isolated backend, identity client, database, and secret.
Never give untrusted preview code production access. Register each callback and
post-logout URL in Casdoor explicitly.

Static files retain normal static-host behavior. Unknown paths return the
bundled 404 page. Fragment navigation requires no SPA catch-all rewrite.

See [the deployment index](README.md) for the shared runtime and reverse-proxy contracts.

## Provider references

- [Vercel programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts)
- [Vercel external rewrites and secret headers](https://vercel.com/docs/routing/rewrites)
- [Vercel external-proxy inactivity timeout](https://vercel.com/changelog/cdn-origin-timeout-increased-to-two-minutes)
