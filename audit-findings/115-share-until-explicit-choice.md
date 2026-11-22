---
id: 115
title: Make an open-ended share an explicit choice
scope: ui-ux
status: needs-review
---

## Scenario

Inside a group's detail view on the Groups page, the sharing section is where one member decides whether to automatically share their own transactions with that group. This is an internal section rendered when a group is open, not a separate screen. The member selects accounts, chooses a Share from date and a Share until date, then clicks Turn on sharing, or Save changes when sharing is already on. The browser sends that selection to the API as account identifiers and date strings, and the server first counts how many transactions would be shared. That count comes back as a preview sentence before sharing is actually switched on, and it appears a moment after typing so each keystroke does not start a request. Leaving the end date empty is sent as no value at all, and the preview then reads with no end. When the member turns sharing on, the browser sends the same selection with an explicit enabled flag and the saved policy changes what group members can see. The Share until field is a native date input, so the only way the current design expresses an open-ended share is to leave it empty, and the label carries a parenthetical note to explain that. No parser is involved: the empty text is simply turned into no value at the API boundary. Open-ended means the sharing has no end date; the preview is a count the server calculates from the draft without changing anything; a policy is the saved set of sharing preferences.

## Executive summary

The share-until field currently bakes the open-ended case into its label as Share until (empty for no end). That is the exact pattern the hint policy rejects: instructions about leaving a field empty embedded in the label instead of an explicit structure that communicates the state. The field's meaning ends up depending on a parenthetical sentence. Rename the label to Share until and add an explicit No end date choice that hides or disables the date input when selected, so an open-ended share is shown by a control rather than a note.

## Recommended action

Change the label to Share until and introduce a No end date choice that owns the open-ended state. When that choice is selected, hide or disable the date input. This reuses the existing field; no new screen is needed.

## Before and after

| Aspect | Before | After |
| --- | --- | --- |
| Label | "Share until (empty for no end)" | "Share until" |
| Open-ended state | Expressed by leaving the field empty | Explicit "No end date" choice |
| Date input | Always active | Hidden or disabled when no end is chosen |

```mermaid
flowchart LR
  A["Empty field means no end"] --> B["No end date choice hides or disables the input"]
```

## Expected improvement

The open-ended state becomes explicit and self-describing, and the preview already reads with no end, so the label no longer needs a sentence about emptiness. This is a structural improvement only. No benchmarks were run, so no speed, line-count, or bundle savings are claimed.

## Alternatives considered

- Leave as is: this keeps the parenthetical-in-label pattern the policy rejects.
- Keep the empty-means-open behaviour and only shorten the label: this drops the explanation and leaves the state implicit again.

## Downside of rejecting

The field keeps relying on a parenthetical note to explain that an empty value means no end, which is the ambiguity the hint policy calls out. Users must read the label sentence to understand the state instead of seeing it in the control.

## Verification

Confirm that an unset end still saves as open-ended and the preview still reads with no end after the label and choice change. This is a proposed acceptance check, not a recorded result.

References: `frontend/src/pages/GroupSharingSection.tsx:364`; `docs/UI_UX_PRINCIPLES.md:338-345`.
