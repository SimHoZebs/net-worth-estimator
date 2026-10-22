# Safe spending: resolve bill selection once

If saved bill IDs contain only `deleted-bill`, the configuration shows all current bills selected while calculations exclude every transaction. Calculations use raw saved IDs, but checkboxes and toggles apply their own cleanup and fallback rules.

Create one effective-selection resolver before `obligationMovements`, the selected activity list. Use its result for calculations, checkboxes, and toggles. The result must represent the existing default selection as well as explicit IDs: default `null` includes all spendable-account outflows, including one-time transactions.

- Competing selections: `frontend/src/pages/outlook/safe-spending/SafeSpendingPreview.tsx:171-174,226-248,392-403`.
- Checkbox consumer: `frontend/src/pages/outlook/safe-spending/SafeSpendingConfigurePanel.tsx:281-295`.
- Storage and tests: `frontend/src/state/useSafeSpendingSettings.ts:57-63,98-100`, `frontend/src/state/persistedPrefs.test.ts:96-123`.

Add an integrated preview test with a fixed date. Cover default selection, all-stale IDs, partially valid IDs, one-time outflows, and deselection of the last bill. Assert agreement between checked controls and calculated amounts. The broader [window-summary task](safe-spending-window-summary.md) is separate.
