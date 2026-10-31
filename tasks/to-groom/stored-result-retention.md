# Stored results: a bound per kind, subscribed at use site

Status: approved (ready to schedule).

## Goal

Completed deterministic results and completed seeded range results share one per-user bound, and insertion evicts the oldest rows regardless of kind, so a burst of range results can push out the reused projection and force a recalculation. Give each kind its own bound. As part of the same change, move the outlook projection subscription out of the page top level and into the three components that render from it; the page keeps UI callbacks only.

## Scope

- Ownership: the projection chart, the pinned evaluation cards, and the safe-spending preview each declare their own projection subscription where they use the data. The outlook page stops subscribing and passing the result down. Every subscription must reuse the same horizon and range inputs so the shared query cache still issues one fetch for the identical request.
  - Current page-level subscription and fan-out: `frontend/src/pages/Outlook.tsx:81-99` subscribes and derives the projection result; `frontend/src/pages/Outlook.tsx:132-165` hands it to the chart, the pinned cards, and the safe-spending preview. The page documents the pattern at `frontend/src/pages/Outlook.tsx:46-47,68-70`.
  - Shared-fetch precedent: `frontend/src/state/serverQuery.ts:6-20` (identical concurrent requests attach to one in-flight fetch).
- Retention: give deterministic and stochastic artifacts each their own bound (or a reserved floor for deterministic entries) instead of the shared bound in `backend/internal/store/adapters/sqlite/artifacts.go:8-44`.
- Lookup-before-compute stays: `backend/internal/api/projections/deterministic.go:76-89` keeps serving the stored result first.

## Acceptance criteria

- Opening the outlook issues one projection fetch shared by all three subscribing components; the request inputs are identical so the cache key matches.
- Storing a full bound of range results leaves the stored projection retrievable; the next visit reuses it with no recalculation.
- Outlook workspace behavior and remote-hook tests stay green, including the empty-workspace, loading, error-retry, and placeholder paths.

## Non-goals

- No change to the evaluations page subscription or the other projection consumers in this change.
- No cache identity changes; the stored result stays the full result.
- No per-user scoping changes.
- No code identifier renames; storage and wire names stay as they are.

Main risk is key divergence: if the three subscriptions drift in horizon or range inputs they produce three cache keys and three fetches instead of one. The shared inputs must stay single-sourced. Compute savings are structural and unmeasured.

## Terminology cleanup (part of this change)

There is no alternate case, so nothing is "base". The single calculated path is the projection; simulator evaluations branch from it. Reconcile every product surface to that model:

- Glossary projection section: `docs/TERMS.md:32-37` becomes "Projection and range" — the projection is the single calculated path from the saved model, the range is the percentile band across sampled scenarios, and simulator evaluations branch from the projection to answer their question. What-if stays described as a simulator evaluation following the financial-independence branching path (`docs/TERMS.md:43`, verbs at `docs/TERMS.md:96-97` keep promote/discard mechanics unchanged).
- Product intent: the question at `PRODUCT_INTENT.md:11`, the destination at `:18`, the horizon row at `:68`, the definition table row at `:93`, the outcome section at `:119`, and the passages at `:276,289,296,386` say projection (and "Projection outcome" for the section). The primary-language list at `:296` lists projection, not base case.
- Interface strings: the chart export header at `frontend/src/domain/chart.ts:347`, the horizon label at `frontend/src/components/activity/AccountDetails.tsx:363`, the funding sentence at `frontend/src/components/evidence/FailureEvidence.tsx:29`, the reached-date sentence at `frontend/src/pages/evaluations/EvaluationCard.tsx:115`, and the independence status at `frontend/src/pages/evaluations/IndependenceVerdict.tsx:26`.
- Purchase-planner doc: `docs/purchase-queue.md:88` says projection schedule.
- Tests pinning the strings move with the copy: `frontend/tests/financialIndependence.spec.ts:104,220,236,252,406`, `frontend/src/pages/evaluations/FinancialIndependenceCard.test.tsx:285,302,308`, `frontend/src/domain/chart.test.ts:36`.
- Deferred prose moves too: `tasks/to-groom/range-stream-ownership.md:5`.
- Two backend comments move with the vocabulary (`backend/internal/domain/transitions.go:194`, `backend/internal/domain/posting_loss_test.go:13`); identifiers stay.

Acceptance: prose, interface, and test searches for the retired term return only storage and wire identifiers; the displayed-names coverage in `frontend/tests/workspace.spec.ts` and the evaluation unit tests pass on the new strings.
