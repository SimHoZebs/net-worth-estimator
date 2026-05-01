export const CSV_SCENARIO_MODEL_VERSION = 6 as const;

export const CSV_SCENARIO_REPO_PATH = "public/scenario";
export const CSV_SCENARIO_PUBLIC_PATH = "/scenario";

export const CSV_SCENARIO_FILE_NAMES = {
  accounts: "accounts.csv",
  checkpoints: "checkpoints.csv",
  postings: "postings.csv",
} as const;

export type CsvScenarioCollectionKey = keyof typeof CSV_SCENARIO_FILE_NAMES;
export type CsvScenarioFileName = (typeof CSV_SCENARIO_FILE_NAMES)[CsvScenarioCollectionKey];

export type IsoDate = string;
export type PostingAmountMode = "fixed" | "percent_of_base";
export type PostingOverrideMode = "amount" | "multiplier";

export interface ProjectionRuntimeSettings {
  targetNetWorth: number;
  fallbackProjectionStartDate: IsoDate;
  horizonYears: number;
}

export interface CsvAccount {
  id: string;
  label: string;
  category: string;
  openingBalance: number;
  annualRate: number;
  color: string | null;
  enabled: boolean;
}

export interface CsvCheckpoint {
  Date: IsoDate;
  AccountId: string;
  Balance: number;
}

export interface CsvPosting {
  id: string;
  label: string;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  amountMode: PostingAmountMode;
  basePostingId: string | null;
  amount: number;
  annualGrowthRate: number;
  startDate: IsoDate;
  endDate: IsoDate | null;
  annualCap: number | null;
  priority: number;
  enabled: boolean;
}

export interface CsvScenarioPack {
  version: typeof CSV_SCENARIO_MODEL_VERSION;
  sourcePath: string;
  accounts: CsvAccount[];
  checkpoints: CsvCheckpoint[];
  postings: CsvPosting[];
}

export interface CsvScenarioFileContents {
  accounts: string;
  checkpoints: string;
  postings: string;
}

export interface PostingWhatIfOverride {
  postingId: string;
  mode: PostingOverrideMode;
  value: number;
}

export interface CsvScenarioWhatIfState {
  postingOverrides: Record<string, PostingWhatIfOverride>;
}

export interface CsvProjectionRow {
  date: IsoDate;
  isHistorical: boolean;
  netWorth: number;
  accountBalances: Record<string, number>;
  externalInflowAmount: number;
  externalOutflowAmount: number;
  internalTransferAmount: number;
  requestedPostingAmount: number;
  realizedPostingAmount: number;
  clampedPostingShortfallAmount: number;
  growthNetWorthImpact: number;
  requestedPostingAmountsById: Record<string, number>;
  realizedPostingAmountsById: Record<string, number>;
}

export interface CsvProjectionAccountSummary {
  accountId: string;
  label: string;
  color: string | null;
  annualRate: number;
  enabled: boolean;
  openingBalance: number;
  startingBalance: number;
  endingBalance: number;
}

export interface CsvProjectionPostingSummary {
  postingId: string;
  label: string;
  sourceAccountId: string | null;
  sourceAccountLabel: string | null;
  destinationAccountId: string | null;
  destinationAccountLabel: string | null;
  priority: number;
  annualCap: number | null;
  requestedAmount: number;
  realizedAmount: number;
  utilizationRate: number;
}

export interface CsvProjectionResult {
  timeline: {
    rows: CsvProjectionRow[];
    sampledRows: CsvProjectionRow[];
  };
  accountSummaries: CsvProjectionAccountSummary[];
  postingSummaries: CsvProjectionPostingSummary[];
  totals: {
    externalInflowAmount: number;
    externalOutflowAmount: number;
    internalTransferAmount: number;
    requestedPostingAmount: number;
    realizedPostingAmount: number;
    clampedPostingShortfallAmount: number;
    growthNetWorthImpact: number;
  };
  milestones: {
    hitTargetDate: IsoDate | null;
    latestCheckpointDate: IsoDate | null;
    latestHistoricalDate: IsoDate | null;
    projectionStartDate: IsoDate;
  };
  summary: {
    currentNetWorth: number;
    finalNetWorth: number;
  };
}
