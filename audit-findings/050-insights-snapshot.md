---
id: 050
title: Drop the insights snapshot and render-phase sync
scope: frontend-state
status: accepted
---

`TransactionInsightsPanel` keeps a client copy of queue progress: `recurringSnapshot` duplicates server pattern data with `shown` preferring the snapshot over live `active` (`TransactionInsights.tsx:213-214,262-265`), render-phase sync resets step, error, duration, dialog, and void fields during render (`:217-242`), and `handled` accumulates dismissed keys parallel to server review state (`:201,249-259`).

Replace the snapshot with a dialog keyed by finding id, derive `shown` from `active` only while keeping the dialog mounted across the refetch boundary, and move the queue-change reset out of the render body. The open forecast dialog must survive acceptance without stale anchor data.

Verify accepting a pattern with its dialog open keeps the dialog mounted, Continue advances the queue, and no render-phase `setState` remains.

References: `frontend/src/components/activity/TransactionInsights.tsx:201,213-265`.
