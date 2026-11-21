---
id: 087
title: Keep one source for the receipt provenance version
scope: backend-domain
status: accepted
---

The producer name and version string exist both as gmail constants and as the return value of `store.ReceiptProvenanceForEmail()`. Production writes use the store function; the gmail constants are referenced only by a test asserting the two agree. A version bump can therefore be half-applied without any signal.

Delete the two gmail constants and have the test compare against `store.ReceiptProvenanceForEmail()`, leaving one source of truth for the versioned value.

Verify that a `ReceiptProducer` search shows only the definition and one test line, then run `go test ./internal/gmail/... ./internal/store/...` from `backend/`.

References: `backend/internal/gmail/receipts.go:30-37,391,530`; `backend/internal/store/types.go:637-643`; `backend/internal/gmail/receipts_test.go:231-232`.
