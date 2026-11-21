---
id: 115
title: Make an open-ended share an explicit choice
scope: ui-ux
status: needs-review
---

The share-until field is labelled "Share until (empty for no end)", which is the exact pattern the hint policy rejects: a sentence about leaving a field empty embedded in the label instead of an explicit structure that communicates the state.

Label the field "Share until" and add a "No end date" choice that hides or disables the date input when selected.

Verify that an unset end still saves as open-ended and the preview still reads "with no end".

References: `frontend/src/pages/GroupSharingSection.tsx:364`; `docs/UI_UX_PRINCIPLES.md:338-345`.
