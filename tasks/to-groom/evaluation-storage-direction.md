# Evaluation storage + explanation direction

Rulings (user, 2026-11-01), in product language:

1. **Explanation reads through the evaluation reader only.** It never invokes
   the simulators and never writes. It consumes the reader path's data.
2. **Stale-data definition stands** (uniform 14-day default; see FIN-05).
3. **Explanation lives in the evaluation detail model.** No separate endpoint,
   no special backend implementation — it rides the existing detail shape.
4. **Storage direction (future work, not yet scoped):** evaluations currently
   keep their data as JSON in a single shared table. Each evaluation should
   get its own table instead. In a plugin setup the plugin stays
   storage-agnostic: it never learns CRUD. The evaluation itself owns its
   table's reads and writes.

## Consequences

- FIN-05's composer output moves into the evaluation detail model
  (follow-up on the FIN-05 branch). Reader-only access is a hard constraint.
- The per-evaluation-table migration is unscoped future work. It touches the
  evaluation registry and every stored evaluation, so it lands as its own
  task after the current branches, never smuggled into a running track.
- Human-readable target copy per check (FIN-05 Q3) is still open.
