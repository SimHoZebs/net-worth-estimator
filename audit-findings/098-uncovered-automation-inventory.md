---
id: 098
title: Give the uncovered-by-automation list one owner
scope: doc-audit-reference
status: accepted
---

The integration-edge guide cedes the ship-or-no-ship checklist to the release-gates doc but keeps its own "Uncovered by automation" list. The mail-OAuth seam and image-extraction stand-in appear in both, and passkeys appear in both plus the e2e gate. A maintenance change to any one of those gaps must be applied in several docs.

Make the release-gates section the sole owner. Replace the edge-tier section with a pointer that retains only tier-specific gaps, and link to the manual checklist instead of restating the passkey item.

Verify that one owning list remains and the other two sites are pointers with the same heading.

References: `docs/integration-edge-gates.md:3-4,156-166`; `docs/release-gates.md:111-131,121-127`; `docs/e2e-gate.md:35`.
