export const SCENARIO_MODEL_VERSION = 8 as const;

export const CSV_SCENARIO_REPO_PATH = "public/scenario";
export const CSV_SCENARIO_PUBLIC_PATH = "/scenario";

export const CSV_SCENARIO_FILE_NAMES = {
	accounts: "accounts.csv",
	checkpoints: "checkpoints.csv",
	postings: "postings.csv",
} as const;

export type ScenarioCollectionKey = keyof typeof CSV_SCENARIO_FILE_NAMES;
export type ScenarioFileName =
	(typeof CSV_SCENARIO_FILE_NAMES)[ScenarioCollectionKey];

export type IsoDate = string;

export interface ProjectionRuntimeSettings {
	targetNetWorth: number;
	fallbackProjectionStartDate: IsoDate;
	horizonYears: number;
}

export interface Account {
	id: string;
	label: string;
	minBalance: number;
	maxBalance: number;
	color: string | null;
	enabled: boolean;
}

export type PostingFrequency =
	| "daily"
	| "weekly"
	| "monthly"
	| "quarterly"
	| "annual";

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
	frequency: PostingFrequency;
	annualRate: number;
	annualGrowthRate: number;
	volatility: number;
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

export interface ScenarioWhatIfState {
	addedAccounts: Account[];
	addedPostings: Posting[];
	addedCheckpoints: Checkpoint[];
	disabledAccountIds: string[];
	disabledPostingIds: string[];
}

export interface AccountDelta {
	postingId: string;
	delta: number;
}

export interface AccountSnapshot {
	accountId: string;
	date: IsoDate;
	balance: number;
	impacts: AccountDelta[];
}

export interface ProjectionRow {
	date: IsoDate;
	isHistorical: boolean;
	netWorth: number;
	accountSnapshots: AccountSnapshot[];
	externalInflowAmount: number;
	externalOutflowAmount: number;
	internalTransferAmount: number;
	requestedPostingAmount: number;
	realizedPostingAmount: number;
	clampedPostingShortfallAmount: number;
	requestedPostingAmountsById: Record<string, number>;
	realizedPostingAmountsById: Record<string, number>;
}

export interface ProjectionAccountSummary {
	accountId: string;
	label: string;
	color: string | null;
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
