# Release gates

Nothing ships until every gate below passes on the release commit. Hosted
CI runs the automated tiers on every branch push and every pull request
(`.github/workflows/tests.yml`), so the run for the exact `main` SHA is the
gate of record. A branch run covers the pre-landing content only; after a
squash or rebase, watch the new `main` run. It also runs the disposable e2e
gate nightly (`.github/workflows/e2e.yml`). The image workflow runs after that
`Tests` run. The Northflank workflow starts on the same `Tests` run and requests
a deployment only after the pinned backend-northflank and Better Auth (auth) image tags exist. The
Vercel workflow uses the `Tests` gate directly for production frontend deploys.

## 1. Automated test gates

For ordinary changes, run the narrowest relevant local check, then watch
hosted `Tests` for the exact branch and landed commit. Do not repeat a
blanket manual backend checklist. Add a direct disposable-state check only
when a changed boundary lacks automated coverage, and record that gap.

The optional local aggregate is:

```bash
scripts/test --gate
```

Local command coverage and recipes live in [TESTING.md](../TESTING.md#completion-gate).
The local aggregate is not the entire hosted workflow: hosted jobs also
verify the income sidecar, Northflank deployment image, and Python
payment-pattern upgrade. The workflow owns that inventory. Unit checks
need no pre-existing stack, Docker daemon, or external credentials;
package tests may create disposable local listeners.

Frontend browser integration covers observed regressions only; the former
broad UI suite was retired. When no regression specs exist, the runner logs
an empty baseline and starts no servers. Extension browser tests still own
isolated servers and temporary databases. They never attach to the dev stack.
Frontend and extension execution recipes remain in the testing guide and
[extension guide](../extension/README.md).

Real-provider identity checks run automatically through the
[disposable E2E gate](e2e-gate.md) with generated credentials. It runs
nightly, on dispatch, and for pull requests carrying the `e2e` label.
Dispatch it for auth, image, migration, and proxy changes. Partial E2E
selections are debugging evidence, not a full release gate.

Cross-feature journeys (QA-03) must pass repeatedly with no flakes
before a release. The surfaces they cover and the commands that run
them live in the
[testing guide](../TESTING.md#cross-feature-journeys).

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
  stays manual. Vercel deploys after the `Tests` run for the pushed `main`
  commit succeeds. Northflank deploys after the pinned images for that commit
   are published; the image workflow itself runs only after `Tests` succeeds. Landing and
   release are distinct. An actual Northflank release
   requires its workflow run ID, successful migration step, backup hash,
   and an `ok` readiness response.
   A release that stops at the migration leaves the API in maintenance with the
   database unchanged. Request the release again. A GitHub dispatch of the
   release workflow requests the current `main` commit, so it releases the
   failed target only while `main` still points at it; otherwise run the
   workflow from the Northflank UI or API with the failed target's `RELEASE_SHA`,
   `API_IMAGE`, and `IDENTITY_IMAGE`. Record the retried run; recovery
   commands are in the
   [Northflank deployment guide](../deploy/northflank/README.md#release-window-and-recovery).

## 3. Credential-gated and manual gates

These need operator-owned external accounts, devices, or live targets and stay manual.
A release notes each outcome; a skip names its reason.

- Live target identity conversion and offline recovery use
  [the authentication guide](../auth/README.md) and remain operator checks.
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
  receipts to transactions: no such product surface exists yet. Mail
  review (confirm/correct with the original extraction preserved) and
  image-receipt transaction links are journey-tested; the matcher step is
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
- Transaction-level currency: amounts are bare expressions with no currency
  field. Zero-decimal coverage lives in the split probes (JPY 1000 over
  3 allocates exactly 334/333/333); a yen-denominated transaction row is not
  expressible and stays uncovered.
