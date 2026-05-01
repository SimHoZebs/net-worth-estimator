# Technical Overview: Net Worth Estimator

The Net Worth Estimator is a single-page React application that projects net worth from a CSV-backed data model plus runtime projection settings.

## 1. Tech Stack

- React 19, Vite, TypeScript
- Tailwind CSS v4
- Recharts
- Vitest
- Papa Parse
- Zod

## 2. High-Level Architecture & Data Flow

The application loads canonical CSV files from the repo, validates them, projects balances in a worker using exact dated events, and renders a read-only inspector plus dashboard. Temporary what-if overrides and target-net-worth changes exist only in browser memory for the current session.

### Data Flow Execution

1. `useCsvScenarioPack.ts` fetches the CSV files from `public/scenario/`.
2. Zod-based parsing plus reference validation rejects invalid packs before projection.
3. `useCsvWhatIfState.ts` stores session-only posting overrides such as multipliers.
4. `csvProjectionWorker.ts` runs the projection engine off the main thread.
5. The inspector and dashboard render the validated pack and projected results.

## 3. Core Concepts

- `CsvAccount`: tracked signed balances with daily-compounded `annualRate`
- `CsvCheckpoint`: historical truth for account balances on exact dates
- `CsvPosting`: generic scheduled rules for future inflows, outflows, and transfers
- `ProjectionRuntimeSettings`: target net worth, fallback start date, and projection horizon

### Posting Semantics

- Blank `sourceAccountId` plus destination means external inflow.
- Source plus blank `destinationAccountId` means external outflow.
- Source plus destination means account-to-account transfer.
- `amountMode: fixed` uses the row's dollar amount.
- `amountMode: percent_of_base` uses a percentage of the latest realized amount from `basePostingId`.
- Rows with a source account clamp to that account's available positive balance.
- `annualCap` is generic and enforced per calendar year.
- Rows on the same date are applied by `priority`, then file order.

## 4. UI Structure and Components

- `App.tsx`: orchestrates pack loading, validation, overrides, and worker-based projection
- `CsvScenarioInspector.tsx`: shows read-only CSV-backed data tables plus validation issues
- `CsvContributionWhatIfControls.tsx`: lets the user apply temporary multiplier overrides to scheduled postings
- `CsvProjectionDashboard.tsx`: renders current and projected net worth, signed account balances, dated posting rows, and posting utilization

## 5. Technical Highlights

- Repo-backed source of truth: canonical financial data is plain CSV in the repo.
- Read-only persistent UI: the app does not write scenario data back into browser storage.
- Worker-based projection: future calculations stay off the main thread.
- Signed balance model: debt is represented with negative balances, so net worth is the sum of enabled accounts.
- Dated event engine: future projections run on exact checkpoint and scheduled posting dates with daily compounding between dates.
- Real-account cash model: future inflows, outflows, and transfers all post directly into tracked accounts.
