# River implementation of the judgment provider

This service is one implementation of the application-owned [judgment contract](../../docs/judgment-providers.md). Other models, rules, or human queues can replace it without changing payment classifications. The application knows only immutable domain requests, opaque revisions, and domain judgments.

One deployment-wide River model learns from everyone's explicit confirm and reject feedback; bank evidence, findings, and saved review decisions remain user-scoped. The pipeline is StandardScaler plus logistic regression, with ADWIN drift reset. Before two examples for a classification since initialization or drift reset, the immutable domain question and observed signals determine the assessment. Probabilities at least 0.75 map to supported, at most 0.25 to unsupported, and intermediate values to uncertain; decisive assessments have strong strength and uncertain assessments moderate strength. These are implementation choices, not application policies. Classification and feature interactions are hashed into 8,192 buckets, and classification counts stay separate so income answers do not end rent cold start.

## Endpoints

- `GET /health` checks storage availability.
- `POST /state` takes an owner and returns an opaque shared revision and delivery cursor.
- `POST /evaluate` takes `{"requests":[...]}` and returns `{"judgments":[...]}`.
- `POST /feedback` takes `owner`, `after`, `cursor`, and `feedback`, and returns the acknowledged cursor. Each observation contains `eventId`, `runId`, `action`, and the original domain request.

The Go HTTP adapter owns orchestration; the service owns idempotency and persistence. SQLite commits model updates, event receipts, and the delivery cursor together, so lost responses cannot train twice. Conflicting replays return 409, invalid requests 400, and persistence or evaluation failures a logged 503.

## Deployment

Set `INCOME_JUDGMENT_URL` on the backend; without it the application remains deterministic. Run exactly one River instance per deployment. The default binding is `127.0.0.1:8766`, and the container binds `0.0.0.0:8766` for private networks. The endpoints are unauthenticated and must not be internet-exposed; apply the API's financial-data access controls to this service and its volume.

The [Northflank Sandbox deployment](../../deploy/northflank/README.md) packages this provider beside Go in the existing API service to retain the free tier resource count. That is an infrastructure choice; the provider contract and the default Go-only backend image remain independent of Python and co-location.

Mount persistent storage at `/data`; `INCOME_MODEL_PATH` defaults to `/data/income.sqlite3`. Use SQLite's backup API for consistent backups. River state is a trusted local pickle inside SQLite, never client-uploaded data, and corrupt or incompatible state fails visibly. Changing feature engineering or model policy requires a corresponding provider revision change. Existing income state requires the explicit [offline upgrade](../../backend/scripts/one-time/payment-patterns/README.md); there is no runtime legacy conversion or silent reset.

```bash
docker build -f sidecar/income/Dockerfile -t income-judgment .
docker run --rm --name income-judgment -p 127.0.0.1:8766:8766 \
  -v income-judgment:/data income-judgment
docker run --rm --network none income-judgment \
  python -B -m unittest discover -s /app -p 'test_*.py' -v
```
