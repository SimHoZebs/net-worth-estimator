# CSV Product Model

Status: implemented.

This file now describes the simplified product model that replaced the old module-based architecture.

## Product Rules

- Historical net worth comes from account balance checkpoints.
- Future net worth comes from tracked account balances, dated contribution plans, dated transfers, and account growth between exact event dates.
- `budget_items` affect dated contribution capacity only.
- `budget_items` do not directly mutate tracked balances.
- Canonical persistent data lives in repo-backed CSV files under `public/scenario/`.
- The UI is read-only for persistent data.
- Runtime target net worth is session-only and editable in the UI.
- Projection horizon is fixed at 50 years.
- Future projection starts from the latest checkpoint date, or today if no checkpoints exist.
- Temporary what-if overrides are session-only and apply only to contribution plans.

## Canonical CSV Pack

The app loads these files from `public/scenario/`:

- `accounts.csv`
- `checkpoints.csv`
- `budget_items.csv`
- `contribution_plans.csv`
- `transfers.csv`

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

### `budget_items.csv`

Fields:

- `id`
- `label`
- `direction`
- `parentBudgetItemId`
- `amountMode`
- `amount`
- `annualGrowthRate`
- `startDate`
- `endDate`
- `category`
- `enabled`

Notes:

- `direction` is `in` or `out`.
- `amountMode` is `fixed` or `percent_of_parent`.
- These rows create dated contribution-capacity cashflows only.

### `contribution_plans.csv`

Fields:

- `id`
- `label`
- `targetAccountId`
- `calculationMode`
- `baseBudgetItemId`
- `amount`
- `startDate`
- `endDate`
- `annualCap`
- `priority`
- `enabled`

Notes:

- `calculationMode` is `fixed`, `percent_of_capacity`, or `percent_of_budget_item`.
- Contributions are scheduled monthly from `startDate` using that day of month.
- Contributions are applied in priority order and clamped by remaining capacity, annual caps, and schedule.

### `transfers.csv`

Fields:

- `id`
- `label`
- `sourceAccountId`
- `destinationAccountId`
- `amountMode`
- `amount`
- `startDate`
- `endDate`
- `enabled`

Notes:

- `amountMode` is currently `fixed`.
- Transfers are scheduled monthly from `startDate` using that day of month.
- Transfers move balances between tracked accounts, do not depend on budget capacity, and are clamped by the source account's available positive balance.

## Projection Semantics

### Historical View

- Historical rows are built directly from checkpoint dates.

### Future View

For each projected event date:

1. Start from the prior checkpoint or prior projected event.
2. Accrue account growth or interest from `annualRate` using daily compounding over the exact elapsed days.
3. Apply dated `budget_items` cashflows to available contribution capacity.
4. Compute requested contributions from `contribution_plans`.
5. Clamp contributions by remaining capacity, annual caps, and schedule.
6. Apply realized contributions to target accounts.
7. Apply transfers.
8. Compute end-of-date net worth from enabled accounts.

### Net Worth Formula

- Net worth is the sum of enabled account balances.
- Positive balances increase net worth and negative balances reduce it.

## UI Model

- Read-only inspector tables for all CSV-backed data.
- Runtime settings summary for projection start, fallback start, target net worth, and horizon.
- Validation errors surfaced directly in the app.
- Session-only slider overrides for contribution plans.
- Projection dashboard focused on net worth, account balances, dated event rows, contribution capacity, and contribution utilization.

## Current Code Layout

- `src/App.tsx`: app shell
- `src/hooks/useCsvScenarioPack.ts`: CSV loading and reload state
- `src/hooks/useCsvWhatIfState.ts`: session-only contribution override state
- `src/hooks/useCsvProjectionWorker.ts`: worker-backed projection execution
- `src/components/CsvScenarioInspector.tsx`: read-only data inspection
- `src/components/CsvContributionWhatIfControls.tsx`: temporary slider overrides
- `src/components/CsvProjectionDashboard.tsx`: projection dashboard
- `src/components/ScenarioValidationPanel.tsx`: validation issue display
- `src/lib/projection/`: CSV schema, parsing, validation, projection logic, and shared types

## Removed Architecture

The old module/plugin/compiler/allocation-policy/localStorage product model has been removed.

- No JSON scenario persistence.
- No module compiler.
- No allocation policy system.
- No special-case `cash` account logic.
- No tax-specific runtime layer.
- No in-app persistent editor for scenario data.

## Remaining Optional Work

- Add exact amount override UI on top of the existing override engine support.
- Reduce bundle size if the build warning becomes important.
