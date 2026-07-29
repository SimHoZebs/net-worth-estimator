export const CSV_MODEL_REPO_PATH = "public/configs";
export const CSV_MODEL_PUBLIC_PATH = "/configs";

export const CSV_MODEL_FILE_NAMES = {
	accounts: "accounts.csv",
	postings: "postings.csv",
} as const;

export const CSV_BEHAVIOR_FILE_NAMES = {
	financialIndependence: "behavior/financial-independence.csv",
	netWorthThreshold: "behavior/net-worth-threshold.csv",
	postingFulfillment: "behavior/posting-fulfillment.csv",
} as const;

export const EVALUATION_TYPE_ORDER = [
	"financialIndependence",
	"netWorthThreshold",
	"postingFulfillment",
] as const;

export type ModelCollectionKey = keyof typeof CSV_MODEL_FILE_NAMES;
export type BehaviorCollectionKey = keyof typeof CSV_BEHAVIOR_FILE_NAMES;
export type EvaluationType = (typeof EVALUATION_TYPE_ORDER)[number];
export type ModelFileName =
	| (typeof CSV_MODEL_FILE_NAMES)[ModelCollectionKey]
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

export interface NetWorthThresholdConfig {
	target: number;
}

export interface PostingFulfillmentConfig {
	postingIds: string[] | null;
}

export interface EvaluationInstance<TConfig> {
	instanceId: string;
	label: string;
	enabled: boolean;
	config: TConfig;
}

export type FinancialIndependenceEvaluation =
	EvaluationInstance<FinancialIndependencePlan>;
export type NetWorthThresholdEvaluation =
	EvaluationInstance<NetWorthThresholdConfig>;
export type PostingFulfillmentEvaluation =
	EvaluationInstance<PostingFulfillmentConfig>;

export interface EvaluationTables {
	financialIndependence: FinancialIndependenceEvaluation[];
	netWorthThreshold: NetWorthThresholdEvaluation[];
	postingFulfillment: PostingFulfillmentEvaluation[];
}

export type EvaluationForType<TType extends EvaluationType> =
	EvaluationTables[TType][number];

export interface ProjectionRuntimeSettings {
	fallbackProjectionStartDate: IsoDate;
	horizonYears: number;
	evaluations: EvaluationTables;
}

export type EvaluationResultStatus =
	| "satisfied"
	| "not-satisfied"
	| "warning"
	| "indeterminate";

export interface EvaluationDiagnostic {
	code: string;
	severity: "info" | "warning" | "error";
	message: string;
	date?: IsoDate;
	relatedAccountIds?: string[];
	relatedPostingIds?: string[];
}

export interface EvaluationResultEnvelope {
	instanceId: string;
	label: string;
	status: EvaluationResultStatus;
	deterministic: JsonValue | null;
	probabilistic: JsonValue | null;
	diagnostics: EvaluationDiagnostic[];
}

export interface EvaluationResultTables {
	financialIndependence: EvaluationResultEnvelope[];
	netWorthThreshold: EvaluationResultEnvelope[];
	postingFulfillment: EvaluationResultEnvelope[];
}

export interface EvaluationResultCollection {
	evaluations: EvaluationResultTables;
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
	| "once"
	| "daily"
	| "weekly"
	| "monthly"
	| "quarterly"
	| "annual";

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
	sourcePath: string;
	accounts: Account[];
	evaluations: EvaluationTables;
	postings: Posting[];
}

export interface ModelFileContents {
	accounts: string;
	behaviors: Record<BehaviorCollectionKey, string>;
	postings: string;
}

export interface ModelOverrides {
	addedAccounts: Account[];
	addedPostings: Posting[];
	disabledAccountIds: string[];
	disabledPostingIds: string[];
}

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
	assetContributions: FinancialIndependenceAssetContribution[];
	selectedAssetBalance: number;
	annualWithdrawalCapacity: number;
	totalAnnualCapacity: number;
	annualExpenseTarget: number;
	coverageRatio: number;
	isCovered: boolean;
	isEligible: boolean;
}

export interface FinancialIndependenceAssetContribution {
	accountId: string;
	balance: number;
	withdrawalRate: number;
	annualWithdrawalCapacity: number;
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
	effectiveDocument: FinancialModelDocument;
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
