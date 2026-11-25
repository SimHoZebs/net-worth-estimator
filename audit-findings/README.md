# Audit findings

Applied and superseded finding documents have been removed. Finding IDs are stable and are never reused; the remaining documents are the current decision backlog.

## Status legend

- `needs-review` — proposed and awaiting a decision.
- `accepted` — approved but not yet applied.
- `rejected` — the user chose to keep the current behavior.

## Current finding index

| ID | Title | Scope | Status |
| --- | --- | --- | --- |
| [012](012-native-flow-range.md) | Use native date inputs for the flow range | frontend-domain | rejected |
| [013](013-button-only-rule-order.md) | Keep button ordering and remove drag ordering | frontend-state | rejected |
| [046](046-rename-residue.md) | Delete forecast rename residue | contracts-types | accepted |
| [059](059-calendar-date-validity.md) | Use one calendar date validity check | contracts-types | rejected |
| [061](061-sse-payload-validation.md) | Validate stream event payloads before typing them | contracts-types | needs-review |
| [067](067-shared-run-registration.md) | Register a shared run only after the stream is writable | backend-api-persist | needs-review |
| [078](078-closed-statement-pricing.md) | Price a closed statement with one engine | backend-domain | needs-review |
| [079](079-transfer-leg-matching.md) | Match transfer legs with one shared rule | backend-domain | needs-review |
| [080](080-categorization-judgment-validation.md) | Apply the same judgment response validation to categorization | backend-domain | needs-review |
| [081](081-judgment-error-precedence.md) | Decide judgment error precedence in one place | backend-domain | needs-review |
| [082](082-projection-engine-version.md) | Remove the single-value projection engine version check | backend-domain | needs-review |
| [083](083-migration-ledger-repair-script.md) | Record the posted-time repair script in the migration ledger | backend-domain | needs-review |
| [085](085-claim-state-index.md) | Build one claim-state index in the Safe Spending replay | backend-domain | needs-review |
| [104](104-passkey-removal-focus.md) | Restore focus and announce passkey removal | ui-ux | needs-review |
| [105](105-auth-feedback-live-region.md) | Make auth feedback announce errors assertively | ui-ux | needs-review |
| [106](106-toggle-accessible-names.md) | Keep a stable name on pin and reveal toggles | ui-ux | needs-review |
| [107](107-pattern-review-tabs-scrollable.md) | Make the pattern-review tab strip scrollable | ui-ux | needs-review |
| [108](108-sheet-description-duplication.md) | Remove the duplicated sheet description | ui-ux | needs-review |
| [109](109-textarea-recipe-composition.md) | Compose the textarea from the shared input recipe | ui-ux | needs-review |
| [110](110-font-family-owners.md) | Keep font family strings in one owner | ui-ux | needs-review |
| [111](111-warning-badge-owner.md) | Own the transaction warning badge in one place | ui-ux | needs-review |
| [112](112-transaction-row-truncation.md) | Bound transaction title truncation by the container | ui-ux | needs-review |
| [113](113-evidence-dialog-unused-callback.md) | Remove the unused evidence edit callback | ui-ux | accepted |
| [114](114-redundant-control-hints.md) | Remove hints that restate the control | ui-ux | needs-review |
| [115](115-share-until-explicit-choice.md) | Make an open-ended share an explicit choice | ui-ux | needs-review |
| [116](116-empty-state-roadmap-copy.md) | Remove tutorial and roadmap text from empty states | ui-ux | needs-review |

## Audit history

- Optimization audit — 2026-11-21 at `7ac73105`.
- Pattern detection audit — 2026-11-18.
- shadcn Base UI migration audits — 2026-11-14.

Applied and superseded records from these audits were pruned; rejected decisions remain in the index.
