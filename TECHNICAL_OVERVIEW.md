# Technical Overview: Net Worth Estimator

The Net Worth Estimator is a single-page React application that projects net worth from a simplified CSV-backed scenario model.

## 1. Tech Stack

*   **Core/Framework:** React 19, Vite, TypeScript
*   **Styling:** Tailwind CSS v4
*   **Visualization:** Recharts
*   **Testing:** Vitest
*   **CSV Parsing:** Papa Parse
*   **Validation:** Zod

## 2. High-Level Architecture & Data Flow

The application loads canonical CSV files from the repo, validates them, projects balances in a worker, and renders a read-only inspector plus dashboard. Temporary what-if overrides exist only in browser memory for the current session.

```mermaid
graph TD
    subgraph Source of Truth
        CSV[public/scenario/*.csv]
    end

    subgraph App Layer
        Load[CSV Loader]
        Val[CSV Validation]
        WhatIf[Session What-If State]
        UI[Inspector / Controls]
        Dash[Dashboard / Charts]
    end

    subgraph Projection Engine
        Worker[Projection Worker]
        Proj[[CSV Projection Result]]
    end

    CSV --> Load
    Load --> Val
    Val --> UI
    Val -->|Valid pack| Worker
    WhatIf --> Worker
    Worker --> Proj
    Proj --> Dash
```

### Data Flow Execution:
1.  **Load:** `useCsvScenarioPack.ts` fetches the CSV files from `public/scenario/`.
2.  **Validate:** Zod-based parsing plus reference validation rejects invalid packs before projection.
3.  **Temporary Overrides:** `useCsvWhatIfState.ts` stores session-only contribution overrides such as multipliers.
4.  **Project:** `csvProjectionWorker.ts` runs the projection engine off the main thread.
5.  **Render:** The inspector and dashboard render the validated pack and projected results.

## 3. Core Concepts & Domain Hierarchy

The product now uses six CSV-backed concepts.

```mermaid
classDiagram
    class CsvScenarioSettings {
        +number horizonMonths
        +number targetNetWorth
        +string startDate
    }

    class CsvAccount {
        +string balanceType : "asset" | "liability"
        +number openingBalance
        +number annualRate
    }

    class CsvCheckpoint {
        +string Date
        +string AccountId
        +number Balance
    }

    class CsvBudgetItem {
        +string direction : "in" | "out"
        +string amountMode : "fixed" | "percent_of_parent"
        +number amount
    }

    class CsvContributionPlan {
        +string calculationMode
        +number amount
        +number annualCap
        +number priority
    }

    class CsvTransfer {
        +string sourceAccountId
        +string destinationAccountId
        +number amount
    }
```

### Key Domain Entities:

*   **`scenario.csv`:** One-row global settings for start month, horizon, and target net worth.
*   **Accounts:** Tracked balances that contribute to net worth.
*   **Checkpoints:** Historical truth for account balances.
*   **Budget Items:** Income and spending assumptions used only to compute investable capacity.
*   **Contribution Plans:** Future balance-changing contributions into tracked accounts.
*   **Transfers:** Optional account-to-account moves.

## 4. UI Structure and Components

The React interface is now a read-only inspector plus temporary what-if controls.

```mermaid
graph TD
    App[App.tsx]
    App --> Pack[useCsvScenarioPack]
    App --> WhatIf[useCsvWhatIfState]
    App --> Worker[useCsvProjectionWorker]
    App --> Inspector[CsvScenarioInspector]
    App --> Controls[CsvContributionWhatIfControls]
    App --> Dash[CsvProjectionDashboard]
```

*   **`App.tsx`:** Orchestrates pack loading, validation, overrides, and worker-based projection.
*   **`CsvScenarioInspector.tsx`:** Shows read-only CSV-backed data tables plus validation issues.
*   **`CsvContributionWhatIfControls.tsx`:** Lets the user apply temporary multiplier overrides to contribution plans.
*   **`CsvProjectionDashboard.tsx`:** Renders current and projected net worth, account balances, and contribution utilization.

## 5. Technical Highlights
*   **Repo-Backed Source of Truth:** The canonical scenario is plain CSV in the repo, so edits can happen without launching the app.
*   **Read-Only Persistent UI:** The app does not write scenario data back into browser storage.
*   **Worker-Based Projection:** The projection engine runs off the main thread.
*   **Strict Separation of Capacity vs. Balances:** `budget_items` affect contribution capacity, while `contribution_plans`, `transfers`, and `annualRate` values affect balances.
