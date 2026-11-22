---
id: 087
title: Keep one source for the receipt provenance version
scope: backend-domain
status: accepted
---

## Scenario

Gmail receipt discovery is a scheduled background scan, not a screen the user clicks. The scan worker fetches new Gmail messages, decides whether each is a receipt, extracts the merchant, amount, and reference, and saves a receipt row before the user reviews receipts on the receipts screen. Each saved row carries provenance, meaning a producer name and a version string recording which detector-and-extractor combination produced it. The detector classifies a message as a receipt, shipping notice, or other verdict; the extractor pulls out the merchant and amount. The version matters because changing that combination must invalidate cached review standing, meaning a previously reviewed receipt must be reviewed again, and the later receipt-matching step consumes the same identity to claim a receipt against a transaction. The value crosses into SQLite as two strings inside the stored receipt row; no request body carries it. The version is written once by the store helper used at every save site. A test also compares the stored value against constants declared in the Gmail package. That second declaration is the duplicate: a version bump applied to one source but not the other leaves two different provenance values saved on receipts with no failing signal.

## Executive summary

The producer name and version string recorded on receipts exist in two places: as gmail constants and as the return value of `store.ReceiptProvenanceForEmail()`. Production writes use the store function; the gmail constants are referenced only by a test asserting the two agree. A version bump can therefore be half-applied with no signal. The recommended action is to delete the gmail constants and have the test compare against the store function.

## Recommended action

Delete the two gmail constants and have the test compare against `store.ReceiptProvenanceForEmail()`, leaving one source of truth for the versioned value.

## Before and after

| Before | After |
| --- | --- |
| Two sources for the version string: gmail constants and the store function, with a test checking they agree. | One source: the store function; the test compares against it directly. |

```mermaid
flowchart LR
  subgraph Before
    C[gmail constants] --> T[agreement test]
    S[store function] --> T
  end
  subgraph After
    S2[store function] --> T2[test]
  end
```

## Expected improvement

Structural. A single source means a version bump cannot be half-applied. No benchmarks were run, so no speed or size improvement is claimed.

## Alternatives considered

- Keep the constants and the agreement test. Rejected because a dual source still allows a half-applied bump, with a test as the only guard.
- Leave as is. Rejected for the same reason; the duplicate has no production use.

## Downside of rejecting

A version bump can be applied to one source only with no failure signal, producing inconsistent provenance on receipts.

## Verification

A `ReceiptProducer` search should show only the definition and one test line, then run `go test ./internal/gmail/... ./internal/store/...` from `backend/`. These are proposed acceptance checks.

References: `backend/internal/gmail/receipts.go:30-37,391,530`; `backend/internal/store/types.go:637-643`; `backend/internal/gmail/receipts_test.go:231-232`.
