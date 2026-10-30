# Asynchronous BNPL Analysis

Implemented as a local, evidence-backed Analysis over saved bank records. See
`docs/analyses.md` for the current contract and deployment procedure.

- Preserve source evidence independently of display labels and model values.
- Run through the independent, restart-safe Analysis worker.
- Persist runs and detected findings outside the financial model.
- Flag transactions and expose reasons, freshness, and dismissal.
- Never create recurrence rules, model debt, or modify forecasts automatically.

Income-pattern detection, a broader orthogonal classifier, plan reconstruction,
external enrichment, and calibrated accuracy remain separate work.
