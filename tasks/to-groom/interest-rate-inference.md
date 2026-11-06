# Interest inference from recurring interest transactions

Ruling (user, 2026-11-01): do NOT add an interest-rate/APR field to accounts.
An account bearing interest already produces recurring interest transactions on an
accurate interval. Infer the rate from those transactions using existing
primitives (recurring-pattern detection + evidence-backed classification
claims). One definition, no parallel rule, no rate tied to the database.

## Consequence for FIN-03

The high-interest-debt check ships with its carried-balance proxy and
limitation label unchanged. The proxy stands until interest-transaction inference
lands; no APR field is to be added in the meantime.

## Follow-up work (unscoped)

- A recurring detector + claim producer that identifies interest transactions
  (bank-paid interest) per account and derives an effective rate from
  amount + interval, reusing the FIN-01 contract and FND-01 claims.
- The FIN-03 high-interest check consumes the inferred rate when present and
  falls back to the labeled proxy otherwise.
- No new persistent rule or account column: inference output lives in the
  same claim/finding tables as other derived characteristics.

Depends on: FND-01 (landed on branch), FIN-01 (landed on branch).
Informs: FIN-03 high-interest check, FIN-04 presentation, FIN-05 explanation.
