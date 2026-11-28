# Audit findings

Finding IDs are stable and are never reused. This index includes the current decision backlog and records retained from the latest audit.

## Status legend

- `needs-review` — proposed and awaiting a decision.
- `accepted` — approved but not yet applied.
- `rejected` — the user chose to keep the current behavior.
- `deferred` — the decision or work was postponed.
- `implemented` — the change landed and its verification is recorded.
- `superseded` — a newer finding replaced this record.

## Current finding index

| ID | Title | Scope | Status |
| --- | --- | --- | --- |
| [012](012-native-flow-range.md) | Use native date inputs for the flow range | frontend-domain | rejected |
| [013](013-button-only-rule-order.md) | Keep button ordering and remove drag ordering | frontend-state | rejected |
| [046](046-rename-residue.md) | Delete forecast rename residue | contracts-types | implemented |
| [059](059-calendar-date-validity.md) | Use one calendar date validity check | contracts-types | rejected |
| [061](061-sse-payload-validation.md) | Validate stream event payloads before typing them | contracts-types | implemented |
| [067](067-shared-run-registration.md) | Register a shared run only after the stream is writable | backend-api-persist | implemented |
| [078](078-closed-statement-pricing.md) | Price a closed statement with one engine | backend-domain | implemented |
| [079](079-transfer-leg-matching.md) | Match transfer legs with one shared rule | backend-domain | implemented |
| [080](080-categorization-judgment-validation.md) | Apply the same judgment response validation to categorization | backend-domain | implemented |
| [081](081-judgment-error-precedence.md) | Decide judgment error precedence in one place | backend-domain | implemented |
| [082](082-projection-engine-version.md) | Remove the single-value projection engine version check | backend-domain | superseded |
| [083](083-migration-ledger-repair-script.md) | Record the posted-time repair script in the migration ledger | backend-domain | implemented |
| [085](085-claim-state-index.md) | Build one claim-state index in the Safe Spending replay | backend-domain | implemented |
| [104](104-passkey-removal-focus.md) | Restore focus and announce passkey removal | ui-ux | implemented |
| [105](105-auth-feedback-live-region.md) | Make auth feedback announce errors assertively | ui-ux | implemented |
| [106](106-toggle-accessible-names.md) | Keep a stable name on pin and reveal toggles | ui-ux | implemented |
| [107](107-pattern-review-tabs-scrollable.md) | Make the pattern-review tab strip scrollable | ui-ux | implemented |
| [108](108-sheet-description-duplication.md) | Remove the duplicated sheet description | ui-ux | implemented |
| [109](109-textarea-recipe-composition.md) | Compose the textarea from the shared input recipe | ui-ux | implemented |
| [110](110-font-family-owners.md) | Keep font family strings in one owner | ui-ux | implemented |
| [111](111-warning-badge-owner.md) | Own the transaction warning badge in one place | ui-ux | implemented |
| [112](112-transaction-row-truncation.md) | Bound transaction title truncation by the container | ui-ux | implemented |
| [113](113-evidence-dialog-unused-callback.md) | Remove the unused evidence edit callback | ui-ux | implemented |
| [114](114-redundant-control-hints.md) | Remove hints that restate the control | ui-ux | implemented |
| [115](115-share-until-explicit-choice.md) | Make an open-ended share an explicit choice | ui-ux | implemented |
| [116](116-empty-state-roadmap-copy.md) | Remove tutorial and roadmap text from empty states | ui-ux | implemented |
| [117](117-statement-latest-balance-check.md) | Price statements from the latest balance check | backend-domain | implemented |
| [118](118-range-percentile-calculation.md) | Calculate range percentiles in one place | backend-domain | implemented |
| [119](119-stored-projection-history.md) | Replay only recorded history when reading a saved projection | backend-domain | implemented |
| [120](120-transaction-row-transfer-data.md) | Resolve transfer information once per transaction list | frontend-state | implemented |
| [121](121-alert-dialog-viewport.md) | Keep confirmation dialog actions within reach | ui-ux | implemented |
| [122](122-independence-card-keyboard-focus.md) | Show keyboard focus on the Financial Independence card | ui-ux | implemented |
| [123](123-reduced-motion-loading.md) | Stop repeating loading animations with reduced motion | ui-ux | implemented |
| [124](124-image-reuse-build-context.md) | Rebuild images when build exclusions change | deploy-build-test | implemented |
| [125](125-identity-runtime-image.md) | Ship only the identity service runtime | deploy-build-test | implemented |
| [126](126-account-balance-test-fixtures.md) | Supply account balances directly in frontend tests | deploy-build-test | implemented |
| [127](127-projection-engine-version-docs.md) | Document the current projection engine version | doc-audit-reference | implemented |
| [128](128-analysis-input-retention-docs.md) | Correct the Analysis input retention guide | doc-audit-reference | implemented |
| [129](129-seed-regeneration-docs.md) | Keep one working recipe for regenerating the ML seed | doc-audit-reference | implemented |
| [130](130-flows-projection-horizon.md) | Request only the projection years Flows needs | frontend-domain | implemented |
| [131](131-schedule-frequency-fallback.md) | Read only current schedule recurrence | frontend-domain | implemented |
| [132](132-schedule-amount-presets.md) | Use saved amount presets when creating a schedule | frontend-domain | implemented |
| [133](133-range-cache-default-scenario-count.md) | Align the browser and server range scenario count | backend-api-persist | implemented |
| [134](134-range-cache-saved-model-only.md) | Restrict the saved range to saved-model requests | backend-api-persist | implemented |
| [135](135-range-cache-atomic-publication.md) | Publish saved range results atomically | backend-api-persist | implemented |
| [136](136-bank-amount-literal-normalization.md) | Normalize numeric amounts before saving bank data | contracts-types | implemented |

## Retired aliases

| Use in findings | Source names grouped under it |
| --- | --- |
| Balance check | Checkpoint, bank observation |
| Range | Stochastic bands, Monte Carlo statistics |
| Recorded history | Actual-only history |
| Transfer information | Transfer peer, transfer-link membership |
| Confirmation dialog | Alert dialog |
| Identity service | Better Auth image, auth image |
| Scenario count | Trial count, run count |
| Saved range | Durable stochastic cache, canonical stochastic artifacts |
| Schedule recurrence | Legacy schedule frequency |
| Numeric amount | Amount literal, decimal expression |

## Audit history

- Optimization audit — 2026-11-27 at `db35e305`.
- Optimization audit — 2026-11-21 at `7ac73105`.
- Pattern detection audit — 2026-11-18.
- shadcn Base UI migration audits — 2026-11-14.

Applied and superseded records from these audits were pruned; rejected decisions remain in the index.
