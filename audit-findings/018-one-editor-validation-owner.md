---
id: 018
title: Consolidate repeated editor validation
scope: frontend-domain
status: implemented
---

Create/detail editors repeat name, amount, account, date, and growth checks. Purchase submission manually checks fields then runs a Zod schema. Canonical FieldError already displays issue arrays.

Reuse the existing transaction/schedule validators from their detail parsers instead of repeating checks. Keep the existing purchase Zod schema with a required-funding guard and remove redundant manual name/amount/date checks. Parse editor strings once and keep canonical FieldError for display.

**Weight:** recommendation after a measured prototype. An additional Zod form-contract layer grew the validation implementation and was replaced with direct reuse of existing owners. The final validation-only change removes 26 lines, independently of dialog-shell savings. Preserve account relationships, claim requirements, exact timestamps, revision protection, and payload construction. Native controls/Base UI do not replace those rules.

## References

- `frontend/src/components/editors/transactionBodies.ts:238-285,293-372` repeats validation.
- `frontend/src/domain/modelSchemas.ts:12-15,80-135` defines related scalar/model constraints.
- `frontend/src/pages/purchase-planner/PlannedPurchaseEditor.tsx:94-128` validates twice.
- `frontend/src/components/ui/field.tsx:179-227` accepts/deduplicates issues.

## Verification

Implementation verified by 19 targeted validation tests and local cleanup checks recorded in README.

Run transaction tests for zero/negative/invalid amounts, account requirements, growth/end bounds, claims, partial updates, and unchanged exact timestamps. Purchase funding must remain required although the stored model permits null. Run typecheck and measure the resulting diff; reject a schema framework that grows code.
