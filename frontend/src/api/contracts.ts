export type IsoDate = string;
export type IsoDateTime = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
	[key: string]: JsonValue;
}
export type JsonRecord = Record<string, JsonValue>;

export interface HumaLink {
	href: string;
	[key: string]: JsonValue | undefined;
}
export type HumaLinks =
	| HumaLink[]
	| Record<string, HumaLink | HumaLink[] | undefined>;

export interface HumaMetadata {
	$schema?: string;
	links?: HumaLinks;
	_links?: HumaLinks;
}

export interface ProblemDetails extends HumaMetadata {
	type?: string;
	code?: string;
	title?: string;
	status?: number;
	detail?: string;
	instance?: string;
	[key: string]: unknown;
}

export type IsoDateOrNull = IsoDate | null;
export type OptionalString = string | null;

export const NO_FLOOR_SENTINEL = -10_000_000_000_000;
export const NO_CEILING_SENTINEL = 10_000_000_000_000;

export type AccountKind = "cash" | "investment" | "debt" | "property";

export interface BackendAccount extends HumaMetadata {
	id: string;
	name: string;
	kind: AccountKind;
	minBalance: number | null;
	maxBalance: number | null;
	color: string | null;
	enabled: boolean;
}
export type Account = BackendAccount;

export interface BackendCheckpoint extends HumaMetadata {
	Date: IsoDate;
	AccountId: string;
	Balance: number;
	source?: string;
}
export type Checkpoint = BackendCheckpoint;

export interface AmountInputBinding extends HumaMetadata {
	source: string;
	value?: JsonValue;
	provider?: string;
	arguments?: JsonObject;
}

export interface ExpressionAmountConfig extends JsonObject {
	expression: string;
}

export interface ExpressionPostingAmountResolution extends HumaMetadata {
	resolver: "expression";
	config: ExpressionAmountConfig;
	inputs?: Record<string, AmountInputBinding> | null;
}

export interface OtherPostingAmountResolution extends HumaMetadata {
	resolver: string;
	config: JsonValue;
	inputs?: Record<string, AmountInputBinding> | null;
}

export type PostingAmountResolution =
	| ExpressionPostingAmountResolution
	| OtherPostingAmountResolution;
export type AmountResolution = PostingAmountResolution;

export interface AmountFieldSpec extends HumaMetadata {
	key: string;
	kind: string;
	required: boolean;
}

export interface AmountResolverSpec extends HumaMetadata {
	name: string;
	description?: string;
	configFields?: AmountFieldSpec[];
}

export interface AmountProviderSpec extends HumaMetadata {
	name: string;
	description?: string;
	volatile?: boolean;
	argFields?: AmountFieldSpec[];
}

export interface AmountTemplate extends HumaMetadata {
	id: string;
	label: string;
	summary?: string;
	resolver?: string;
	whenToUse?: string;
	amount?: PostingAmountResolution;
}

export interface AmountPreset extends HumaMetadata {
	id: string;
	name: string;
	label: string;
	summary?: string | null;
	whenUse?: string | null;
	amount: PostingAmountResolution;
	enabled: boolean;
}

export interface AmountPresetListResponse extends HumaMetadata {
	presets: AmountPreset[];
}

export interface AmountPresetWriteResponse extends HumaMetadata {
	row: AmountPreset;
	issues: ModelValidationIssue[];
	persisted: boolean;
}

export interface AmountPresetDeleteResponse extends HumaMetadata {
	deletedId: string;
}

export interface AmountPresetMoveResponse extends HumaMetadata {
	movedId: string;
}

export interface AmountCatalogResponse extends HumaMetadata {
	resolvers: AmountResolverSpec[];
	providers: AmountProviderSpec[];
}

export type RecurrenceFrequency =
	| "daily"
	| "weekly"
	| "monthly"
	| "quarterly"
	| "annual";

/**
 * Standalone planned-purchase row, separated from postings. Lower priority
 * executes first; document order breaks ties. EarliestDate is the earliest
 * buy day; cost is the fixed positive cost. Mirrors the backend
 * `PlannedPurchase` row. Legacy documents carry purchases as postings with
 * a `purchase` marker instead; the adapter reads both and always writes the
 * legacy posting shape until the backend ships row endpoints (see rowSync).
 */
export interface BackendPlannedPurchase extends HumaMetadata {
	id: string;
	name: string;
	fundingAccountId: string | null;
	cost: number;
	earliestDate: IsoDate;
	enabled: boolean;
	priority: number;
}

export interface PostingClaim extends HumaMetadata {
	ruleId: string;
	occurrenceDate: IsoDate;
}

export interface BackendPosting extends HumaMetadata {
	id: string;
	name: string;
	sourceAccountId: string | null;
	destinations: string[] | null;
	amount: PostingAmountResolution;
	postedTime: number;
	transactionTime: number;
	claim?: PostingClaim | null;
	purchase?: { priority: number } | null;
	executionOrder?: number;
	enabled: boolean;
	source?: string;
	pending?: boolean;
	void?: boolean;
}
export type Posting = BackendPosting;

export interface BackendRecurrenceRule extends HumaMetadata {
	id: string;
	name: string;
	sourceAccountId: string | null;
	destinations: string[] | null;
	amount: PostingAmountResolution;
	frequency: RecurrenceFrequency;
	startDate: IsoDate;
	endDate: IsoDate | null;
	annualCap: number | null;
	priority: number;
	enabled: boolean;
}
export type RecurrenceRule = BackendRecurrenceRule;

export type EvaluationConfig = JsonValue;
export type EvaluationResultPayload = JsonValue;
export type Link = HumaLink;
export type Links = HumaLinks;

export interface EvaluationInstance<
	TConfig extends EvaluationConfig = EvaluationConfig,
> extends HumaMetadata {
	instanceId: string;
	name: string;
	enabled: boolean;
	config: TConfig;
}

export type FinancialIndependenceConfig = EvaluationConfig;
export type NetWorthThresholdConfig = EvaluationConfig;
export type AccountBalanceConfig = EvaluationConfig;
export type PostingFulfillmentConfig = EvaluationConfig;
export type CycleFulfillmentConfig = EvaluationConfig;
export type FinancialIndependenceEvaluation =
	EvaluationInstance<FinancialIndependenceConfig>;
export type NetWorthThresholdEvaluation =
	EvaluationInstance<NetWorthThresholdConfig>;
export type AccountBalanceEvaluation = EvaluationInstance<AccountBalanceConfig>;
export type PostingFulfillmentEvaluation =
	EvaluationInstance<PostingFulfillmentConfig>;
export type CycleFulfillmentEvaluation =
	EvaluationInstance<CycleFulfillmentConfig>;

export interface EvaluationTables extends HumaMetadata {
	financialIndependence: FinancialIndependenceEvaluation[];
	netWorthThreshold: NetWorthThresholdEvaluation[];
	accountBalance: AccountBalanceEvaluation[];
	postingFulfillment: PostingFulfillmentEvaluation[];
	cycleFulfillment?: CycleFulfillmentEvaluation[];
	plannedPurchases?: EvaluationInstance[];
}

export interface FinancialModelDocument extends HumaMetadata {
	sourcePath: string;
	accounts: BackendAccount[];
	checkpoints: BackendCheckpoint[];
	evaluations: EvaluationTables;
	postings: BackendPosting[];
	recurrenceRules: BackendRecurrenceRule[];
	plannedPurchases?: BackendPlannedPurchase[];
}

export interface ModelOverrides extends HumaMetadata {
	addedAccounts: BackendAccount[];
	addedPostings: BackendPosting[];
	addedRules: BackendRecurrenceRule[];
	disabledAccountIds: string[];
	disabledPostingIds: string[];
	disabledRuleIds: string[];
}

export interface ProjectionRuntimeSettings extends HumaMetadata {
	fallbackProjectionStartDate: IsoDate;
	horizonYears: number;
	evaluations: EvaluationTables;
}

export interface ModelValidationIssue extends HumaMetadata {
	severity: "error" | "warning" | string;
	code: string;
	message: string;
	path: JsonValue[];
}

export interface AccountDelta {
	postingId: string;
	delta: number;
}

export interface CheckpointCorrection {
	accountId: string;
	observedBalance: number;
	modeledBalance: number;
	adjustment: number;
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
	checkpointCorrections: CheckpointCorrection[];
}

export interface ProjectionAccountSummary {
	accountId: string;
	name: string;
	color: string | null;
	enabled: boolean;
	startingBalance: number;
	endingBalance: number;
}

export interface MovementOrigin {
	type: string;
	postingId: string;
}

export interface MovementAccountDelta {
	accountId: string;
	delta: number;
}

export interface MovementFulfillment {
	unfulfilledAmount: number;
	destinationLimitedAmount: number;
}

export interface MovementEvent {
	date: IsoDate;
	sequence: number;
	origin: MovementOrigin;
	requestedAmount: number;
	realizedAmount: number;
	accountDeltas: MovementAccountDelta[] | null;
	bindingConstraints?: JsonValue[];
	availableAmount?: number;
	fulfillment?: MovementFulfillment;
}

export interface ProjectionTimeline {
	rows: ProjectionRow[];
}

export interface ProjectionTotals {
	externalInflowAmount: number;
	externalOutflowAmount: number;
	internalTransferAmount: number;
}

export interface ProjectionMilestones {
	latestHistoricalDate: IsoDate | null;
	projectionStartDate: IsoDate;
}

export interface ProjectionSummary {
	currentNetWorth: number;
	finalNetWorth: number;
}

export type EvaluationResultStatus =
	| "satisfied"
	| "not-satisfied"
	| "warning"
	| "indeterminate"
	| string;

export interface EvaluationDiagnostic {
	code: string;
	severity: string;
	message: string;
	date?: IsoDate;
	relatedAccountIds?: string[];
	relatedPostingIds?: string[];
}

export interface EvaluationResultEnvelope extends HumaMetadata {
	instanceId: string;
	name: string;
	status: EvaluationResultStatus;
	deterministic: EvaluationResultPayload;
	probabilistic: EvaluationResultPayload;
	diagnostics: EvaluationDiagnostic[];
}

export interface EvaluationResultTables extends HumaMetadata {
	financialIndependence: EvaluationResultEnvelope[];
	netWorthThreshold: EvaluationResultEnvelope[];
	accountBalance: EvaluationResultEnvelope[];
	postingFulfillment: EvaluationResultEnvelope[];
	cycleFulfillment?: EvaluationResultEnvelope[];
	plannedPurchases?: EvaluationResultEnvelope[];
}

export interface ProjectionResult extends HumaMetadata {
	timeline: ProjectionTimeline;
	accountSummaries: ProjectionAccountSummary[];
	totals: ProjectionTotals;
	milestones: ProjectionMilestones;
	summary: ProjectionSummary;
	evaluations: EvaluationResultTables;
	movementEvents?: MovementEvent[];
}

export interface DeterministicProjectionRequest extends HumaMetadata {
	document?: FinancialModelDocument | null;
	overrides?: ModelOverrides;
	settings: ProjectionRuntimeSettings;
	// Closed timeline slice to return. Either bound may be omitted for an
	// open end. The server requires it: callers always state the range.
	range?: {
		startDate?: string;
		endDate?: string;
	};
}

export interface DeterministicProjectionResponse extends HumaMetadata {
	result?: ProjectionResult | null;
	issues?: ModelValidationIssue[];
	error?: string;
}

export type ProjectionRequest = DeterministicProjectionRequest;
export type ProjectionRequestBody = DeterministicProjectionRequest;
export type ProjectionResponse = DeterministicProjectionResponse;

export interface PercentileBands {
	p10: number;
	p25: number;
	p50: number;
	p75: number;
	p90: number;
}

export interface StochasticConfig {
	runCount: number;
	seed: number | null;
}

export interface StochasticBandRow {
	date: IsoDate;
	isHistorical: boolean;
	netWorth: PercentileBands;
}

export type StochasticProgressPhase =
	| "preparing"
	| "deterministic-evaluations"
	| "stochastic-runs"
	| string;

export interface StochasticEvaluationWorkload {
	type: string;
	instanceId: string;
	name: string;
	completedUnits: number;
	totalUnits: number;
	unitLabel: string;
	unitAction: string;
	intensiveUnitsCompleted?: number;
	intensiveUnitLabel?: string;
	intensiveUnitAction?: string;
	description?: string;
}

export interface StochasticProgress {
	phase: StochasticProgressPhase;
	completedRuns: number;
	totalRuns: number;
	fraction: number;
	evaluationWorkloads: StochasticEvaluationWorkload[];
}

export interface StochasticProjectionResult extends HumaMetadata {
	config: StochasticConfig;
	bands: StochasticBandRow[];
	milestones: {
		finalNetWorthPercentiles: PercentileBands;
	};
	evaluations: EvaluationResultTables;
}

export interface StochasticProjectionRequest extends DeterministicProjectionRequest {
	config: StochasticConfig;
}

export interface StochasticProjectionResponse extends HumaMetadata {
	result?: StochasticProjectionResult | null;
	issues?: ModelValidationIssue[];
	error?: string;
}

export type StochasticRequest = StochasticProjectionRequest;
export type StochasticRequestBody = StochasticProjectionRequest;
export type StochasticResponse = StochasticProjectionResponse;

export interface ServerStatus extends HumaMetadata {
	readOnly: boolean;
	/** Whether the server has a sync runner. Absent from older backends. */
	syncConfigured?: boolean;
	/** Bridge host for display. Omitted when unconfigured. Never the secret. */
	syncHost?: string;
	/** Last successful sync completion (RFC3339 UTC). Omitted before the first sync. */
	lastSyncAt?: string;
	/** Bridge hits in the trailing 24 hours. Absent from older backends. */
	syncQuotaUsed?: number;
	/** Bridge daily allowance. Absent from older backends. */
	syncQuotaLimit?: number;
}

export interface SyncCredentialStatus extends HumaMetadata {
	configured: boolean;
	bridgeHost?: string;
	updatedAt?: string;
}

export interface SyncCredentialConnectRequest extends HumaMetadata {
	setupToken?: string;
	accessUrl?: string;
}

export interface SyncCardsResponse extends HumaMetadata {
	cards: string[];
}

export interface SyncCardsRequest extends HumaMetadata {
	cards: string[];
}

export type StatusResponse = ServerStatus;

export interface FinancialModelResponse extends HumaMetadata {
	document: FinancialModelDocument | null;
	issues: ModelValidationIssue[];
	revision?: string;
	/** Stored reverse lookup: posting ID to its receipt IDs. */
	receiptLinks?: Record<string, string[]>;
}

export type ModelResponse = FinancialModelResponse;

export interface RowWriteResponse<TRow> extends HumaMetadata {
	row: TRow;
	issues: ModelValidationIssue[];
	persisted: boolean;
	revision: string;
}

export interface RowDeleteResponse extends HumaMetadata {
	revision: string;
}

export interface PinnedEvaluationsResponse extends HumaMetadata {
	instanceIds: string[];
}

export interface PinnedEvaluationsRequest extends HumaMetadata {
	instanceIds: string[];
}

export interface ProgressSSEData {
	progress: StochasticProgress;
}

export interface PartialSSEData {
	progress: StochasticProgress;
	partial: StochasticProjectionResult;
}

export interface ResultSSEData {
	result: StochasticProjectionResult;
}

export interface ErrorSSEData {
	error: string;
}

export type StochasticSSEData =
	| ProgressSSEData
	| PartialSSEData
	| ResultSSEData
	| ErrorSSEData;
export interface SafeSpendingSettings {
	statementDay: number;
	reserve: number;
	/** Null uses the default card selection. */
	accountIds: string[] | null;
	/** Null uses the detected checking account. */
	spendingAccountIds: string[] | null;
	/** Null uses the detected checking account. */
	incomeAccountIds: string[] | null;
	/** Explicit recurrence rule sources. Empty means no automatic income. */
	incomeRuleIds: string[];
	/** Null includes all recurring outflows. */
	movementIds: string[] | null;
	/** Explicitly chosen day, including the legacy first-of-month case. */
	statementDaySet: boolean;
}

export interface SafeSpendingSettingsResponse {
	settings: SafeSpendingSettings | null;
}
