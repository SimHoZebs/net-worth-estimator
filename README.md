# Net Worth Estimator Backend

Go API and SQLite persistence for household financial records, account maintenance, current position, evidence Analysis, and SimpleFIN protocol v2 synchronization. Deterministic and stochastic projections add future outcomes and configured evaluations. Financial records remain available independently of future simulation. `PRODUCT_INTENT.md` describes the product independently.

## Parts

| Part | Runbook | Contract |
| --- | --- | --- |
| Backend API | [deploy](deploy/README.md) | [technical overview](TECHNICAL_OVERVIEW.md), [shared database](docs/shared-database.md) |
| Frontend | [deploy](deploy/README.md) | [technical overview](TECHNICAL_OVERVIEW.md) |
| Better Auth identity | [auth](auth/README.md) | [authentication](docs/authentication.md), [authorization](docs/authorization.md) |
| Purchase capture extension | [extension](extension/README.md) | [purchase queue](docs/purchase-queue.md) |
| Income judgment sidecar | [sidecar/income](sidecar/income/README.md) | [judgment providers](docs/judgment-providers.md) |
| Local development | [dev](dev/README.md) | [testing](TESTING.md) |

## Develop

Run `./dev/main.mjs setup` once, then the dedicated dev Compose stack:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build --wait
docker compose --env-file .env.dev -f docker-compose.dev.yml down
```

Use **http://localhost:5178**, or the HTTPS URL printed by setup for tailnet access. See [the dev runbook](dev/README.md) for data operations, tailnet setup, and state recovery.

## Deploy

The split deployment builds a Go API image and an Nginx frontend image. The frontend proxies `/v1` to the API under one public origin. See [the deployment runbook](deploy/README.md) for the runtime and reverse-proxy contracts, provider guides, and the migration SOP.

Better Auth on Bun authenticates users in dev and production. The Go API verifies OIDC and embeds Casbin for application-owned authorization. See [the auth runbook](auth/README.md) and [the authentication contract](docs/authentication.md).

## Persistence

One application SQLite file holds each user's financial data, including the guest's data, and application sessions. Every financial table is user-scoped, and the verified issuer and subject identify its owner. There is no HTTP reset route. The server never reads seed directories and never creates or repairs the schema; database setup is a deployment step handled by `setupdb`. SimpleFIN sync rows are not garbage-collected; keep mappings valid or purge the source rows deliberately with `backend/scripts/purge-simplefin-sync.sql`. See [the shared database contract](docs/shared-database.md).

## Testing

Use `./scripts/test` as the single entry point. See [testing](TESTING.md) for the layers, gates, and prerequisites.
