# Net Worth Estimator Backend

Go API and SQLite persistence for household financial records, account maintenance, current position, evidence Analysis, and SimpleFIN protocol v2 synchronization. Deterministic and stochastic projections add future outcomes and configured evaluations. Financial records remain available independently of future simulation. `PRODUCT_INTENT.md` describes the product independently.

## Parts

| Part | Start here |
| --- | --- |
| Backend API and frontend | [deploy](deploy/README.md) |
| Better Auth identity | [auth](auth/README.md) |
| Purchase capture extension | [extension](extension/README.md) |
| ML judgment service | [ml](ml/README.md) |
| Local development | [dev](dev/README.md) |

Deep references for design and policy detail: [technical overview](TECHNICAL_OVERVIEW.md), [testing](TESTING.md), [shared database](docs/shared-database.md), [authentication](docs/authentication.md), [authorization](docs/authorization.md), [purchase queue](docs/purchase-queue.md), [judgment providers](docs/judgment-providers.md).

## Develop

Run `./dev/main.mjs setup` once, then the dedicated dev Compose stack:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build --wait
docker compose --env-file .env.dev -f docker-compose.dev.yml down
```

Use **http://localhost:5178**, or the HTTPS URL printed by setup for tailnet access. Data operations, tailnet setup, and state recovery are in the dev runbook.

## Deploy

The split deployment builds a Go API image and an Nginx frontend image. The frontend proxies `/v1` to the API under one public origin. The runtime and reverse-proxy contracts, provider guides, and migration steps are in the deployment runbook.

Better Auth on Bun authenticates users in dev and production. The Go API verifies OIDC and embeds Casbin for application-owned authorization. Setup is in the auth runbook.

## Persistence

One application SQLite file holds each user's financial data, including the guest's data, and application sessions. Every financial table is user-scoped, and the verified issuer and subject identify its owner. There is no HTTP reset route. The server never reads seed directories and never creates or repairs the schema; database setup is a deployment step handled by `setupdb`. SimpleFIN sync rows are not garbage-collected; keep mappings valid or purge the source rows deliberately with `backend/scripts/purge-simplefin-sync.sql`.

## Testing

Use `./scripts/test` as the single entry point. Layers, gates, and prerequisites are in the testing guide.
