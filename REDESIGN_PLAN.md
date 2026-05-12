# Component Extraction & Composition Plan

Status: **In progress** — Phase 1 (dashboard sub-components) underway.

---

## Problem

Four large components violate the Single Responsibility Principle and mix concerns:

| Component                           | Lines | Problem                                                                                                     |
| ----------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| `CsvProjectionDashboard.tsx`        | 472   | Computes ~15 derived values inline, renders 8 distinct UI sections monolithically                           |
| `CsvScenarioInspector.tsx`          | 457   | Doubles JSX via `isEditing` branch for accounts, postings, checkpoints                                      |
| `CsvContributionWhatIfControls.tsx` | 420   | Three duplicated form-in-a-section patterns (account, posting, checkpoint)                                  |
| `StochasticControls.tsx`            | 236   | Debounce timer logic embedded in component body                                                             |
| `App.tsx`                           | 231   | Minor: `activeOverrideCount` computed inline instead of using existing `selectActiveOverrideCount` selector |

---

## End State

```
App (orchestrator)
├── ProjectionDashboard (orchestrator, ~80 lines)
│   ├── AccountDiagnosticChart   [existing, unchanged]
│   ├── ProjectionHeadline        [NEW]
│   ├── OutcomeMetricsRow         [NEW]
│   │   └── OutcomeMetric × 3    [existing]
│   ├── TargetNetWorthCard        [NEW]
│   │   └── CompactDetail × 3    [existing]
│   ├── AssumptionsPanel          [NEW]
│   ├── DriverCardsRow            [NEW]
│   │   └── DriverCard × 3       [existing]
│   ├── TransactionCompletionTable [NEW]
│   └── UpcomingTransactionsTable [NEW]
├── ContributionWhatIfControls (orchestrator, ~50 lines)
│   ├── WhatIfAccountForm         [NEW]
│   ├── WhatIfPostingForm         [NEW]
│   └── WhatIfCheckpointForm      [NEW]
├── StochasticControls (orchestrator, ~190 lines)
│   └── useDebouncedStochasticConfig [NEW hook]
├── ScenarioInspector (orchestrator, ~130 lines)
│   ├── SummaryCard × 7           [MOVED to ui/]
│   ├── EditableAccountsTable     [NEW]
│   ├── ReadOnlyAccountsTable     [NEW]
│   │   └── DataTable             [MOVED to ui/]
│   ├── EditablePostingsTable     [NEW]
│   ├── ReadOnlyPostingsTable     [NEW]
│   ├── EditableCheckpointsTable  [NEW]
│   └── ReadOnlyCheckpointsTable  [NEW]
└── TemplateWizard                [existing, unchanged]
    ├── IncomeForm                [existing]
    └── TemplatePreview           [existing]
```

---

## Phase 1: Extract Dashboard Sub-components

Extract 7 components from `CsvProjectionDashboard.tsx` into `src/components/dashboard/`.

### Files to create

| File                             | Responsibility                                                | Props                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ProjectionHeadline.tsx`         | Status badge + headline text + detail text + override badge   | `goalReached`, `headline`, `headlineDetail`, `activeOverrideCount`                                                                                                                   |
| `OutcomeMetricsRow.tsx`          | 3-column grid of OutcomeMetric cards                          | `currentNetWorth`, `currentDate`, `finalNetWorth`, `finalDate`, `distanceToTarget`, `goalReached`                                                                                    |
| `TargetNetWorthCard.tsx`         | Target input/display with inline editing + CompactDetails     | `targetNetWorthInput`, `onChange`, `horizonYears`, `projectionStartDate`, `activeOverrideCount`                                                                                      |
| `AssumptionsPanel.tsx`           | Key assumptions card (income, expenses, counts, disclaimer)   | `pack`, `horizonYears`, `hasStochasticData`                                                                                                                                          |
| `DriverCardsRow.tsx`             | 3 DriverCards (constraint, next transaction, completion rate) | `biggestShortfallPosting`, `goalReached`, `firstProjectedRow`, `nextEventDetail`, `postingUtilizationRate`, `realizedPostingAmount`, `requestedPostingAmount`, `enabledPostingCount` |
| `TransactionCompletionTable.tsx` | Table showing per-posting completion rates                    | `postingSummaries`                                                                                                                                                                   |
| `UpcomingTransactionsTable.tsx`  | Expandable table of upcoming projected transactions           | `activeFutureRows`, `postingLabelById`, `expandedEventRows`, `onToggleEventRow`                                                                                                      |

### Files to modify

- `CsvProjectionDashboard.tsx` — Replace inline JSX blocks with new component composition

---

## Phase 2: Extract Inspector Sub-components

Extract 6 components from `CsvScenarioInspector.tsx` into `src/components/inspector/`.

### Files to create

| File                           | Responsibility                                                       |
| ------------------------------ | -------------------------------------------------------------------- |
| `EditableAccountsTable.tsx`    | Inline-editable accounts table (ID, Label, Min, Max, Color, Enabled) |
| `ReadOnlyAccountsTable.tsx`    | Thin wrapper around DataTable for read-only accounts                 |
| `EditablePostingsTable.tsx`    | Inline-editable postings table (14 columns)                          |
| `ReadOnlyPostingsTable.tsx`    | Thin wrapper around DataTable for read-only postings                 |
| `EditableCheckpointsTable.tsx` | Inline-editable checkpoints table (Date, AccountId, Balance)         |
| `ReadOnlyCheckpointsTable.tsx` | Thin wrapper around DataTable for read-only checkpoints              |

### Files to move

- `DataTable` — from private helper in `CsvScenarioInspector` to `src/components/ui/data-table.tsx`
- `SummaryCard` — from private helper in `CsvScenarioInspector` to `src/components/ui/summary-card.tsx`

---

## Phase 3: Extract What-If Form Sub-components

Extract 3 components from `CsvContributionWhatIfControls.tsx` into `src/components/what-if/`.

### Files to create

| File                       | Responsibility                                            |
| -------------------------- | --------------------------------------------------------- |
| `WhatIfAccountForm.tsx`    | Inline add-account form + added accounts list             |
| `WhatIfPostingForm.tsx`    | Inline add-posting form (13 fields) + added postings list |
| `WhatIfCheckpointForm.tsx` | Inline add-checkpoint form + added checkpoints list       |

---

## Phase 4: Extract Debounce Hook

### Files to create

| File                                        | Responsibility                                               |
| ------------------------------------------- | ------------------------------------------------------------ |
| `src/hooks/useDebouncedStochasticConfig.ts` | Encapsulates debounce timer, pending config, immediate apply |

### Files to modify

- `StochasticControls.tsx` — Use hook instead of inline debounce logic

---

## Phase 5: Minor Optimizations

- `App.tsx`: Use `selectActiveOverrideCount` selector instead of manual computation
- `CsvProjectionDashboard.tsx`: Same fix (or receive as prop after extraction)

---

## File Count Summary

| Category                    | New files                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/dashboard/` | 7                                                                                                                                      |
| `src/components/inspector/` | 6                                                                                                                                      |
| `src/components/what-if/`   | 3                                                                                                                                      |
| `src/components/ui/`        | 2 (moved)                                                                                                                              |
| `src/hooks/`                | 1                                                                                                                                      |
| **Total new files**         | **19**                                                                                                                                 |
| **Files modified**          | 5 (`App.tsx`, `CsvProjectionDashboard.tsx`, `CsvScenarioInspector.tsx`, `CsvContributionWhatIfControls.tsx`, `StochasticControls.tsx`) |

## Verification

After each phase:

```
npm run typecheck
npm run test
npm run dev   # visual smoke test
```
