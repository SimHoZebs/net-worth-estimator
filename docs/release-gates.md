# Release gates

Nothing ships until every gate below passes on the release commit. Run
gates locally; hosted CI does not run them. The Northflank workflow only
requests a gated deployment for the pushed SHA.

## 1. Automated test gates

Run the whole gate with one command:

```bash
scripts/test --gate
```

That single entry point checks install drift, generates the API client,
runs the backend, frontend, and extension gates, then runs the browser
suite in shards. `KEEP_GATE_LOGS=1` keeps per-group logs for forensics.
`scripts/test --all` covers unit then integration; `scripts/test --unit`
needs no servers, Docker, or credentials.

Backend gate (covers the calculation authority, persistence, HTTP/SSE
policy, and synchronization):

```bash
backend/scripts/verify.sh ./internal/domain/...
backend/scripts/verify.sh ./internal/api/...
backend/scripts/verify.sh ./internal/store
backend/scripts/verify.sh ./internal/simplefin
backend/scripts/verify.sh ./cmd/server
CGO_ENABLED=0 go -C backend build ./...
git diff --check
```

`backend/scripts/verify.sh` runs the formatter check, the vet check, and
the package tests with the production driver setting. The repository-wide
`backend/scripts/verify.sh` catches cross-package breakage.

Frontend gates (run from the repository root):

```bash
bun install --frozen-lockfile
bun --filter ./frontend lint
bun --filter ./frontend typecheck
bun --filter ./frontend test:unit
bun --filter ./frontend build
bun --filter ./frontend test:integration
```

The integration suite drives the real engine over real HTTP on random free
ports with a fresh temporary database per run. It never attaches to a dev
server. Each shard starts its own servers, so concurrent runs stay
isolated. Generate the API client before running frontend scripts
directly (`bun --filter ./frontend api:generate`); the gate runner
refreshes it so standalone runs never use a stale tree.

Extension gates:

```bash
bun --filter ./extension lint
bun --filter ./extension build
bun --filter ./extension test:browser
```

with unit coverage under `bun --filter ./extension test`. See
[extension setup and verification](../extension/README.md).

Cross-feature journeys (QA-03) must pass repeatedly with no flakes
before a release. They compose receipt review, recurring promotion,
group sharing, flow drilldowns, and model integrity over production
code paths and temporary databases:

```bash
CGO_ENABLED=0 go -C backend test ./internal/api/integration/ -run 'TestQA03' -count=3
```

Completeness journeys join them: one fixed synthetic ledger
(`backend/testdata/integration/v1/ledger.json`, hand-computed numbers
in its extras) proved present on every surface — diagram, list,
recurring proposal, receipts, sharing, inbox, splits, health checks —
with bank re-syncs adding nothing:

```bash
CGO_ENABLED=0 go -C backend test ./internal/integrationledger/ -count=3
INTEGRATION_PACK=ledger TEST_BROWSER_SHARDS=1 bun --filter ./frontend test:integration -- ledgerCompleteness.spec.ts
```

A green suite with mocked cores is a failing result: anything that
cannot run against the real backend must be listed as uncovered with
its reason, never faked green. The current journey coverage, the
harness stand-ins each journey names, and the uncovered list live in
the QA-03 test files' headers and in section 4 below.

## 2. Data and deployment gates

- One-time database upgrades follow the shared handover in
  [deploy/MIGRATIONS.md](../deploy/MIGRATIONS.md) on every supported
  target, with conversion-correctness, data-safety, and rollback tests
  under `backend/scripts/one-time/`.
- Image publishing validates with `actionlint
  .github/workflows/images.yml` and `node --test
  deploy/images.test.mjs`. Container checks run under the deployment
  portability gate in [TESTING.md](../TESTING.md#deployment-portability)
  against disposable state, never the dev stack or production data.
- The Vercel/Render settings stay per their guides
  ([Vercel](../deploy/vercel.md), [Render/container host](../deploy/render.md));
  the actual-provider checklist in [the deployment index](../deploy/README.md)
  stays manual.

## 3. Credential-gated and manual gates

These need real credentials, devices, or providers and stay manual.
A release notes each outcome; a skip names its reason.

- Real-provider identity checks: the [Casdoor test
  guide](../auth/casdoor/README.md#verification) (passkey, restart,
  revocation, refresh, administrator recovery) and
  `auth/test-integration.mjs` against a marked disposable fixture
  (`CASDOOR_TEST_MUTATIONS=1` required).
- Physical passkeys and phone recovery: the [manual checklist](authentication.md#manual-physical-device-and-recovery-checklist).
- Live bank verification: the SimpleFIN direct checks in
  [TESTING.md](../TESTING.md#simplefin-checks) with a writable owner
  disposable state.
- Real mail OAuth: exercised up to the consent start in automation;
  the Google-side exchange stays manual (see Uncovered below).
- Smoke scripts (`scripts/smoke-backend.sh`,
  `scripts/smoke-compose.sh`) against disposable instances.

## 4. Uncovered by automation (never faked green)

- Receipt matcher ranking with approve, reject, and hand-linking mail
  receipts to postings: no such product surface exists yet. Mail
  review (confirm/correct with the original extraction preserved) and
  image-receipt posting links are journey-tested; the matcher step is
  not, and must not be reported as covered.
- Split-builder and manual-send flows: blocked on the undecided
  friend-request lifecycle and the unbuilt send flow.
- Friend-request lifecycle itself: open product decisions.
- Real Google OAuth token exchange and message fetch: the automation
  seam is the fetch boundary; journeys name the fake fetcher and cover
  everything downstream (scan, triage, extraction evidence, review,
  dedupe, re-sync survival).
- Image extraction adapter: the local mock stands in for OCR; journeys
  say so in their names and cover the real upload, storage, review,
  and link paths around it.
- Posting-level currency: amounts are bare expressions with no currency
  field. Zero-decimal coverage lives in the split probes (JPY 1000 over
  3 allocates exactly 334/333/333); a yen-denominated posting row is not
  expressible and stays uncovered.
