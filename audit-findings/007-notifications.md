---
id: 007
title: Consolidate notifications on Base UI Toast
scope: frontend-state
status: accepted
---

Priority: medium-high.

NotificationCenter mounts Sonner beside a custom fixed stack whose cards are styled Alerts. Notification helpers populate the custom zustand stack, while other callers invoke Sonner directly. The installed Base UI Toast implementation has no application importer. Avoiding duplicate delivery per helper did not consolidate the notification system.

For the requested Base UI target, route notifications through the shadcn Base UI Toast manager and viewport, then remove the custom stack and Sonner path. Preserve keyed replacement, action callbacks, user-scope clearing, and appropriate announcement urgency as application policy. Check manager APIs before mapping dismissal callbacks. A single Sonner system would also be consistent shadcn usage, but it is the weaker fit for the explicitly requested Base UI behavior target.

References: `frontend/src/components/NotificationCenter.tsx:18`, `frontend/src/components/NotificationCenter.tsx:59`, `frontend/src/state/notifications.ts:38`, `frontend/src/state/notifications.ts:58`, `frontend/src/components/ui/toast.tsx:9`. Current official Base UI toast composition: https://ui.shadcn.com/docs/components/base/sonner.

Verification: one visible notification per event, keyed replacement/dismissal, actions, expiry, swipe dismissal, appropriate announcements, clearing at identity changes, and correct appearance after live theme changes. No production bundle-size claim is made for the unused source.
