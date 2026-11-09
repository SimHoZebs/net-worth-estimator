# Northflank Sandbox deployment

Co-locating Go and River is a **Northflank Sandbox deployment decision**, not a
feature requirement. The application depends only on the judgment provider
contract. Other deployments can use the default Go-only image and any compatible
separate provider at `INCOME_JUDGMENT_URL`, or omit it for deterministic analysis.

The explicit `northflank` target in `backend/Dockerfile` is published as
`net-worth-estimator-backend-northflank:sha-<commit>`. The default target remains
the standalone Go runtime. This target adds Python/River and a small process
supervisor. It runs River on loopback port 8766 and the API on its public port.
It waits for River storage readiness before booting the API. A child exit stops
both processes, allowing Northflank to restart the deployment. SIGTERM is forwarded
to both children with a bounded shutdown grace period.

Use `python /app/northflank-runtime.py` as the API service's custom command in
this deployment. The ordinary `/app/api-boot.sh` remains a Go-only boot command.
The release's maintenance command must bypass the supervisor so all API writers
stop before the shared offline migration. Restore the Northflank command only
after a successful migration. Do not change the identity provider or issuer as
part of adopting this packaging.

The existing API volume holds two independent databases:

- `/data/net-worth-estimator.db`: owner-scoped evidence and feedback audit.
- `/data/income.sqlite3`: River learner, deduplication receipts, and owner cursors.

No extra service, database addon, volume, GPU, or external model subscription is
needed. Keep the existing single API instance and `nf-compute-10` allocation
(0.1 vCPU, 256 MiB). BLAS threading is limited to one and Go's soft memory target
is 96 MiB in this target only. Measure the combined workload under those limits;
neither a successful image build nor the abstraction contract proves capacity.
The constrained image test exercises startup, feedback, duplicate delivery,
provider failure, persisted restart, and graceful shutdown at those limits.
The initial local run peaked at 171 MiB including in-container test clients;
this is a test workload measurement, not a production capacity guarantee.
This packaging adds coupled process lifetime and shared resource pressure, so a
larger deployment can independently move the provider without application edits.

River commits model and delivery state atomically. Persistent storage must be
backed up using SQLite's backup API. The application migration backup does not
include the River database. No automatic volume snapshot is assumed.
