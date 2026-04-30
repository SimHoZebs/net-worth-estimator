export const CSV_SCENARIO_MODEL_VERSION = 3 as const;

export const CSV_SCENARIO_REPO_PATH = "public/scenario";
export const CSV_SCENARIO_PUBLIC_PATH = "/scenario";

export const CSV_SCENARIO_FILE_NAMES = {
  scenario: "scenario.csv",
  accounts: "accounts.csv",
  checkpoints: "checkpoints.csv",
  budgetItems: "budget_items.csv",
  contributionPlans: "contribution_plans.csv",
  transfers: "transfers.csv",
} as const;

export type CsvScenarioCollectionKey = keyof typeof CSV_SCENARIO_FILE_NAMES;
export type CsvScenarioFileName = (typeof CSV_SCENARIO_FILE_NAMES)[CsvScenarioCollectionKey];

export type MonthLabel = string;
export type AccountBalanceType = "asset" | "liability";
export type BudgetDirection = "in" | "out";
export type BudgetAmountMode = "fixed" | "percent_of_parent";
export type ContributionCalculationMode = "fixed" | "percent_of_capacity" | "percent_of_budget_item";
export type TransferAmountMode = "fixed";
export type ContributionPlanOverrideMode = "amount" | "multiplier";

export interface CsvScenarioSettings {
  name: string;
  startDate: MonthLabel;
  horizonMonths: number;
  targetNetWorth: number;
}

export interface CsvAccount {
  id: string;
  label: string;
  balanceType: AccountBalanceType;
  category: string;
  openingBalance: number;
  annualRate: number;
  color: string | null;
  enabled: boolean;
}

export interface CsvCheckpoint {
  Date: string;
  AccountId: string;
  Balance: number;
}

export interface CsvBudgetItem {
  id: string;
  label: string;
  direction: BudgetDirection;
  parentBudgetItemId: string | null;
  amountMode: BudgetAmountMode;
  amount: number;
  annualGrowthRate: number;
  startMonth: MonthLabel;
  endMonth: MonthLabel | null;
  frequencyMonths: number;
  category: string;
  enabled: boolean;
}

export interface CsvContributionPlan {
  id: string;
  label: string;
  targetAccountId: string;
  calculationMode: ContributionCalculationMode;
  baseBudgetItemId: string | null;
  amount: number;
  startMonth: MonthLabel;
  endMonth: MonthLabel | null;
  frequencyMonths: number;
  annualCap: number | null;
  priority: number;
  enabled: boolean;
}

export interface CsvTransfer {
  id: string;
  label: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountMode: TransferAmountMode;
  amount: number;
  startMonth: MonthLabel;
  endMonth: MonthLabel | null;
  frequencyMonths: number;
  enabled: boolean;
}

export interface CsvScenarioPack {
  version: typeof CSV_SCENARIO_MODEL_VERSION;
  sourcePath: string;
  scenario: CsvScenarioSettings;
  accounts: CsvAccount[];
  checkpoints: CsvCheckpoint[];
  budgetItems: CsvBudgetItem[];
  contributionPlans: CsvContributionPlan[];
  transfers: CsvTransfer[];
}

export interface CsvScenarioFileContents {
  scenario: string;
  accounts: string;
  checkpoints: string;
  budgetItems: string;
  contributionPlans: string;
  transfers: string;
}

export interface ContributionPlanWhatIfOverride {
  contributionPlanId: string;
  mode: ContributionPlanOverrideMode;
  value: number;
}

export interface CsvScenarioWhatIfState {
  contributionPlanOverrides: Record<string, ContributionPlanWhatIfOverride>;
}

export interface CsvProjectionRow {
  monthIndex: number;
  monthLabel: MonthLabel;
  isHistorical: boolean;
  netWorth: number;
  accountBalances: Record<string, number>;
  investableCapacity: number;
  requestedContributionAmount: number;
  realizedContributionAmount: number;
  transferAmount: number;
  growthNetWorthImpact: number;
  requestedContributionAmountsByPlanId: Record<string, number>;
  realizedContributionAmountsByPlanId: Record<string, number>;
}

export interface CsvProjectionAccountSummary {
  accountId: string;
  label: string;
  balanceType: AccountBalanceType;
  color: string | null;
  annualRate: number;
  enabled: boolean;
  openingBalance: number;
  startingBalance: number;
  endingBalance: number;
  signedEndingBalance: number;
}

export interface CsvProjectionContributionSummary {
  contributionPlanId: string;
  label: string;
  targetAccountId: string;
  targetAccountLabel: string;
  priority: number;
  annualCap: number | null;
  requestedAmount: number;
  realizedAmount: number;
  utilizationRate: number;
}

export interface CsvProjectionResult {
  timeline: {
    monthlyRows: CsvProjectionRow[];
    sampledRows: CsvProjectionRow[];
  };
  accountSummaries: CsvProjectionAccountSummary[];
  contributionSummaries: CsvProjectionContributionSummary[];
  totals: {
    requestedContributions: number;
    realizedContributions: number;
    transferAmount: number;
    growthNetWorthImpact: number;
    averageProjectedInvestableCapacity: number;
    latestProjectedInvestableCapacity: number;
  };
  milestones: {
    hitTargetMonthIndex: number | null;
    hitTargetMonthLabel: MonthLabel | null;
    latestCheckpointDate: string | null;
    latestCheckpointMonthLabel: MonthLabel | null;
    latestHistoricalMonthLabel: MonthLabel | null;
  };
  summary: {
    currentNetWorth: number;
    finalNetWorth: number;
  };
}
