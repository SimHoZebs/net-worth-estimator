---
id: 014
title: Let Tabs own local selection and panel mounting
scope: frontend-state
status: implemented
---

Several screens keep selected-tab state whose only reader is Tabs. Account details and the purchase planner also render one dynamically named panel and choose its contents with a ternary, duplicating library panel selection.

Use defaultValue for purely local selection and stable TabsContent parts per tab. Remove the account view's useTransactionView alias. Keep Pattern review's row-limit/open-detail resets in onValueChange. Keep controlled tabs where URLs or external state genuinely own selection.

**Weight:** strong recommendation. Base UI supports uncontrolled selection and defaults inactive panels to keepMounted=false. Verify mounting and resets instead of assuming every controlled tab is redundant.

## References

- `frontend/src/pages/SourcesPage.tsx:22-26` mirrors the selected value solely into Tabs.
- `frontend/src/pages/evaluations/FinancialIndependenceModal.tsx:40,59-62` has equivalent local selection.
- `frontend/src/components/analysis/PatternReview.tsx:426,444-450` mixes redundant tab ownership with useful resets.
- `frontend/src/pages/accounts/AccountDetailPage.tsx:234-330,393-395` manually chooses panel content.
- `frontend/src/pages/purchase-planner/PurchasePlanner.tsx:40,131-145` uses the same pattern.
- [Base UI Tabs API](https://base-ui.com/react/components/tabs) documents defaultValue and Panel keepMounted.

## Verification

Implementation verified by local cleanup checks and browser captures recorded in README.

Click and keyboard-activate every tab. Confirm inactive expensive panels do not mount/start requests, Pattern review resets remain, and URL-controlled selection stays synchronized. Check local-state reset behavior on returning to tabs. Run typecheck and affected current tests.
