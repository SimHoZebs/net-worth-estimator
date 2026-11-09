# River implementation of the judgment provider

This service is one implementation of the application-owned
[judgment contract](../../docs/judgment-providers.md). Other models, rules, or
human queues can replace it without changing payment classifications. The application
knows only immutable domain requests, opaque revisions, and domain judgments.

## River-owned behavior

One deployment-wide River model learns from everyone's explicit confirm/reject
feedback. Bank evidence, findings, and saved review decisions remain user-scoped.
`evidence.py` converts immutable domain evidence into scaled numerical features
and categorical indicators. No feature vectors or training counts appear in the
application's request/result schema.

The internal pipeline is StandardScaler plus logistic regression. Before two
examples for a classification since initialization or drift reset, the immutable
domain question and observed signals determine the assessment. Afterwards, this
adapter maps probabilities at least 0.75 to supported, at most 0.25 to unsupported,
and intermediate values to uncertain. Decisive assessments have strong strength;
uncertain assessments have moderate strength. These are implementation choices,
not application policies or calibrated-probability claims. ADWIN monitors the
shared error stream and resets the learner and example counts on drift.
Classification/feature interactions are hashed into 8,192 buckets, bounding the
shared scaler/weight feature space without a separate model per classification.
Classification counts remain separate so income answers do not end rent cold start.

## Neutral private endpoints

- `GET /health` checks storage availability.
- `POST /state` takes an owner and returns an opaque shared revision plus that
  owner's delivery cursor.
- `POST /evaluate` takes `{"requests":[...]}` and returns
  `{"judgments":[{"requestId":"...","status":"ready","decision":"supported","strength":"strong","reason":"Assessment of rent: supported."}]}`.
- `POST /feedback` takes `owner`, `after`, `cursor`, and `feedback`. Each
  observation contains `eventId`, `runId`, `action`, and the original domain
  `request`. A successful call returns the acknowledged cursor, not learning
  metrics. This implementation converts confirm/reject actions into labels.

The Go HTTP adapter owns orchestration. The service owns idempotency and
persistence. SQLite commits model updates, event receipts, and delivery cursor
together. Lost responses cannot train twice. Failed writes leave both memory
and storage unchanged. No prediction cache is required. Conflicting replays
return 409, invalid requests 400, and persistence/evaluation failures a logged 503.

## Deployment

Set `INCOME_JUDGMENT_URL` on the backend. Without it, the application remains
deterministic. Run exactly one River instance per deployment. Default binding
is `127.0.0.1:8766`; the container binds `0.0.0.0:8766` for private networks.
The endpoints are unauthenticated and **must not be internet-exposed**. Original
transaction descriptions and other financial evidence now reach this adapter,
so apply the API's financial-data access controls to this service and its volume.

Separate services are not required. The [Northflank Sandbox deployment](../../deploy/northflank/README.md)
packages this provider beside Go in the existing API service to retain its free
tier resource count. That is an infrastructure choice; the provider contract and
the default Go-only backend image remain independent of Python and co-location.

Mount persistent storage at `/data`. `INCOME_MODEL_PATH` defaults to
`/data/income.sqlite3` in the image. Use SQLite's backup API for consistent
backups. The directory is created and checked at startup. River state is a
trusted local pickle inside SQLite, never client-uploaded data. Corrupt or
incompatible state fails visibly instead of silently resetting. Changing feature
engineering or model policy requires a corresponding provider revision change.

The directory and deployment settings retain their existing infrastructure names;
the learner accepts any bounded classification ID and the generic question schema.
Existing income state requires the explicit [offline upgrade and fresh learner
path](../../backend/scripts/one-time/payment-patterns/README.md). There is no
runtime legacy conversion or silent reset.

```bash
docker build -f sidecar/income/Dockerfile -t income-judgment .
docker run --rm --name income-judgment -p 127.0.0.1:8766:8766 \
  -v income-judgment:/data income-judgment
docker run --rm --network none income-judgment \
  python -B -m unittest discover -s /app -p 'test_*.py' -v
```
