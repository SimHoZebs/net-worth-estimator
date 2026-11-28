---
id: 121
title: Keep confirmation dialog actions within reach
scope: ui-ux
status: implemented
---

Delete account and End schedule open confirmation dialogs. The shared dialog centers its contents without a maximum height or a scroll area. If the contents exceed the available height, a user can lose access to the buttons at the bottom.

Give the shared confirmation dialog a viewport-relative maximum height and reuse the scrolling behavior of the regular dialog.

## References

- `frontend/src/components/ui/alert-dialog.tsx:41-59` positions the shared confirmation dialog.
- `frontend/src/components/ui/dialog.tsx:95-105` shows the existing scroll treatment.
- `frontend/src/pages/accounts/AccountDeleteSection.tsx:118-142` and `frontend/src/components/activity/TransactionDetail.tsx:1566-1605` are affected entry points.

## Verification

Source inspection confirms there is no viewport height limit or scroll container in the shared confirmation dialog. Clipping was not tested in a browser.

Open both confirmations at a narrow mobile width and a short height, including enlarged text. Verify that the contents scroll when needed, both buttons stay reachable by touch and keyboard, and Escape restores focus to the trigger.

Implemented in commit `e68bbbdc`.
