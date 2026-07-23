export const SCENARIO_MODEL_VERSION = 9 as const;

export const CSV_SCENARIO_REPO_PATH = "public/configs";
export const CSV_SCENARIO_PUBLIC_PATH = "/configs";

export const CSV_SCENARIO_FILE_NAMES = {
	accounts: "accounts.csv",
	checkpoints: "checkpoints.csv",
	postings: "postings.csv",
} as const;

export const CSV_BEHAVIOR_FILE_NAMES = {
	financialIndependence: "behavior/financial-independence.csv",
	netWorthThreshold: "behavior/net-worth-threshold.csv",
	postingFulfillment: "behavior/posting-fulfillment.csv",
} as const;

export const CSV_BEHAVIOR_DEFINITION_IDS = {
	financialIndependence: "financial-independence",
	netWorthThreshold: "net-worth-threshold",
	postingFulfillment: "posting-fulfillment",
} as const;

export type ScenarioCollectionKey = keyof typeof CSV_SCENARIO_FILE_NAMES;
export type BehaviorCollectionKey = keyof typeof CSV_BEHAVIOR_FILE_NAMES;
export type ScenarioFileName =
	| (typeof CSV_SCENARIO_FILE_NAMES)[ScenarioCollectionKey]
	| (typeof CSV_BEHAVIOR_FILE_NAMES)[BehaviorCollectionKey];

export type IsoDate = string;

export type AccountMovementConstraintType =
	| "source-unavailable"
	| "source-floor"
	| "destination-ceiling"
	| "action-limit";

export type AccountMovementConstraint =
	| {
			type: Extract<AccountMovementConstraintType, "source-unavailable">;
			accountId: string;
	  }
	| {
			type: Extract<AccountMovementConstraintType, "source-floor">;
			accountId: string;
	  }
	| {
			type: Extract<AccountMovementConstraintType, "destination-ceiling">;
			accountIds: string[];
	  }
	| { type: Extract<AccountMovementConstraintType, "action-limit"> };

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| { [key: string]: JsonValue };

export type FinancialIndependencePrincipalPolicy =
	| "allow-drawdown"
	| "preserve-nominal-principal"
	| "preserve-real-principal";

export type FinancialIndependenceSource =
	| {
			type: "cashflow";
			postingId: string;
			included: boolean;
			laborDependent?: boolean;
	  }
	| {
			type: "asset";
			accountId: string;
			included: boolean;
			withdrawalRateOverride?: number;
	  };

export interface FinancialIndependencePlan {
	minimumNetWorth: number;
	annualExpenseTarget: number;
	annualExpenseGrowthRate: number;
	withdrawalRate: number;
	evaluationYears: number;
	requiredConfidence: number;
	sources: FinancialIndependenceSource[];
	continuingPostingIds: string[];
	principalPolicy: FinancialIndependencePrincipalPolicy;
}

export interface ProjectionRuntimeSettings {
	fallbackProjectionStartDate: IsoDate;
	horizonYears: number;
	evaluations: ConfiguredEvaluation[];
}

export type EvaluationResultStatus =
	| "satisfied"
	| "not-satisfied"
	| "warning"
	| "indeterminate";

export interface ConfiguredEvaluation {
	definitionId: string;
	instanceId: string;
	label: string;
	enabled: boolean;
	config: JsonValue;
}

export interface EvaluationDiagnostic {
	code: string;
	severity: "info" | "warning" | "error";
	message: string;
	date?: IsoDate;
	relatedAccountIds?: string[];
	relatedPostingIds?: string[];
}

export interface EvaluationResultEnvelope {
	definitionId: string;
	instanceId: string;
	label: string;
	status: EvaluationResultStatus;
	deterministic: JsonValue | null;
	probabilistic: JsonValue | null;
	diagnostics: EvaluationDiagnostic[];
}

export interface EvaluationResultCollection {
	evaluationOrder: string[];
	evaluations: Record<string, EvaluationResultEnvelope>;
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

export interface FinancialModelDocument {
	version: typeof SCENARIO_MODEL_VERSION;
	sourcePath: string;
	accounts: Account[];
	checkpoints: Checkpoint[];
	evaluations: ConfiguredEvaluation[];
	postings: Posting[];
}

export type ScenarioPack = FinancialModelDocument;

export interface ScenarioFileContents {
	accounts: string;
	checkpoints: string;
	behaviors: Record<BehaviorCollectionKey, string>;
	postings: string;
}

export interface ScenarioOverrides {
	addedAccounts: Account[];
	addedPostings: Posting[];
	addedCheckpoints: Checkpoint[];
	disabledAccountIds: string[];
	disabledPostingIds: string[];
}

export type ScenarioWhatIfState = ScenarioOverrides;

export interface AccountDelta {
	postingId: string;
	delta: number;
}

export interface MovementEvent {
	date: IsoDate;
	sequence: number;
	origin: { type: "posting"; postingId: string };
	requestedAmount: number;
	realizedAmount: number;
	bindingConstraints: AccountMovementConstraint[];
	accountDeltas: Array<{ accountId: string; delta: number }>;
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
}

export interface ProjectionAccountSummary {
	accountId: string;
	label: string;
	color: string | null;
	enabled: boolean;
	startingBalance: number;
	endingBalance: number;
}

export interface FinancialIndependenceRow {
	date: IsoDate;
	netWorth: number;
	minimumNetWorth: number;
	minimumNetWorthMet: boolean;
	annualDirectIncome: number;
	selectedAssetBalance: number;
	annualWithdrawalCapacity: number;
	totalAnnualCapacity: number;
	annualExpenseTarget: number;
	coverageRatio: number;
	isCovered: boolean;
	isEligible: boolean;
}

export interface FinancialIndependenceRunOutcome {
	candidateDate: IsoDate;
	status: "ineligible" | "evaluated";
	minimumNetWorthMet: boolean;
	initialCoverageMet: boolean;
	expensesFullyCovered: boolean;
	hadWithdrawalShortfall: boolean;
	startingSelectedAssetBalance: number;
	endingSelectedAssetBalance: number;
	startingRealSelectedAssetBalance: number;
	endingRealSelectedAssetBalance: number;
	principalReplenished: boolean;
	cycleEstablished: boolean;
	withdrawals: FinancialIndependenceWithdrawalSummary;
}

export interface FinancialIndependenceWithdrawalAccountSummary {
	accountId: string;
	requestedAmount: number;
	realizedAmount: number;
	shortfallAmount: number;
	constraints: Array<{
		type: AccountMovementConstraintType;
		count: number;
	}>;
}

export interface FinancialIndependenceWithdrawalSummary {
	requestedAmount: number;
	realizedAmount: number;
	shortfallAmount: number;
	firstShortfallDate: IsoDate | null;
	lastShortfallDate: IsoDate | null;
	shortfallOccurrenceCount: number;
	constraints: Array<{
		type: AccountMovementConstraintType;
		count: number;
	}>;
	relatedAccountIds: string[];
	accounts: FinancialIndependenceWithdrawalAccountSummary[];
	firstShortfall: {
		date: IsoDate;
		requestedAmount: number;
		realizedAmount: number;
		shortfallAmount: number;
		constraints: AccountMovementConstraintType[];
		relatedAccountIds: string[];
	} | null;
}

export interface ProjectionPath {
	rows: ProjectionRow[];
	movementEvents: MovementEvent[];
	effectivePack: ScenarioPack;
	projectionStartDate: IsoDate;
	projectionEndDate: IsoDate;
}

export interface FinancialIndependenceAnalysis {
	rows: FinancialIndependenceRow[];
	runOutcomes: FinancialIndependenceRunOutcome[];
	milestones: {
		firstCoverageDate: IsoDate | null;
		firstSelfSustainingDate: IsoDate | null;
	};
}

export interface ProjectionCoreResult {
	timeline: {
		rows: ProjectionRow[];
		sampledRows: ProjectionRow[];
	};
	accountSummaries: ProjectionAccountSummary[];
	totals: {
		externalInflowAmount: number;
		externalOutflowAmount: number;
		internalTransferAmount: number;
	};
	milestones: {
		latestCheckpointDate: IsoDate | null;
		latestHistoricalDate: IsoDate | null;
		projectionStartDate: IsoDate;
	};
	summary: {
		currentNetWorth: number;
		finalNetWorth: number;
	};
}

export type ProjectionResult = ProjectionCoreResult &
	EvaluationResultCollection;

export interface RawProjectionOutput {
	path: ProjectionPath;
	result: ProjectionCoreResult;
}
