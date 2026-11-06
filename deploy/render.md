# API on Render or another container host

The same image works on any host that meets the runtime contract. On Render:

| Setting | Value |
| --- | --- |
| Dockerfile | `backend/Dockerfile` |
| Build context | Repository root |
| Compute | Paid always-on service, one instance |
| Persistent disk | `/data` |
| Health-check path | `/readyz` |
| Normal Docker Command | Leave empty to use `/app/server` |

Set `HOST=0.0.0.0`, the provider's `PORT`, and
`NET_WORTH_ESTIMATOR_DB=/data/net-worth-estimator.db`. Supply Casdoor settings
from [the authentication guide](../docs/authentication.md). Set
`NET_WORTH_ESTIMATOR_PUBLIC_URL` to the frontend origin, not the API hostname.
For Vercel, also set the shared `NET_WORTH_ESTIMATOR_PROXY_SECRET`. Keep identity
and database credentials only on the API. Casdoor needs browser and API access.

The image runs as UID/GID `10001`. Its data mount must support that identity.
If permissions differ, ask the platform administrator to prepare disk ownership.
Do not run the API as root. A non-root shell and private SSH directory support
provider maintenance access.

### Explicit disk maintenance on Render

Render disks are unavailable during builds, pre-deploy commands, and one-off
jobs. Each disk belongs to one running instance. Disk-backed deployments have
downtime. Do not put SQLite setup in a pre-deploy command.

For initial setup or a schema upgrade, deploy an explicit maintenance process
instead of the API. Use this temporary Docker Command:

```sh
/bin/sh -c 'mkdir -p /tmp/maintenance; printf "maintenance\n" > /tmp/maintenance/readyz; exec busybox-extras httpd -f -p "$PORT" -h /tmp/maintenance'
```

This process serves only the maintenance directory and health-check file. It
runs no API, sessions, or scheduler. Use the service's normal non-ephemeral
Shell/SSH session, which has the attached disk. For a fresh database, execute:

```sh
/app/setupdb --db "$NET_WORTH_ESTIMATOR_DB"
```

Before guest-data publication, provision the destination row with the issuer
and guest subject from private `bootstrap.json` (`issuer` and `guest_subject`).
Otherwise, the first authorized access creates its empty workspace through the
same path as other users. The provider's viewer group limits guest access.
Repeat setup preserves existing database and user rows:

```sh
/app/setupdb --db "$NET_WORTH_ESTIMATOR_DB" --issuer "$ISSUER" --subject "$NET_WORTH_ESTIMATOR_GUEST_SUBJECT"
```

Hosts configured to use `/app/api-boot.sh` run schema setup only before
the server. That wrapper never provisions guest or other user workspaces.
Casdoor's initial deployment seed still creates the guest identity.

For existing data, restore a verified current-schema SQLite-safe backup or run a
separate one-time operator upgrade. `setupdb` only validates an existing schema,
and rejects older or incomplete ones. See the
[database maintenance contract](../docs/shared-database.md). Back up before schema
changes. Keep the API stopped. Ephemeral shells do not share the disk.

The pending [shared migration](MIGRATIONS.md) runs `/app/migrate.sh` from the
target image before API startup. It converts legacy checkpoint dates to UTC
day-close instants. It also enables settled bank rows and aligns their event
times with transaction times. Manual, pending, and void rows stay unchanged.
Legacy API-set exclusions are indistinguishable from the old import default,
so this one-time conversion enables those settled rows too. Final-schema
retries only verify and preserve later exclusions. Use the stopped-API
adapter with the original mount. Do not run a separate host-side converter.
After validation, clear the temporary Docker Command and redeploy. Normal API
startup never provisions storage. Repeat maintenance only for explicit operations.

See [the deployment index](README.md) for the shared runtime and reverse-proxy contracts.

## Provider references

- [Render Docker command overrides](https://render.com/docs/docker)
- [Render persistent-disk restrictions](https://render.com/docs/disks)
- [Render maintenance shell access](https://render.com/docs/ssh)
