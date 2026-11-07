# Visible accounts and loans

An ordinary account displays one model account. A principal-plus-interest
loan displays one saved relationship owned by its principal account. The
principal account ID is also the visible account ID. No extra balance enters
net worth. Membership is explicit and never inferred from names.

The loan form creates two debt accounts, two opening balance checks, an
interest charge schedule, and an interest-first payment schedule in one
transaction. Interest uses principal only. The annual rate is divided by the
interest charge frequency through the existing occurrence-rate provider.
This is periodic simple interest, not lender-specific daily accrual or
capitalization. The form states the charge frequency explicitly.

Create a loan through **Add account → Account type → Loan**.
The principal, interest, and payment fields appear in that same account dialog.

Loan edits preserve account and schedule IDs and existing observations.
Only an explicit balance edit records a new pair of observations. Components
retain separate observation timestamps. A combined recorded total appears
only when both observations share the same instant. Modeled balances can
always be summed at the same projection cut.

Payment destination selection expands the visible account to interest, then
principal at the write boundary. The calculation engine still uses raw
account IDs. Account-balance goal checks use the combined balance when the
selected account owns a display relationship. Deleting a loan removes its components, balance checks, and
managed schedules atomically. Other financial references block deletion.

## Existing databases

Run the explicit operator upgrade before this release serves an existing
database. Stop writes and retain the database backup. Runtime and normal
setup never convert existing loans or infer relationships.

```sh
python3 backend/scripts/one-time/account-displays/upgrade.py --db /path/app.db --backup /path/app.before-displays.db
```

To link an existing pair, use a reviewed JSON file with `userId`,
`principalId`, `interestId`, `interestScheduleId`, `paymentScheduleId`, and
`name`. Pass its path through `--link`. It preserves all account and rule
IDs, amounts, and history. Do not use the same backup destination twice.
The link tool rejects calculated payments, custom interest formulas, volatility,
annual caps, end dates, and mismatched inclusion. Those rules cannot round-trip
through this loan form. Fixed payments use decimal literals in whole cents,
without a leading plus sign. Name-only edits retain the exact supported descriptors.
Payments must use an existing non-debt funding account owned by the same user.
Run separately for each user relationship. Verify the result through the
ordinary account view after deployment.

Future debt products can extend the explicit role mapping and their own
setup compiler. Capitalization can use a transfer from principal to interest
under a separate product contract. Ordinary accounts require no metadata.
