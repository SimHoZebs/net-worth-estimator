# Tasks to groom

These 35 task files record the seven-scope optimization audit and follow-up discussion. Each file explains the relevant background, states the direct change, and names verification. Repeated before/after lists are unnecessary when the workflow stays the same.

Evidence references describe audit commit `9990a6545fc21fc8bbef4f8b2532909e9796e67e` and its working tree. Recheck current code before implementation. Concurrent work may already resolve a finding or move its source.

## Paused work

The separate database/sqlc draft is paused in its isolated worktree. sqlc is not a prerequisite for the responsibility cleanup and is not part of the API merge.

## Runtime and verification tasks

- [Use one saved-plan identity](saved-plan-identity.md).
- [Use server shortfall evidence](transaction-shortfall-evidence.md).
- [Replace financial-independence callbacks with a direct loop](financial-independence-monthly-loop.md).
- [Share target-evaluation verdict selection](shared-target-date-status.md).
- [Use registered evaluation validators](evaluation-validation-dispatch.md).
- [Use one website-origin parser](origin-parser-parity.md).
- [Merge Sync and Trigger implementations](simplefin-sync-guards.md).
- [Remove duplicate SimpleFIN retry-error handling](simplefin-retry-error-ownership.md).
- [Delete unused SimpleFIN account-creation output](simplefin-unused-provision-output.md).
- [Give each range consumer its own stream](range-stream-ownership.md).
- [Look up each transaction source once](transaction-source-lookup.md).
- [Build account activity only for the open inspector](account-activity-on-demand.md).
- [Resolve safe-spending bill selection once](safe-spending-bill-selection.md).
- [Summarize each mandatory-payment window once](safe-spending-window-summary.md).
- [Delete unreachable Outlook code](outlook-unreachable-branch.md).
- [Decode complete model imports](model-import-boundary.md).
- [Use saved recipe descriptions](amount-preset-source-of-truth.md).
- [Report unsupported payment-term imports](model-import-payment-terms.md).
- [Validate streamed payloads](streamed-response-validation.md).
- [Cover command packages in backend CI](backend-ci-package-coverage.md).
- [Intercept the actual failed-save request](failed-save-browser-test.md).
- [Release non-modal navigation focus](desktop-navigation-focus.md).
- [Correct deployment smoke assertions](deployment-smoke-contract.md).
- [Run frontend lint and browser tests in CI](frontend-ci-gates.md).

## Documentation tasks

- [Describe current-schema backup compatibility](documentation-storage-compatibility.md).
- [Remove the retired offline income-import option](documentation-offline-import.md).
- [Describe actual save safety](documentation-save-safety.md).
- [Distinguish API resource contracts](documentation-api-resource-contracts.md).
- [Correct SimpleFIN recovery instructions](documentation-simplefin-recovery.md).
- [Qualify cached-result rename invariance](documentation-artifact-identity.md).
- [Correct transaction ordering and annual-limit descriptions](documentation-transaction-order.md).
- [Describe missing-page responses](documentation-static-serving.md).
- [Remove retired income-analysis claims](documentation-retired-income-analysis.md).
- [Give startup commands one documentation owner](documentation-startup-ownership.md).
- [Use glossary display names](documentation-terminology-ownership.md).

## Shared guidance

Use `docs/TERMS.md` for display names. The audit merged draft/temporary-version wording into **unsaved changes**, revision/ETag/fingerprint wording into **saved-plan identity**, and posting/movement wording into **transaction**. Database identifiers can retain their technical names.

Use `TESTING.md` for completion gates. Each task lists the specific behavior to test, not another copy of the common gate. Audit-only checks did not execute tests, builds, imports, syncs, or projections that could write state. Later API verification is recorded with its commits.

Documentation owners are README for startup/import procedures, the frontend guide for workspace mechanics, the technical overview for implementation contracts, the glossary for names, and product intent for meanings. Preserve linked headings, assumption identifiers, and executable SQL contracts. Historical decisions remain history.

[The older target-date task](../combine-goal-date-paths.md) includes work already shared by current code. [The older financial-independence task](../financial-independence-branch-simulation.md) also includes broader schedule reuse. Reconcile those overlaps rather than schedule duplicate work.

## Audit limits and exclusions

The audit established no basis for removing shared financial execution, resolver/evaluation extension mechanisms, claims, browser recovery, durable server results, or the persistence conformance contract. The range-stream task changes transport ownership, not every cache layer.

The real fixture API reuses production handlers. Combined and split Docker images remain supported. Distinct account dialogs have different interactions, and screenshot coverage did not establish visual equivalence. Browser safe-spending settings do not match an existing server-summary contract.

Measured deletion candidates were 183 identity lines, 15 unused SimpleFIN lines, and 28 unreachable Outlook lines. Other measurements were a 32-line loop wrapper, 15 identical verdict lines, 29 identical Docker lines, and startup-document overlaps of 19, 8, and 4 lines. These are not combined net savings.

Existing build output measured 190,171 gzip bytes for entry JavaScript and 230,468 for initial static JavaScript. The lockfile had one React and one React DOM path, both `19.3.0`. All 29 CSS files had imports, which does not prove every selector is useful. No fresh build, cache-hit-rate, latency, or net-savings measurement supported further cuts.
