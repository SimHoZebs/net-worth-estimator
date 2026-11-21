---
id: 086
title: Delete zero-caller provider verbs and the legacy fallback
scope: backend-domain
status: accepted
---

Three small dead members remain in live frameworks. `ingest.Adapter.Key` is declared and documented as the provider key, but the orchestrator never reads it; its implementation returns the same literal written directly at every checkpoint, and a test fake carries an unread `key` field. `integrations.Registry.IDs` duplicates `Snapshot()` and is called only by two assertions in its own test. `categoryFeedbackSource` is a superseded v1 nil fallback: production always injects the journal source, so it is reachable only from direct unit tests, and the docs already record the supersession.

Delete `Adapter.Key` with its implementations and fixture assignments, delete `Registry.IDs` with its two assertions, and require a feedback source at construction or in `Classify` so `categoryFeedbackSource` and its stale comment can go. Keep the `var _ ingest.Adapter` assertion and the working snapshot and feedback paths.

Verify that a grep confirms zero call sites for `Key()` and production-zero for `IDs()`, then run the ingest, SimpleFIN, integrations, and categorization package tests. A future multi-provider registry might want `Key`, but there is no current caller.

References: `backend/internal/ingest/ingest.go:38`; `backend/internal/simplefin/adapter.go:19-23,146`; `backend/internal/integrations/provider.go:61-71`; `backend/internal/api/integrations/routes.go:40,48`; `backend/internal/categorization/ml_classifier.go:10-19,78-81`; `docs/categories.md:81-83`.
