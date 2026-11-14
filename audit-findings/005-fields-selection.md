---
id: 005
title: Finish selection and field adoption
scope: frontend-domain
status: accepted
---

Priority: medium-high.

Editors import shadcn Field and Input but retain raw selects and checkboxes plus copied old styling. The inspected application TSX contains 31 raw selects in 12 files and 7 checkbox inputs in 5 files. The same account/schedule selection concepts consequently use different appearance and behavior depending on the screen.

Use preset Select for ordinary styled selections and Combobox for sufficiently large searchable account/category lists. Use Checkbox or Switch according to the actual setting semantics. Compose labels, hints, invalid state, and errors with the Field parts. Delete copied field/select recipes. NativeSelect is an official shadcn choice, but retaining it should follow a deliberate mobile/performance requirement, not old `selectOption` test compatibility. Shadcn does not replace financial validators or API payload builders.

References: `frontend/src/components/editors/AddTransactionDialog.tsx:30`, `frontend/src/components/editors/AddTransactionDialog.tsx:237`, `frontend/src/components/editors/AddTransactionDialog.tsx:355`, `frontend/src/components/editors/AmountBuilder.tsx:308`, `frontend/src/components/receipts/ReceiptReviewDialog.tsx:395`. Official choices: https://ui.shadcn.com/docs/components/base/combobox and https://ui.shadcn.com/docs/components/base/native-select.

Verification: accessible labels, keyboard selection/typeahead, empty/disabled values, portal options inside modal workflows, submission payloads, and permissions. Update tests to interact with the chosen widget instead of selecting a widget to suit the test helper.
