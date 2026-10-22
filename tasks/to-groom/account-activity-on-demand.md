# Accounts: build activity only for the open inspector

The account grid builds a complete transaction list for every card before search filtering. Opening `Everyday checking` then builds its list again in the inspector. The card-model copy is used only for a footer condition.

Remove `transactions` from `AccountCardModel` and its construction in `toAccountCard`. Remove that function's now-unused plan argument. Use the inspector's existing `transactions.length` for its footer, so the inspector owns activity derivation.

- Eager lists: `frontend/src/domain/accountCards.ts:99-101,153-162`.
- Grid construction: `frontend/src/components/cards/AccountCardGrid.tsx:20-31`.
- Inspector derivation/footer: `frontend/src/components/cards/AccountDetailsModal.tsx:36-42,178-193`.
- Existing activity helper: `frontend/src/domain/accountActivity.ts:125-195`.

Add a grid test that verifies no activity-list construction before an inspector opens. Verify selected-account activity, search, and the footer with and without a projection. Runtime improvement remains unmeasured.
