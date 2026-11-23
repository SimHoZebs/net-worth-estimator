# River implementation of the judgment provider

This service is one implementation of the application-owned judgment boundary described in the judgment providers document. Other models, rules, or human queues can replace it without changing payment classifications. The application owns evidence, deterministic pattern detection, financial safety, saved findings, and explicit review decisions. The provider owns how an assessment is produced. The application knows only immutable domain requests, opaque revisions, and domain judgments. Requests batch at 100. Each judgment is `ready` with a supported, unsupported, or uncertain decision, or `pending` and `unavailable` when deterministic findings stand and the run retries. Providers change their opaque revision when policy or available decisions change, which triggers another run without a bank sync.

One deployment-wide River model learns from everyone's explicit confirm and reject feedback; bank evidence, findings, and saved review decisions remain user-scoped. The pipeline is StandardScaler plus logistic regression. Before two examples for a classification since initialization, the immutable domain question and observed signals determine the assessment. Probabilities at least `ML_THRESHOLD_HIGH` (default 0.75) map to supported, at most `ML_THRESHOLD_LOW` (default 0.25) to unsupported, and intermediate values to uncertain; decisive assessments have strong strength and uncertain assessments moderate strength. These are implementation choices, not application policies. Classification and feature interactions are hashed into 32,768 buckets, and classification counts stay separate so income answers do not end rent cold start. The shared `FEATURE_BUCKETS` constant in `evidence.py` is the single source of truth; the kind-prefix hashing scheme is unchanged, only the modulus grew from 8,192.

Category judgments share this deployment-wide learner as binary `category:<KEY>` kinds for the sixteen transaction-category keys. Each category request is per-transaction with a content-hash patternId, occurrenceCount 1, empty cadence, no annualized estimate, and one sample. Cold start stays per kind so warmed payment counts never answer a category, and warm category counts arrive only through regenerated seed.

`ML_THRESHOLD_HIGH` defaults to 0.75 and `ML_THRESHOLD_LOW` defaults to 0.25. Startup fails visibly unless `0 < low < high < 1`. The effective thresholds and the bucket count are part of the opaque provider revision `payments-v2:b32768:h<high>:l<low>:<generation>:<revision>`, so any threshold change invalidates saved findings and triggers a rescore. `POST /state` reports the revision string.

## Endpoints

- `GET /health` checks storage availability.
- `POST /state` takes an owner and returns an opaque shared revision and delivery cursor.
- `POST /evaluate` takes `{"requests":[...]}` and returns `{"judgments":[...]}`.
- `POST /feedback` takes `owner`, `after`, `cursor`, and `feedback`, and returns the acknowledged cursor. Each observation contains `eventId`, `runId`, `action`, and the original domain request.

The Go HTTP adapter owns orchestration; the service owns idempotency and persistence. SQLite commits model updates, event receipts, and the delivery cursor together, so lost responses cannot train twice. Conflicting retries return 409, invalid requests 400, and persistence or evaluation failures a logged 503.

## Deployment

Set `ML_JUDGMENT_URL` on the backend; without it the application remains deterministic. Run exactly one River instance per deployment. The default binding is `127.0.0.1:8766`, and the container binds `0.0.0.0:8766` for private networks. The endpoints are unauthenticated and must not be internet-exposed; apply the API's financial-data access controls to this service and its volume.

The [Northflank Sandbox deployment](../../deploy/northflank/README.md) packages this provider beside Go in the existing API service to retain the free tier resource count. That is an infrastructure choice; the provider contract and the default Go-only backend image remain independent of Python and co-location.

Mount persistent storage at `/data`; `ML_MODEL_PATH` defaults to `/data/ml.sqlite3`. Use SQLite's backup API for consistent backups. River state is a trusted local pickle inside SQLite, never client-uploaded data, and corrupt or incompatible state fails visibly. Changing feature engineering or model policy requires a corresponding provider revision change. An 8,192-bucket database from the previous `payments-v1` revision cannot load into this `payments-v2` code: startup raises a `ValueError` telling the operator to configure a fresh `ML_MODEL_PATH` and archive the old DB. There is no runtime migration, fallback, or silent reset. Existing income state requires the explicit offline payment-patterns upgrade; there is no runtime legacy conversion or silent reset.

```bash
docker build -f ml/Dockerfile -t ml .
docker run --rm --name ml -p 127.0.0.1:8766:8766 \
  -v ml:/data ml
docker run --rm --network none ml \
  python -B -m unittest discover -s /app -p 'test_*.py' -v
```
