# CSV Product Model

Status: implemented.

This file describes the current CSV-backed product model.

## Product Rules

- Historical net worth comes from account balance checkpoints.
- Future net worth comes from tracked account balances, scheduled postings, and account growth between exact event dates.
- Every future cash movement is represented as a posting.
- Postings can represent external inflows, external outflows, or account-to-account transfers.
- Canonical persistent data lives in repo-backed CSV files under `public/scenario/`.
- The UI is read-only for persistent data.
- Runtime target net worth is session-only and editable in the UI.
- Projection horizon is fixed at 50 years.
- Future projection starts from the latest checkpoint date, or today if no checkpoints exist.
- Temporary what-if overrides are session-only and apply only to posting multipliers.

## Canonical CSV Pack

The app loads these files from `public/scenario/`:

- `accounts.csv`
- `checkpoints.csv`
- `postings.csv`

### `accounts.csv`

Fields:

- `id`
- `label`
- `category`
- `openingBalance`
- `annualRate`
- `color`
- `enabled`

Notes:

- `openingBalance` is signed. Positive balances help net worth and negative balances reduce it.
- All enabled accounts participate in net worth.
- No account ID is treated specially by name.

### `checkpoints.csv`

Fields:

- `Date`
- `AccountId`
- `Balance`

Notes:

- Multiple rows on the same date are applied in file order.
- Historical rows are shown only on exact checkpoint dates.

### `postings.csv`

Fields:

- `id`
- `label`
- `sourceAccountId`
- `destinationAccountId`
- `amountMode`
- `basePostingId`
- `amount`
- `annualGrowthRate`
- `startDate`
- `endDate`
- `annualCap`
- `priority`
- `enabled`

Notes:

- Blank `sourceAccountId` means an external inflow.
- Blank `destinationAccountId` means an external outflow.
- Setting both account IDs creates an internal transfer.
- `amountMode` is `fixed` or `percent_of_base`.
- `percent_of_base` rows use the latest realized amount from `basePostingId`.
- `annualGrowthRate` applies to the resolved amount over time.
- `annualCap` is optional and enforced per calendar year.
- Rows on the same date are applied in ascending `priority`, then file order.
- Rows with a source account clamp to that account's available positive balance.

## Projection Semantics

### Historical View

- Historical rows are built directly from checkpoint dates.

### Future View

For each projected event date:

1. Start from the prior checkpoint or prior projected event.
2. Accrue account growth or interest from `annualRate` using daily compounding over the exact elapsed days.
3. Resolve requested posting amounts.
4. Clamp requested amounts by annual caps and source-account liquidity when a source account exists.
5. Apply realized postings as real debits and credits.
6. Compute end-of-date net worth from enabled accounts.

### Net Worth Formula

- Net worth is the sum of enabled account balances.
- Positive balances increase net worth and negative balances reduce it.
