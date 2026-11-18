---
id: 049
title: Use one findings query for pattern review
scope: frontend-state
status: accepted
---

`AnalysisFindings` subscribes to the same findings endpoint twice: once paged for the BNPL table and once with a full cursor loop for pattern review (`AnalysisFindings.tsx:33-48`), both polling on the same interval (`state/analyses.ts:26-50`, `state/allAnalysisFindings.ts:11-35`). Two live caches exist for one resource.

Keep one query family and derive both views from it, either with one complete list sliced locally or by scoping the complete fetch to when the pattern section needs it. `analysisFindingsKey` stays the single invalidation root.

Verify network shows one findings fetch family per poll, both tables render from the same data, and confirm plus reject plus dismiss still refresh both views.

References: `frontend/src/pages/sources/AnalysisFindings.tsx:33-48`; `frontend/src/state/analyses.ts:26-50`; `frontend/src/state/allAnalysisFindings.ts:11-35`.
