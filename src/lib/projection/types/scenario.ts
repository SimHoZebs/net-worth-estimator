export const SCENARIO_MODEL_VERSION = 8 as const;

export const CSV_SCENARIO_REPO_PATH = "public/scenario";
export const CSV_SCENARIO_PUBLIC_PATH = "/scenario";

export const CSV_SCENARIO_FILE_NAMES = {
  accounts: "accounts.csv",
  checkpoints: "checkpoints.csv",
  postings: "postings.csv",
} as const;

export type ScenarioCollectionKey = keyof typeof CSV_SCENARIO_FILE_NAMES;
export type ScenarioFileName = (typeof CSV_SCENARIO_FILE_NAMES)[ScenarioCollectionKey];

export type IsoDate = string;
export type PostingOverrideMode = "amount" | "multiplier";

export interface ProjectionRuntimeSettings {
  targetNetWorth: number;
  fallbackProjectionStartDate: IsoDate;
  horizonYears: number;
}

export interface Account {
  id: string;
  label: string;
  category: string;
  annualRate: number;
  volatility: number;
  minBalance: number | null;
  maxBalance: number | null;
  color: string | null;
  enabled: boolean;
}

export interface Checkpoint {
  Date: IsoDate;
  AccountId: string;
  Balance: number;
}

export interface Posting {
  id: string;
  label: string;
  sourceAccountId: string | null;
  destinations: string[] | null;
  arithmetic: string;
  annualGrowthRate: number;
  startDate: IsoDate;
  endDate: IsoDate | null;
  annualCap: number | null;
  priority: number;
  enabled: boolean;
}

export interface ScenarioPack {
  version: typeof SCENARIO_MODEL_VERSION;
  sourcePath: string;
  accounts: Account[];
  checkpoints: Checkpoint[];
  postings: Posting[];
}

export interface ScenarioFileContents {
  accounts: string;
  checkpoints: string;
  postings: string;
}

export interface PostingWhatIfOverride {
  postingId: string;
  mode: PostingOverrideMode;
  value: number;
}

export interface ScenarioWhatIfState {
  postingOverrides: Record<string, PostingWhatIfOverride>;
}

export interface ProjectionRow {
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

export interface ProjectionAccountSummary {
  accountId: string;
  label: string;
  color: string | null;
  annualRate: number;
  enabled: boolean;
  startingBalance: number;
  endingBalance: number;
}

export interface ProjectionPostingSummary {
  postingId: string;
  label: string;
  sourceAccountId: string | null;
  sourceAccountLabel: string | null;
  destinations: Array<{ accountId: string; label: string }> | null;
  priority: number;
  annualCap: number | null;
  requestedAmount: number;
  realizedAmount: number;
  utilizationRate: number;
  firstShortfallDate: IsoDate | null;
  shortfallAmount: number;
}

export interface ProjectionResult {
  timeline: {
    rows: ProjectionRow[];
    sampledRows: ProjectionRow[];
  };
  accountSummaries: ProjectionAccountSummary[];
  postingSummaries: ProjectionPostingSummary[];
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