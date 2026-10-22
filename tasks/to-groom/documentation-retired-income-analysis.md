# Income-analysis remnants: correct diagrams and loading copy

The loading announcement names an income snapshot, and the primitive diagram names `domain.analyzePay` and an analysis panel. Current startup loads status, the saved plan, and amount recipes. No current income-analysis result or panel supplies those claims.

Remove the obsolete diagram node and edge. Change the announcement to `Loading your saved plan.` Correct current-mechanics prose and describe income evidence as a product concept rather than an implemented current panel. Preserve its glossary heading and future requirements.

- Claims: `docs/primitives.html:8-13,421-427,554`, `docs/TERMS.md:68-74`.
- Actual startup/page: `frontend/src/state/workspaceStore.ts:493-497`, `frontend/src/pages/SourcesPage.tsx:21-44`.
- Announcement/history: `frontend/src/app/ServerLoadingShell.tsx:50-52`, `tasks/income-detection.md:35-39`.

Search current source and prose for the removed symbol, income snapshot, and deleted-panel claims. Verify diagram rendering and the spoken loading announcement. This task does not implement income detection.
