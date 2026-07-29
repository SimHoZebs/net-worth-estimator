# Recommended Implementation Plan

## Phase 1: Restore Verification

1. Make theme storage access safe and validate persisted theme values.
2. Add storage initialization tests.
3. Run the full test suite and typecheck.

## Phase 2: Remove Runtime Churn

1. Stabilize the uPlot instance across data updates.
2. Remove presentation metadata from projection request identity.
3. Give evaluation configuration fields draft and commit semantics.
4. Make debounced stochastic settings safe against external updates.

## Phase 3: Restore Boundary Safety

1. Remove active `as never` table casts by correcting generic inference.
2. Parse CSV API responses from `unknown`.
3. Add lightweight worker message guards.
4. Preserve raw numeric form drafts until commit.

## Phase 4: Consolidate Foundations

1. Consolidate active chart formatters onto the tested shared implementation.
2. Extract identical worker lifecycle mechanics while retaining specialized APIs.
3. Pass evaluation mutation callbacks through the renderer contract.
4. Extract the pure shortfall cascade data builder.

## Phase 5: Remove Confirmed Dead Code

1. Recheck every orphan symbol and path.
2. Delete obsolete UI and chart implementations.
3. Remove compatibility overloads used only by those obsolete files.
4. Do not remove scenario compatibility aliases covered by the documented migration window.

## Phase 6: Narrow Root Ownership

1. Extract projection orchestration from `App`.
2. Extract source save/reset transitions if the first extraction leaves a clear boundary.
3. Deduplicate `ModelInputsInspector` construction.
4. Avoid a broad folder move or application rewrite.

## Completion Gate

Each phase should pass typecheck, relevant tests, the full test suite, build, Biome, `git diff --check`, and a focused UI check before proceeding.
