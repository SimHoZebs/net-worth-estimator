# Northflank Sandbox deployment

Co-locating Go and River is a **Northflank Sandbox deployment decision**, not a
feature requirement. The application depends only on the judgment provider
contract. Other deployments can use the default Go-only image and any compatible
separate provider at `ML_JUDGMENT_URL`, or omit it for deterministic analysis.

The explicit `northflank` target in `backend/Dockerfile` is published as
`net-worth-estimator-backend-northflank:sha-<commit>`. It adds Python, River, and
a small process supervisor. River runs on loopback port 8766, the API runs on its
public port, and the supervisor waits for River storage readiness before booting
the API. A child exit stops both processes, and SIGTERM is forwarded with a
bounded shutdown grace period.

Use `python /app/northflank-runtime.py` as the API service's custom command;
`/app/api-boot.sh` remains the Go-only boot command. The release maintenance
command must bypass the supervisor so all API writers stop before the offline
migration, and the Northflank command is restored only after a successful
migration. Do not change the identity provider or issuer as part of adopting
this packaging.

The existing API volume holds two independent databases:

- `/data/net-worth-estimator.db`: owner-scoped evidence and feedback audit.
- `/data/ml.sqlite3`: River learner, deduplication receipts, and owner cursors.

No extra service, database addon, volume, GPU, or external model subscription is
needed. Keep the existing single API instance and `nf-compute-10` allocation
(0.1 vCPU, 256 MiB). BLAS threading is limited to one and Go's soft memory target
is 96 MiB in this target only. Measure the combined workload under those limits;
a successful image build does not prove capacity. The constrained image test
exercises startup, feedback, duplicate delivery, provider failure, persisted
restart, and graceful shutdown at those limits.

River commits model and delivery state atomically. Back up persistent storage with SQLite's backup API; the application migration backup does not include the River database, and no automatic volume snapshot is assumed.

## Release webhook

At installation, replace `INJECT_PRIVATE_WEBHOOK_TOKEN` in `release.json`
with a new private token and keep that value when applying later definition
updates. Save the resulting webhook URL as the GitHub Actions secret through
standard input, never command arguments, and never commit the token or URL.
Northflank accepts `RELEASE_SHA`, `API_IMAGE`, and `IDENTITY_IMAGE` in the
URL query, not a POST body. `RELEASE_SHA` is recorded for identification;
the image references drive the deployment.
