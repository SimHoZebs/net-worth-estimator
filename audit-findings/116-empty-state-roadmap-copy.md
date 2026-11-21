---
id: 116
title: Remove tutorial and roadmap text from empty states
scope: ui-ux
status: needs-review
---

The inbox empty state announces an unbuilt feature, and its header note restates the Accept and Decline buttons while duplicating both the declined empty state and the accepted copy text nearby. The outlook empty state adds a tutorial paragraph to a title and button that already stage the single action. The buttons and per-card copy already explain what to do.

Drop the split-requests roadmap string and the header note, and delete the outlook empty-state description. Keep the buttons and per-card copy as the explanation.

Verify that accept and decline still explain themselves through their buttons and card copy and that a search for the roadmap string returns nothing.

References: `frontend/src/pages/InboxPage.tsx:78,314`; `frontend/src/pages/Outlook.tsx:63`.
