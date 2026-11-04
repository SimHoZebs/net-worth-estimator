# Integration edge-case gates

Companion to [the release gates](release-gates.md). That document owns the
ship/no-ship checklist; this one owns the hostile half of the integration
tier: the fixture packs, the edge-case suite, and the dataset × identity
matrix runner. Nothing here replaces the unit gates, the browser suite, or
the manual tier below.

## Tiers

- Unit: no servers, no daemon, no credentials. Go tests that stay below a
  real boundary, vitest, config contract tests. Entry point:
  `scripts/test --unit`.
- Integration: real collaborators across at least one real boundary — real
  SQLite, the real production routers, the real backend over real HTTP.
  Entry points: `scripts/test --integration` (browser suite),
  `backend/scripts/verify.sh` (backend suites, including the edge-case
  suite), and `scripts/test --matrix` (the dataset × identity matrix).
- End-to-end: the disposable automated gate with a real provider, real
  images, and a real browser over disposable state (entry point
  `scripts/test --e2e`; see [the e2e gate](e2e-gate.md)). The edge-case
  suite stays one tier below it on purpose: no provider round trip, so it
  runs in seconds without Docker or credentials. Whatever the e2e gate
  cannot cover stays manual: physical passkeys and phone recovery (the
  [manual checklist](authentication.md#manual-physical-device-and-recovery-checklist)),
  live external delivery, and any production mutation.

## Fixture packs

Versioned synthetic datasets under `backend/testdata/integration/v1`, one
concern per file. Synthetic by construction: no production rows, no real
credentials, no real counterparties. A pack is an ordered sequence of seeds:
a model seed, an optional safe-spending settings seed, and optional
harness-specific seeds for sync state, sharing, invites, split probes, bank
feeds, and ledger expectations. The loader applies the model and settings
seeds and exposes the rest by kind. Every pack documents its concern and what
breaks if mishandled; the loader refuses packs whose version envelope is not
v2, so a format change mints a new version alongside — loaders never migrate
old packs in place.

| Pack | Concern | Breaks if mishandled |
| ---- | ------- | -------------------- |
| penny-zero | Sub-cent and zero amounts; a 1-cent total across three | Remainders dropped or rounded away move money; zero rows treated as missing hide rows and break totals |
| currencies | JPY (0-decimal), KWD/BHD (3-decimal), USD/EUR (2-decimal), sub-cent dust | 100x yen over-allocation, fils rounded away, inexact per-currency remainders |
| duplicates | Identical merchant names and amounts across days | Name-plus-amount dedupe collapses distinct days, corrupting balances |
| lifecycle | Pending, voided, and settled bank rows via the real sync apply path | Void rows resurrected into balances/feeds; pending shared as settled; deleted rows reappearing on re-sync |
| timezones | UTC midnight ± seconds, month/year edges, leap day | Off-by-one day grouping pushes rows into the wrong interval, filter, or period |
| unicode | Multi-byte, emoji, combining marks, right-to-left names | Mid-rune truncation, normalization drift, broken feed/total encoding |
| overlong | 280+ rune names, emoji-heavy names | Silent truncation, column errors, broken review/search |
| recurring | Monthly template with skipped month, amount drift, early actual | Phantom or missing occurrences corrupt forecasts; drift snapped back to template |
| transfers | Legs days apart plus round-amount decoys | Wrong legs paired by amount; mismatched legs inflate inflow and outflow |
| backdated | Transaction times months before posted times | Reordered history shifts balances, checkpoints, and intervals |
| cursors | Stale sync and mail-scan cursors with newer rows present | Replays duplicate rows or resurrect dead ones |
| missing-data | Outflow-only model, debt account with no terms | Missing income read as zero; unknown liabilities dropped from totals |
| revocation | Shared, revoked, then re-shared rows | Revoked rows stay visible (consent leak) or re-grants stay dead |
| invites | Expired, exhausted, and fresh single-use codes | Expired/used codes admit members without consent |
| exclusions | Wildcard (audience all) exclusion before later rows arrive | Exclusions evaluated at write time leak rows to later audiences |
| ledger | Fixed household ledger with hand-computed sums for completeness journeys: every surface must show the seed's known rows | Dropped, duplicated, or miscounted seed rows; merged lookalikes; resurrected phantoms; leaked revocations |
| negative-net-worth | Sustained negative net worth with volatile debt-driven swings below zero | Charts or domains assuming a $0 floor; backwards compact signs; dropped negative layers or unformattable sub-zero tooltips |
| safe-spending | Card spending thresholds, pace projection, and a protected-reserve crossing | Missing income selection, card charges, or reserve hides the dividers and pace |
| safe-spending-shortfall | A recurring bill the cash balance cannot fulfill | Missing raised savings contribution or income selection hides the unfulfilled row |

Loading per harness:

- Store and API tests: `integrationfixtures.SeedUser` (throwaway database,
  applies the model and settings seeds like the browser reseed) or
  `integrationfixtures.Model` plus the harness's own setup. The edge-case
  suite seeds `INTEGRATION_PACK` automatically when set. Harness-specific
  seeds are read through the pack accessors (`BankFeeds`, `SplitProbes`,
  `LedgerExpected`, `SyncState`, `SharingScript`, `InviteScript`).
- Browser suite: `INTEGRATION_PACK=<pack>` in the environment. The
  fixtureapi harness applies the pack's model and settings seeds instead of
  the CSV model on its own isolated ports and throwaway database; the
  Playwright config forwards the variable explicitly. Empty keeps the default
  fixture.
- Bulk rows: `INTEGRATION_BULK=<NxM[:seed]>` in the environment, or `bulk`
  on one reset call. The harness injects tagged synthetic accounts beside
  the pack or CSV baseline through the same additive builder the Go leg
  uses (`InjectBulk`); reset clears them with the baseline. Per-call
  overrides beat the environment; empty disables bulk.

## Edge-case suite

`backend/internal/integrationedge`, run by the existing backend suites
(`backend/scripts/verify.sh ./internal/integrationedge/` and the
repository-wide gate). Every case crosses real SQLite; handler cases also
cross the real production routers over real HTTP through httptest. The one
named stand-in is identity: tests inject the verified principal through
the same principal-in-context seam the production middleware provides, so
there is no OIDC round trip. Storm suites loop internally and are built
for `go test -count=N -race` repetition: green means hostile, not lucky.

| Case | Real boundary crossed | Stand-in |
| ---- | --------------------- | -------- |
| Split remainder theft across USD/JPY/KWD/BHD/EUR, totals 0–100, 1–7 participants, 5-round loop | Real SQLite (allocation + persisted splits) | Identity seam only |
| Split override mismatch (off-by-one rejected, exact stored) | Real SQLite | Identity seam only |
| Grant retry storm, 16 racers × 3 rounds: replay identical, key reuse 409 | Real SQLite, real router over real HTTP | Identity seam only |
| Copy retry storm: one share, exactly one recipient row | Real SQLite, real router over real HTTP | Identity seam only |
| Split + settlement storm: one split row, linked payment settles once | Real SQLite | Identity seam only |
| Revocation mid-pagination / mid-copy-save / mid-inbox-decide | Real SQLite, real router over real HTTP | Identity seam only |
| Void-marking mid-share and mid-split | Real SQLite, real router over real HTTP | Identity seam only |
| Forged owner/posting/account/group IDs on every cross-user route | Real SQLite, real router over real HTTP | Identity seam only |
| Membership removed mid-feed; policy narrowed to off; account deleted mid-policy; group deleted; model cleared | Real SQLite, real router over real HTTP | Identity seam only |
| Single-use invite accept storm (exactly one wins) + spent-code retries | Real SQLite, real router over real HTTP | Identity seam only |
| Expired and revoked invites (expiry forced through the real row) | Real SQLite, real router over real HTTP | Identity seam only |
| Future-dated and timezone-edge postings vs sharing intervals + leap day | Real SQLite, real router over real HTTP | Identity seam only |
| Unicode names through feed, totals, copies, stored rows | Real SQLite, real router over real HTTP | Identity seam only |
| 10k-row feed: set-wide totals agreement + head-page chaining | Real SQLite, real router over real HTTP | Identity seam only |
| 1k-row exhaustive page walk: 10 pages, 1000 unique rows, per-page totals | Real SQLite, real router over real HTTP | Identity seam only |

## Matrix runner

`scripts/test --matrix` extends the existing entry point (no new top-level
command): one suite run per dataset-pack × identity-set combination.

```bash
scripts/test --matrix
scripts/test --matrix --packs=base,unicode,timezones --identities=full,duo --repeat=3
scripts/test --matrix --packs=all --identities=full
scripts/test --matrix --packs=unicode --browser
scripts/test --matrix --packs=unicode --browser --specs=groupSharing.spec.ts
scripts/test --matrix --packs=unicode --bulk=20x200:7
```

Defaults: packs `base,unicode` (base is the suite default seed),
identities `full,duo,solo`, repeat 1, no bulk. Identity sets: solo (owner only),
duo (owner plus second user), full (owner, second user, provisioned guest,
removed ex-member). All identities are synthetic per-run subjects on
throwaway databases, never reused across runs.

Isolation: the Go leg uses throwaway SQLite files and httptest HTTP only —
no servers, no fixed ports, no canonical stack, no tailnet or issuer
changes. The `--browser` leg runs the sharing specs per pack through the
standard browser config: random free ports, a fresh temporary database
pruned on exit, servers stopped by the runner. The browser harness has a
single fixture user, so the browser leg always runs the solo-equivalent
journeys; duo/full/group journeys run in the Go suite.

## Known findings (not failures)

- Feed pagination costs about 2ms a row per page: every page re-authorizes
  the whole listed set row by row. A full 10k walk is correct but too slow
  for a gate, so the suite proves set-wide totals agreement at 10k and the
  exhaustive walk at 1k. Treat feed latency at scale as a product finding.
- Settlement recording is intentionally opaque until split-membership
  fencing lands: any provisioned user may record against a split ID, while
  split reads stay fenced to initiator and participants. The forgery case
  pins this contract. See the store interface notes on
  `RecordSettlement`/`ListSettlements`.

## Uncovered by automation (never faked green)

- Real identity-provider login, passkey, restart, revocation, refresh, and
  administrator recovery: the Casdoor test guide and
  `auth/test-integration.mjs` (manual, credential-gated).
- Physical passkeys and phone recovery: the manual checklist above.
- Live bank sync and real mail OAuth exchange: manual direct checks; the
  automation seam stays at the sync-apply and fetch boundaries with the
  lifecycle pack covering everything downstream.
- Image extraction: the local stand-in covers OCR; real upload, storage,
  review, and link paths around it are covered.
