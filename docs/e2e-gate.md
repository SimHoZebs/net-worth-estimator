# Disposable end-to-end gate

One command runs the credential-gated tier that used to be manual, against a
fully disposable environment:

```bash
E2E_TEST_MUTATIONS=1 scripts/test --e2e
```

The gate builds the real API and frontend images, boots the real stack on
verified-free isolated ports with private bind-mounted state, provisions a
disposable identity fixture, seeds owner plus provisioned guest plus a
signed-up second user, and drives the user journeys in a real Chromium with
real password sign-in. It never touches the canonical stack, production, or
shared volumes and networks, and it tears everything down on success and on
failure. Leftover containers, volumes, or networks fail the gate.

## What runs automatically

| Step | Coverage | Absorbs the manual |
| --- | --- | --- |
| `fixture` | Disposable provider seed, sealed import, generated subjects, `fixture.json` contract with test-only marking | Real-provider isolation setup |
| `images` | Builds the API, frontend, and Better Auth images; records immutable image IDs | Image preparation for the E2E steps |
| `stack` | Schema and guest row from the image's own `setupdb`; stack health through the proxy | `smoke-compose.sh` / `smoke-backend.sh` |
| `isolation` | Owner sign-in plus write plus CSRF; guest read/project with denied writes; provider grant then immediate revocation; second-user signup with restart persistence; stale-scope and cross-user rejection; shared-database row proof; logout with captured-cookie rejection | Manual identity journey setup |
| `direct-share` | Share → inbox accept → copy → revoke across two real users, including dismiss/restore, decline, accept retry idempotency, and revoked-read denial | QA-03 journey with a stand-in identity |
| `group-feed` | Group policy → feed → exclusion: viewer totals, explicit-grant copy, exclusion narrowing, revoke plus policy-off denial, copy survival | QA-03 journey with a stand-in identity |
| `receipts` | Multipart upload through the real storage path, metadata and image round-trip, cross-user denial, deletion | Receipt checklist against live stacks |
| `migration` | `/app/migrate.sh` from the target image against a snapshot copy: exit 0 on the complete-shape repeat path, integrity and foreign-key checks, live database byte-identical | Migration SOP rehearsal on the image (conversion-path coverage stays in `deploy/migrations.test.mjs`) |
| `proxy-headers` | Existing large-provider-header and receipt-upload-limit regressions against the built frontend image, Origin enforcement, gateway health, and sessionless probes | Separate manual Nginx image preparation |
| `teardown` | Compose removal plus explicit empty checks for containers, volumes, networks, and project processes | Manual `docker ps` forensics |

## What stays manual (with reasons)

- **Physical passkeys and phone recovery** (`docs/authentication.md` checklist).
  Hardware authenticators and real-device prompts cannot run headless; virtual
  authenticators prove the protocol path only. This is a device limitation,
  not automation reluctance.
- **Production mutation of any kind.** No gate step reads production
  credentials, data, or hostnames. Release verification against live hosts
  stays an explicit operator runbook (`deploy/README.md`), never a gate leg.
- **Live email delivery and SimpleFIN bridge sync.** Both need operator-owned
  external accounts; the gate asserts the unconfigured paths, not
  third-party delivery.

## Cadence and budget

- **Runs pre-release and nightly — never per push.** Cold image builds plus
  provider startup plus browser journeys measure in the tens of minutes; a
  per-push leg would serialize every change behind a half-hour gate and train
  authors to bypass it. Unit and integration tiers stay the per-push signal.
  `.github/workflows/e2e.yml` runs this gate nightly, on manual dispatch, and
  on pull requests carrying the `e2e` label; the label is the pre-release
  lever for a risky change.
- **Budget: 30 minutes wall clock** (`E2E_BUDGET_SECONDS` in
  `auth/e2e-lib.mjs`, overridable with `scripts/test --e2e --timeout=N`).
  Expiry cancels active commands, readiness requests, and browser journeys.
  Teardown has its own bounded two-minute budget so cancellation still
  removes the disposable stack.
- **Gates a release:** every step above `teardown` must read PASS.
  **Merely reports:** quarantined steps (see below) read QUARANTINED-FAIL
  without blocking, and the final timing report always prints for trend
  tracking.

## Flake policy

End-to-end runs cross process, container, and browser boundaries, so they
flake more than integration. The policy keeps that flake visible instead of
letting the gate become a coin toss:

1. **Transport retries only.** Navigation and readiness polling retry up to
   `E2E_TRANSPORT_ATTEMPTS` (3). Assertion failures never retry.
2. **Quarantine list, not silent skips.** `E2E_QUARANTINE` in
   `auth/e2e-lib.mjs` names `{step, reason, owner, since}`. A quarantined
   step still runs and reports; failure turns advisory until the triage
   owner clears it. The list starts empty and stays short: each entry needs
   a tracked root cause, not a vibe.
3. **Triage owner: the release captain.** A red gate blocks the release
   until the captain dispositions it: fix forward, quarantine with a tracked
   reason, or declare the run invalid (infrastructure outage) with evidence
   and a rerun. Invalid runs never silently replace a real result.
4. **Deterministic seeding.** Fixed dates, names, and balances; no assertion
   depends on clocks, randomness, or run order beyond the documented
   journey sequence.

## Secrets and credentials

All credentials are generated per run (`crypto.randomBytes`), used only
inside the disposable root, and marked test-only in `fixture.json`
(`testOnly: true`, `disposable: "waypoint-e2e-v1"`). Required inputs:

| Input | Source |
| --- | --- |
| `E2E_TEST_MUTATIONS=1` | Operator confirms disposable-only mutation |
| Docker daemon | Host |
| Playwright Chromium | Install separately with `(cd frontend && bunx --no-install playwright install chromium)` after `bun install --frozen-lockfile`; see [browser prerequisites](../TESTING.md#integration-suite) |
| Everything else (client secret, admin/user/guest passwords, subjects) | Generated per run; nothing from production, dev, or committed files |

The disposable root (`tmp/e2e-<stamp>-<pid>/`) is removed on success and
kept on failure for forensics; `--clean` also removes it on failure. The
root holds `e2e.env` and `credentials.json` at `0600`.

## Debugging a red run

```bash
E2E_TEST_MUTATIONS=1 scripts/test --e2e --step=images     # retain a reusable image set
E2E_TEST_MUTATIONS=1 scripts/test --e2e --step=receipts --skip-build=RUN_ID
E2E_TEST_MUTATIONS=1 scripts/test --e2e --cold-build      # true uncached image builds
```

Use the run ID printed by an images-only run or a failed run that completed
its image builds. The retained root contains `images.json` with immutable IDs.
Reuse validates that complete image set before provisioning and gives the
new invocation its own tags. Teardown removes only those new tags, not the
source run's images. Missing images fail before fixture setup. `--step=images`
always retains its image root, even with `--clean`; remove it manually when it
is no longer needed.

Every invocation creates fresh credentials, ports, and database state.
`--step` runs the selected step's prerequisites automatically; infrastructure
selections stop at their requested boundary. Partial selections report
`PARTIAL`, never full-gate `GREEN`. A full fresh-build run is still required
before landing gate changes.

## Extra data for edge exploration

```bash
E2E_TEST_MUTATIONS=1 scripts/test --e2e --seed-pack=unicode --seed-bulk=5x20:7
```

After the isolation leg passes its exact guest and blank-workspace checks,
the gate seeds one fixture pack plus tagged bulk rows into the owner
through the production API. Later journeys scope their own rows, so the
extra data rides along without changing their assertions. The flags are
opt-in: default runs seed nothing and assert the same shapes as before.

Per-step logs and image build logs live under the disposable root's `logs/`.
