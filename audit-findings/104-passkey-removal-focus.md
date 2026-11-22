---
id: 104
title: Restore focus and announce passkey removal
scope: ui-ux
status: needs-review
---

## Executive summary

Removing a passkey calls `listPasskeys()`, which clears and rebuilds every list item. The focused Remove button is destroyed, so focus falls back to the document body. No success feedback is reported and the list has no live region (an element whose text changes assistive technology announces), so a screen-reader user gets no confirmation and a keyboard user must tab from the top again. Remove only the affected item, move focus to a known control, and report success.

## Recommended action

Remove only the affected list item and move focus to the next Remove button or the add-passkey control, then report success. If rebuilding the whole list stays, add a polite live region to the list and set focus explicitly after the rebuild.

## Before and after

| | Passkey removal |
| --- | --- |
| Before | Every list item is rebuilt, focus drops to the document body, and no success announcement is made |
| After | Only the removed item goes, focus lands on the next Remove button or the add-passkey control, and success is reported |

```mermaid
flowchart LR
  subgraph before[Before]
    A[Press Remove] --> B[List rebuilt, focus lost]
  end
  subgraph after[After]
    C[Press Remove] --> D[One item removed, focus to a known control]
  end
```

## Expected improvement

Keyboard and screen-reader users get a predictable landing place for focus and a confirmation that the passkey was removed. This is a structural accessibility improvement; no benchmarks were run, so no speed, line-count, or bundle savings are claimed.

## Alternatives considered

- Leave as is — focus loss and silence remain on every removal. Rejected.
- Keep the rebuild and only add a live region — success is announced but focus is still dropped, so the keyboard user starts over. Rejected as a weaker fix; usable only if item-level removal cannot be done.

## Downside of rejecting

Every removal sends keyboard focus to the document body and leaves screen-reader users without confirmation, so they must re-scan the passkey list to learn what happened.

## Verification

Walk the journey with a keyboard: tab to Remove, press Enter, confirm focus lands on a known control and the removal is announced. Keep `auth.test.ts` green. No screen-reader session was run for this audit, so the announcement failure is reasoned from markup rather than observed. This is a proposed acceptance check, not a recorded result.

References: `auth/better-auth/src/client.ts:42-43,53-60`; `auth/better-auth/src/pages.ts:47`.
