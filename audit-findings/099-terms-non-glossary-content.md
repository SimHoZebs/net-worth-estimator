---
id: 099
title: Keep the glossary to term definitions
scope: doc-audit-reference
status: accepted
---

The glossary holds three sections that are not term definitions. One restates the replay-ordering algorithm owned by the technical overview, one duplicates the analysis-versus-income-evidence distinction with a single UI-placement sentence owned by the same doc, and one states test policy plus a negative claim that becomes false the moment a route-name check is added.

Reduce the replay section to naming facts plus a link, delete the redundant distinction after moving the outlook sentence to the architecture doc if it is worth keeping, and reduce the test-policy section to the durable naming statement plus a `TESTING.md` link.

Verify by reading the three passages side by side and confirming each fact resolves to exactly one owner. The code currently matches the documented ordering, so this is a drift risk rather than a contradiction.

References: `docs/TERMS.md:22-26,109-115,130-132`; `TECHNICAL_OVERVIEW.md:316,512-515,622`; `backend/internal/domain/prepare.go:74-82,180-198`; `TESTING.md:79,87,98`.
