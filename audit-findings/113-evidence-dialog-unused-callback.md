---
id: 113
title: Remove the unused evidence edit callback
scope: ui-ux
status: accepted
---

`EvidenceDialog` requires an `onEdit` prop, supplied through a trivial `editFromEvidence` wrapper, and never invokes it. Readers reasonably assume evidence rows can open an editor when they cannot, and the wrapper exists only to satisfy a type.

Remove `onEdit` from the props type, the call site, and the wrapper export.

Verify with typecheck and a grep confirming no remaining consumer.

References: `frontend/src/components/EvidenceDialog.tsx:21-28`; `frontend/src/workspace/WorkspaceDialogs.tsx:67`; `frontend/src/workspace/useWorkspaceOverlays.ts:88,120`.
