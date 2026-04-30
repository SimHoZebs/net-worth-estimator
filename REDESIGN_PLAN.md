# Phased Redesign Plan

This document describes the planned rewrite of the net worth estimator into a much simpler system that can be implemented over multiple sessions.

This is intentionally a breaking redesign.

- No backward compatibility is required.
- No migration from the current scenario model is required.
- Existing module, policy, and tax-specific workflows can be deleted.
- The new CSV pack becomes the source of truth.

## Goals

- Track historical and projected net worth from account balances.
- Separate budget math from net worth math.
- Treat subscriptions, rent, taxes, and similar spending as capacity inputs, not direct projection events.
- Load canonical data from repo-backed CSV files.
- Keep the UI read-only for persistent data, but allow temporary slider-based what-if overrides for contribution plans.
- Remove special-case concepts like singleton salary modules, automatic cash sweeps, and module plugins.

## Non-Goals

- Preserving the current `v2` JSON scenario format.
- Keeping the current module compiler architecture.
- Keeping built-in derived tax planning.
- Maintaining old dashboards centered on retirement/equity/tax module families.

## Target Model

The redesign uses six core concepts.

1. `scenario`
General settings such as start month, horizon, and target net worth.

2. `accounts`
Tracked balances that count toward net worth now or in the future.

3. `checkpoints`
Historical balance truth for accounts.

4. `budget_items`
Income and spending assumptions used only to compute investable capacity.

5. `contribution_plans`
Planned contributions into tracked accounts.

6. `transfers`
Optional moves between tracked accounts.

### Core Rule

- `budget_items` do not mutate account balances.
- `contribution_plans` and `transfers` do mutate account balances.
- `checkpoints` establish historical balances.
- `accounts` plus contributions, transfers, and growth produce the future projection.

## Canonical CSV Pack

The source of truth should live under a fixed repo path such as `public/scenario/`.

### `scenario.csv`

One-row file.

Fields:

- `name`
- `startDate`
- `horizonMonths`
- `targetNetWorth`

### `accounts.csv`

Fields:

- `id`
- `label`
- `balanceType`
- `category`
- `openingBalance`
- `annualRate`
- `color`
- `enabled`

Notes:

- `balanceType` is `asset` or `liability`.
- `category` is informational and can hold values like `checking`, `401k`, `roth_ira`, `brokerage`, `rsu`, `loan`, `crypto`, etc.
- Net worth should be computed from all enabled accounts without hardcoding a special `cash` account.

### `checkpoints.csv`

Fields:

- `Date`
- `AccountId`
- `Balance`

Notes:

- This stays close to the current checkpoint CSV shape.
- Multiple checkpoint rows for the same account and month should use the latest date in that month.

### `budget_items.csv`

Fields:

- `id`
- `label`
- `direction`
- `parentBudgetItemId`
- `amountMode`
- `amount`
- `annualGrowthRate`
- `startMonth`
- `endMonth`
- `frequencyMonths`
- `category`
- `enabled`

Notes:

- `direction` is `in` or `out`.
- `amountMode` is `fixed` or `percent_of_parent`.
- `parentBudgetItemId` supports rows like `401k = 4% of salary` or `tax = 22% of salary`.
- These rows do not directly change tracked balances.

### `contribution_plans.csv`

Fields:

- `id`
- `label`
- `targetAccountId`
- `calculationMode`
- `baseBudgetItemId`
- `amount`
- `startMonth`
- `endMonth`
- `frequencyMonths`
- `annualCap`
- `priority`
- `enabled`

Notes:

- `calculationMode` is `fixed`, `percent_of_capacity`, or `percent_of_budget_item`.
- `baseBudgetItemId` is used only when `calculationMode` depends on a specific budget item.
- `priority` determines which plans consume limited capacity first.
- These rows are the main future-facing projection inputs.

### `transfers.csv`

Fields:

- `id`
- `label`
- `sourceAccountId`
- `destinationAccountId`
- `amountMode`
- `amount`
- `startMonth`
- `endMonth`
- `frequencyMonths`
- `enabled`

Notes:

- `amountMode` can start as `fixed` only.
- Transfers are optional and should be kept simpler than contribution plans.

## Projection Semantics

### Historical View

- Historical net worth is built from checkpointed account balances.
- Missing months can carry forward the last known balance for each account.
- No synthetic historical expense or income replay is needed.

### Future View

For each projection month:

1. Start from the prior month balances or the latest checkpoint baseline.
2. Compute `investableCapacity` from `budget_items`.
3. Compute requested contributions from `contribution_plans`.
4. Apply priority ordering and clamp contributions by:
   - remaining capacity
   - annual caps
   - schedule
5. Apply realized contributions to target accounts.
6. Apply transfers.
7. Apply account growth or interest.
8. Compute month-end net worth from enabled accounts.

### Net Worth Formula

- Assets add to net worth.
- Liabilities subtract from net worth.
- No account ID should be excluded by name.

## UI Model

Persistent source of truth:

- CSV files in the repo.

UI behavior:

- Read-only tables for accounts, budget items, contribution plans, transfers, and checkpoints.
- Validation errors surfaced in the app.
- Sliders for temporary what-if overrides on contribution plans.
- No persistent in-app editing in CSV-pack mode.

Suggested slider behavior:

- A slider can override a contribution plan's `amount` or a multiplier on top of it.
- Overrides are session-only and should be clearly labeled as temporary.

## What Gets Deleted

The redesign should aggressively remove current architecture that no longer matches the product model.

Delete or replace:

- module plugin registry
- employment income module
- retirement plan module
- equity grant series module
- tax marker module
- allocation policies
- cash shortfall and sweep logic
- hardcoded `cash`-specific rules
- localStorage scenario persistence as the canonical source

High-impact files to replace or delete:

- `src/lib/projection/types.ts`
- `src/lib/projection/schema.ts`
- `src/lib/projection/validation.ts`
- `src/lib/projection/planCompiler.ts`
- `src/lib/projection/taxes.ts`
- `src/lib/projection/runtime.ts`
- `src/lib/projection/project.ts`
- `src/lib/projection/selectors.ts`
- `src/lib/projection/modules/*`
- `src/components/builder/ModulesEditor.tsx`
- `src/components/builder/PoliciesEditor.tsx`
- `src/stores/useProjectionStore.ts`

## Phases

Each phase is intended to be a reasonable standalone session or group of sessions.

### Phase 1: Freeze the New Shape

Goal:

- Lock the new domain model and stop extending the old one.

Tasks:

- Add this plan doc.
- Define the exact CSV schemas and TypeScript interfaces for:
  - scenario
  - accounts
  - checkpoints
  - budget items
  - contribution plans
  - transfers
- Decide the canonical repo path for the CSV pack.
- Decide slider override shape in state.

Likely files:

- `REDESIGN_PLAN.md`
- new CSV schema/types files under `src/lib/projection/`

Done when:

- There is one agreed source of truth for the new model.
- No open questions remain about CSV columns or projection semantics.

### Phase 2: Build CSV Loading and Validation

Goal:

- Make the app load the new CSV pack directly from the repo.

Tasks:

- Add repo-backed CSV loading from `public/scenario/`.
- Create parsers for each CSV file.
- Create validation for:
  - duplicate IDs
  - missing account references
  - missing parent budget item references
  - invalid `balanceType`
  - invalid schedule values
  - invalid contribution targets
  - circular `parentBudgetItemId` chains
- Show validation errors in the UI before projection.

Likely files:

- new CSV loader/parsing modules in `src/lib/projection/`
- `src/App.tsx`
- `src/stores/useProjectionStore.ts`
- `src/components/builder/ScenarioValidationPanel.tsx`

Done when:

- Editing CSV files and refreshing the app changes the loaded scenario.
- The app can reject invalid CSV packs with useful errors.

### Phase 3: Replace the Projection Engine

Goal:

- Remove the module compiler and switch to a direct account-plus-capacity executor.

Tasks:

- Remove the current module-based compile stages.
- Implement direct month expansion for budget items, contribution plans, and transfers.
- Implement investable-capacity calculation from budget items.
- Implement contribution clamping by capacity, schedule, and annual cap.
- Apply contributions directly to target account balances.
- Apply transfers.
- Apply account growth.
- Apply checkpoints to establish history and future starting state.
- Compute net worth from all enabled accounts.

Likely files:

- `src/lib/projection/runtime.ts`
- `src/lib/projection/project.ts`
- `src/lib/projection/types.ts`
- `src/lib/projection/schema.ts`
- delete or replace `src/lib/projection/planCompiler.ts`
- delete `src/lib/projection/taxes.ts`
- delete `src/lib/projection/modules/*`

Done when:

- The new engine runs without any dependency on module plugins or allocation policies.
- Historical and projected net worth come entirely from accounts, checkpoints, contributions, transfers, and growth.

### Phase 4: Simplify the UI Around the New Model

Goal:

- Replace the builder with a read-only inspector plus what-if controls.

Tasks:

- Remove module and policy editors.
- Add read-only views for:
  - accounts
  - budget items
  - contribution plans
  - transfers
  - checkpoints
- Add temporary slider overrides for contribution plans.
- Clearly label CSV-backed data as read-only.
- Remove UI language that refers to modules compiling into runtime operations.

Likely files:

- `src/components/ProjectionControls.tsx`
- `src/components/builder/AccountsEditor.tsx`
- delete `src/components/builder/ModulesEditor.tsx`
- delete `src/components/builder/PoliciesEditor.tsx`
- `src/components/builder/ScenarioSettingsEditor.tsx`

Done when:

- The UI matches the new mental model.
- A user can inspect the CSV-backed data and run temporary what-if contribution scenarios without editing persistent data in the browser.

### Phase 5: Rewrite the Dashboard for the New Product

Goal:

- Show net worth history, projections, and contribution capacity instead of module-family summaries.

Tasks:

- Remove dashboard sections centered on retirement modules, equity modules, allocation policies, and tax plans.
- Add summaries for:
  - current net worth
  - projected net worth
  - latest checkpoint date
  - monthly investable capacity
  - requested vs realized contributions
- Keep account balance charts and ending balance summaries.
- Add a contribution utilization view by target account.

Likely files:

- `src/lib/projection/selectors.ts`
- `src/components/ProjectionDashboard.tsx`
- `src/lib/projection/types.ts`

Done when:

- The dashboard explains the new system without referring to removed concepts.

### Phase 6: Remove Legacy Code and Old Tests

Goal:

- Finish the break from the old product model.

Tasks:

- Delete legacy module definitions and related tests.
- Delete legacy default scenario assembly.
- Delete JSON scenario persistence logic that no longer applies.
- Rewrite tests to cover:
  - CSV loading
  - validation
  - checkpoint history
  - contribution capacity math
  - contribution clamping
  - transfers
  - net worth computation

Likely files:

- `src/lib/projection.test.ts`
- `src/lib/projection.runtime.test.ts`
- `src/lib/projection.validation.test.ts`
- `src/lib/projection.schema.test.ts`
- `src/lib/projection.selectors.test.ts`
- old scenario default files

Done when:

- There are no remaining product-critical references to modules, policies, or the old scenario shape.

## Recommended Session Order

Suggested implementation order across sessions:

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6

If time is tight, the best milestone cut points are:

- after Phase 2: CSV pack loads and validates
- after Phase 3: new engine works headlessly
- after Phase 4: app is usable end-to-end

## Guardrails During the Rewrite

- Do not add compatibility shims for the old module system.
- Do not preserve the old builder unless needed temporarily for bootstrapping tests.
- Do not hardcode a `cash` account.
- Do not reintroduce automatic tax modeling in v1.
- Do not let budget items directly mutate net worth accounts.

## First Implementation Target

The best next coding session should focus on Phase 1 and the start of Phase 2:

- define the new types
- define the CSV schemas
- add the repo-backed CSV loader scaffolding

That work will unblock every later phase without dragging old architecture forward.
