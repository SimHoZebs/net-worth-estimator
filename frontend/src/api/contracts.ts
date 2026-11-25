/**
 * Client view of the server payloads.
 *
 * Every server shape below is an alias over `./generated/model/...`, rebuilt
 * from the committed OpenAPI snapshot by `api:generate`. The narrowings keep
 * the shapes the UI already consumes: generated nullable arrays become
 * non-null where the UI treats absence as an empty list, generated `string`
 * enums become the client unions, and generated optional fields that the
 * hand-written client types declared required stay required here.
 *
 * Nullability decisions (applied at every call site through the adapters at
 * the bottom of this file):
 *
 * - A generated `null` array means "no rows of this kind". The client alias
 *   keeps the non-null array the UI expects and the adapter maps a client
 *   `undefined` optional array back to generated `null`, never to `[]`.
 * - A generated `null` scalar where the client used `null` too (account
 *   colors, funding account, balance bounds) is carried through unchanged.
 * - A client `null` for a generated optional scalar (recipe summary/whenUse)
 *   is sent as `undefined`: omitted means "not set", not an empty string.
 * - Generated `inputs` is required; a client that omits it means "no named
 *   inputs" and becomes `{}`. Position accounts are a display list, so a
 *   generated `null` there becomes `[]`.
 *
 * Values the server does not own (Huma metadata, sentinels, problem details)
 * remain declared here.
 */

import { isRecord } from "../domain/guards.ts";
import type {
	Account as GeneratedAccount,
	AccountDelta as GeneratedAccountDelta,
	AccountSnapshot as GeneratedAccountSnapshot,
	AmountFieldSpec as GeneratedAmountFieldSpec,
	AmountInputBinding as GeneratedAmountInputBinding,
	AmountPreset as GeneratedAmountPreset,
	Checkpoint as GeneratedCheckpoint,
	CurrentPosition as GeneratedCurrentPosition,
	DeterministicOutputBody as GeneratedDeterministicOutputBody,
	EvaluationDiagnostic as GeneratedEvaluationDiagnostic,
	EvaluationInstanceInterface as GeneratedEvaluationInstance,
	EvaluationResultEnvelope as GeneratedEvaluationResultEnvelope,
	EvaluationResultTables as GeneratedEvaluationResultTables,
	EvaluationTables as GeneratedEvaluationTables,
	FinancialModel as GeneratedFinancialModel,
	FinancialModelResponse as GeneratedFinancialModelResponse,
	Item1 as GeneratedTransactionAccountDelta,
	ModelOverrides as GeneratedModelOverrides,
	ModelValidationIssue as GeneratedModelValidationIssue,
	PaymentTerms as GeneratedPaymentTerms,
	PinnedEvaluationsInputBody as GeneratedPinnedEvaluationsInputBody,
	PinnedEvaluationsOutputBody as GeneratedPinnedEvaluationsOutputBody,
	PlannedPurchase as GeneratedPlannedPurchase,
	PositionRequestBody as GeneratedPositionRequestBody,
	ProjectionAccountSummary as GeneratedProjectionAccountSummary,
	ProjectionRequestBody as GeneratedProjectionRequestBody,
	ProjectionResult as GeneratedProjectionResult,
	ProjectionResultMilestonesStruct as GeneratedProjectionMilestones,
	ProjectionResultSummaryStruct as GeneratedProjectionSummary,
	ProjectionResultTimelineStruct as GeneratedProjectionTimeline,
	ProjectionResultTotalsStruct as GeneratedProjectionTotals,
	ProjectionRow as GeneratedProjectionRow,
	ProjectionRuntimeSettings as GeneratedProjectionRuntimeSettings,
	Recurrence as GeneratedRecurrence,
	SafeSpendingBody as GeneratedSafeSpendingBody,
	SafeSpendingOutputBody as GeneratedSafeSpendingOutputBody,
	SafeSpendingSettings as GeneratedSafeSpendingSettings,
	Schedule as GeneratedSchedule,
	StatusOutputBody as GeneratedStatusOutputBody,
	StochasticConfig as GeneratedStochasticConfig,
	SyncCredentialBody as GeneratedSyncCredentialBody,
	SyncCredentialInputBody as GeneratedSyncCredentialInputBody,
	SyncError as GeneratedSyncError,
	Transaction as GeneratedTransaction,
	TransactionAmountResolution as GeneratedTransactionAmountResolution,
	TransactionAmountResolutionConfig as GeneratedTransactionAmountResolutionConfig,
	TransactionAmountResolutionInputs as GeneratedTransactionAmountResolutionInputs,
	TransactionClaim as GeneratedTransactionClaim,
	TransactionEvent as GeneratedTransactionEvent,
	TransactionFulfillment as GeneratedTransactionFulfillment,
	TransactionOrigin as GeneratedTransactionOrigin,
} from "./generated/model/index.ts";

// Client-owned value types.

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

export const NO_FLOOR_SENTINEL = -10_000_000_000_000;
export const NO_CEILING_SENTINEL = 10_000_000_000_000;

// Server payloads, derived from the generated model.

export type AccountKind =
	| "cash"
	| "investment"
	| "credit_card"
	| "debt"
	| "property";

export type BackendAccount = Omit<GeneratedAccount, "kind" | "displayBasis"> & {
	kind: AccountKind;
	/** Owner-facing current-balance basis: available (default) or posted. */
	displayBasis?: "available" | "posted";
};
export type Account = BackendAccount;

export type BackendCheckpoint = GeneratedCheckpoint;
export type Checkpoint = BackendCheckpoint;

export type AmountInputBinding = Omit<
	GeneratedAmountInputBinding,
	"value" | "arguments"
> & {
	value?: JsonValue;
	arguments?: JsonObject;
};

export type ExpressionAmountConfig = JsonObject & { expression: string };

export type TransactionAmountResolution = Omit<
	GeneratedTransactionAmountResolution,
	"config" | "inputs"
> & {
	config: JsonValue;
	inputs?: Record<string, AmountInputBinding> | null;
};

export type ExpressionTransactionAmountResolution = Omit<
	TransactionAmountResolution,
	"config" | "resolver"
> & {
	resolver: "expression";
	config: ExpressionAmountConfig;
};

export type OtherTransactionAmountResolution = Omit<
	TransactionAmountResolution,
	"resolver"
> & {
	resolver: string;
};

export type AmountFieldSpec = GeneratedAmountFieldSpec;

export type AmountResolverSpec = Omit<
	import("./generated/model/index.ts").AmountResolverInfo,
	"description" | "configFields"
> & {
	description?: string;
	configFields?: AmountFieldSpec[];
};

export type AmountProviderSpec = Omit<
	import("./generated/model/index.ts").AmountProviderInfo,
	"description" | "argFields"
> & {
	description?: string;
	argFields?: AmountFieldSpec[];
};

/** Client-owned template copy; the server exposes wiring, not display words. */
export interface AmountTemplate {
	id: string;
	label: string;
	summary?: string;
	resolver?: string;
	whenToUse?: string;
	amount?: TransactionAmountResolution;
}

export type AmountPreset = Omit<
	GeneratedAmountPreset,
	"amount" | "summary" | "whenUse"
> & {
	amount: TransactionAmountResolution;
	summary?: string | null;
	whenUse?: string | null;
};

export type Frequency = "daily" | "weekly" | "monthly" | "quarterly" | "annual";

export type RecurrenceUnit = "day" | "week" | "month" | "year";

export type RecurrenceMonthlyMode = "byDate" | "byNthWeekday";

export type BackendRecurrence = Omit<
	GeneratedRecurrence,
	"unit" | "monthlyMode"
> & {
	unit: RecurrenceUnit;
	monthlyMode?: RecurrenceMonthlyMode | null;
};
export type Recurrence = BackendRecurrence;

export type BackendPlannedPurchase = Omit<
	GeneratedPlannedPurchase,
	"fundingAccountId"
> & {
	fundingAccountId: string | null;
};

export type TransactionClaim = GeneratedTransactionClaim;

export type BackendTransaction = Omit<
	GeneratedTransaction,
	"amount" | "claim"
> & {
	amount: TransactionAmountResolution;
	claim?: TransactionClaim | null;
};
export type Transaction = BackendTransaction;

export type BackendSchedule = Omit<
	GeneratedSchedule,
	"amount" | "recurrence"
> & {
	amount: TransactionAmountResolution;
	recurrence: BackendRecurrence;
};
export type Schedule = BackendSchedule;

export type EvaluationConfig = JsonValue;
export type EvaluationResultPayload = JsonValue;

export type FinancialIndependenceConfig = EvaluationConfig;
export type NetWorthThresholdConfig = EvaluationConfig;
export type AccountBalanceConfig = EvaluationConfig;
export type TransactionFulfillmentConfig = EvaluationConfig;
export type CycleFulfillmentConfig = EvaluationConfig;

export type EvaluationInstance<
	TConfig extends EvaluationConfig = EvaluationConfig,
> = Omit<GeneratedEvaluationInstance, "config"> & { config: TConfig };

export type AccountBalanceEvaluation = EvaluationInstance<AccountBalanceConfig>;
export type FinancialIndependenceEvaluation =
	EvaluationInstance<FinancialIndependenceConfig>;
export type NetWorthThresholdEvaluation =
	EvaluationInstance<NetWorthThresholdConfig>;
export type TransactionFulfillmentEvaluation =
	EvaluationInstance<TransactionFulfillmentConfig>;
export type CycleFulfillmentEvaluation =
	EvaluationInstance<CycleFulfillmentConfig>;

type EvaluationInstanceTables = {
	financialIndependence: EvaluationInstance[];
	netWorthThreshold: EvaluationInstance[];
	accountBalance: EvaluationInstance[];
	transactionFulfillment: EvaluationInstance[];
	cycleFulfillment?: EvaluationInstance[];
	plannedPurchases?: EvaluationInstance[];
	whatIf?: EvaluationInstance[];
};

export type EvaluationTables = Omit<
	GeneratedEvaluationTables,
	keyof EvaluationInstanceTables
> &
	EvaluationInstanceTables;

export type BackendPaymentTerms = GeneratedPaymentTerms;

export type FinancialModel = Omit<
	GeneratedFinancialModel,
	| "accounts"
	| "checkpoints"
	| "evaluations"
	| "paymentTerms"
	| "plannedPurchases"
	| "schedules"
	| "transactions"
> & {
	sourcePath: string;
	accounts: BackendAccount[];
	checkpoints: BackendCheckpoint[];
	evaluations: EvaluationTables;
	transactions: BackendTransaction[];
	schedules: BackendSchedule[];
	paymentTerms?: BackendPaymentTerms[];
	plannedPurchases?: BackendPlannedPurchase[];
};

export type ModelOverrides = Omit<
	GeneratedModelOverrides,
	| "addedAccounts"
	| "addedSchedules"
	| "addedTransactions"
	| "disabledAccountIds"
	| "disabledScheduleIds"
	| "disabledTransactionIds"
> & {
	addedAccounts: BackendAccount[];
	addedTransactions: BackendTransaction[];
	addedSchedules: BackendSchedule[];
	disabledAccountIds: string[];
	disabledTransactionIds: string[];
	disabledScheduleIds: string[];
};

export type ProjectionRuntimeSettings = Omit<
	GeneratedProjectionRuntimeSettings,
	"evaluations"
> & {
	evaluations: EvaluationTables;
};

export type ModelValidationIssue = Omit<
	GeneratedModelValidationIssue,
	"path"
> & {
	path: JsonValue[];
};

export type AccountDelta = GeneratedAccountDelta;

export type AccountSnapshot = Omit<GeneratedAccountSnapshot, "impacts"> & {
	impacts: AccountDelta[];
};

export type ProjectionRow = Omit<GeneratedProjectionRow, "accountSnapshots"> & {
	accountSnapshots: AccountSnapshot[];
};

export type ProjectionAccountSummary = GeneratedProjectionAccountSummary;
export type TransactionOrigin = GeneratedTransactionOrigin;
export type TransactionAccountDelta = GeneratedTransactionAccountDelta;
export type TransactionFulfillment = GeneratedTransactionFulfillment;

export type TransactionEvent = Omit<
	GeneratedTransactionEvent,
	"accountDeltas" | "bindingConstraints"
> & {
	accountDeltas: TransactionAccountDelta[] | null;
	bindingConstraints?: JsonValue[];
};

export type ProjectionTimeline = Omit<GeneratedProjectionTimeline, "rows"> & {
	rows: ProjectionRow[];
};
export type ProjectionTotals = GeneratedProjectionTotals;
export type ProjectionMilestones = GeneratedProjectionMilestones;
export type ProjectionSummary = GeneratedProjectionSummary;

export type EvaluationResultStatus =
	| "satisfied"
	| "not-satisfied"
	| "warning"
	| "indeterminate"
	| string;

export type EvaluationDiagnostic = Omit<
	GeneratedEvaluationDiagnostic,
	"relatedAccountIds" | "relatedTransactionIds"
> & {
	relatedAccountIds?: string[];
	relatedTransactionIds?: string[];
};

export type EvaluationResultEnvelope = Omit<
	GeneratedEvaluationResultEnvelope,
	"deterministic" | "probabilistic" | "status" | "diagnostics"
> & {
	status: EvaluationResultStatus;
	deterministic: EvaluationResultPayload;
	probabilistic: EvaluationResultPayload;
	diagnostics: EvaluationDiagnostic[];
};

type ResultEnvelopeTables = {
	financialIndependence: EvaluationResultEnvelope[];
	netWorthThreshold: EvaluationResultEnvelope[];
	accountBalance: EvaluationResultEnvelope[];
	transactionFulfillment: EvaluationResultEnvelope[];
	cycleFulfillment?: EvaluationResultEnvelope[];
	plannedPurchases?: EvaluationResultEnvelope[];
	whatIf?: EvaluationResultEnvelope[];
};

export type EvaluationResultTables = Omit<
	GeneratedEvaluationResultTables,
	keyof ResultEnvelopeTables
> &
	ResultEnvelopeTables;

export type ProjectionResult = Omit<
	GeneratedProjectionResult,
	"timeline" | "accountSummaries" | "evaluations" | "transactionEvents"
> & {
	timeline: ProjectionTimeline;
	accountSummaries: ProjectionAccountSummary[];
	totals: ProjectionTotals;
	milestones: ProjectionMilestones;
	summary: ProjectionSummary;
	evaluations: EvaluationResultTables;
	transactionEvents?: TransactionEvent[];
};

/** The client request is a generated projection body with an optional range
 * and a nullable model, matching the local draft/override call sites. */
export type DeterministicProjectionRequest = Omit<
	GeneratedProjectionRequestBody,
	"model" | "overrides" | "settings" | "range"
> & {
	model?: FinancialModel | null;
	overrides?: ModelOverrides;
	settings: ProjectionRuntimeSettings;
	range?: { startDate?: string; endDate?: string };
};

export type DeterministicProjectionResponse = GeneratedDeterministicOutputBody;

export type ProjectionRequest = DeterministicProjectionRequest;
export type ProjectionRequestBody = DeterministicProjectionRequest;
export type ProjectionResponse = DeterministicProjectionResponse;

// SSE payloads and stochastic inputs are client-owned: the stream is untyped
// text and the generated client only declares the request and the base config.

export interface PercentileBands {
	p10: number;
	p25: number;
	p50: number;
	p75: number;
	p90: number;
}

export type StochasticConfig = GeneratedStochasticConfig;

export interface StochasticBandRow {
	date: IsoDate;
	isHistorical: boolean;
	netWorth: PercentileBands;
}

export interface StochasticProgress {
	completedRuns: number;
	totalRuns: number;
	fraction: number;
}

export interface StochasticProjectionResult {
	config: StochasticConfig;
	bands: StochasticBandRow[];
	milestones: {
		finalNetWorthPercentiles: PercentileBands;
	};
	evaluations: EvaluationResultTables;
}

export type StochasticProjectionRequest = DeterministicProjectionRequest & {
	config: StochasticConfig;
};

export interface StochasticProjectionResponse {
	result?: StochasticProjectionResult | null;
	issues?: ModelValidationIssue[];
	error?: string;
}

export type StochasticResponse = StochasticProjectionResponse;

export type ServerStatus = GeneratedStatusOutputBody;
export type StatusResponse = ServerStatus;
export type SyncError = GeneratedSyncError;
export type SyncCredentialStatus = GeneratedSyncCredentialBody;
export type SyncCredentialConnectRequest = GeneratedSyncCredentialInputBody;
export type PinnedEvaluationsResponse = GeneratedPinnedEvaluationsOutputBody;
export type PinnedEvaluationsRequest = GeneratedPinnedEvaluationsInputBody;

export type FinancialModelResponse = Omit<
	GeneratedFinancialModelResponse,
	"model" | "issues" | "receiptLinks"
> & {
	model: FinancialModel | null;
	issues: ModelValidationIssue[];
	receiptLinks?: Record<string, string[]>;
};
export type ModelResponse = FinancialModelResponse;

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

export type SafeSpendingSettings = Omit<
	GeneratedSafeSpendingSettings,
	"cycleStartDay" | "paydayDay" | "savingsTarget" | "incomeScheduleIds"
> & {
	cycleStartDay: number;
	paydayDay: number;
	savingsTarget: number;
	/** Explicit recurrence rule sources. Empty means no automatic income. */
	incomeScheduleIds: string[];
};

export type SafeSpendingSettingsResponse = Omit<
	GeneratedSafeSpendingOutputBody,
	"settings"
> & { settings: SafeSpendingSettings | null };

// Typed adapters from the client view to the generated wire shapes. They are
// the only bridge between the two trees: every field is copied explicitly so
// a snapshot change fails at compile time instead of crossing a cast.

function generatedStringObject(
	value: JsonValue,
	field: string,
): GeneratedTransactionAmountResolutionConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${field} must be a JSON object.`);
	return value;
}

function toGeneratedAmountInputBinding(
	binding: AmountInputBinding,
): GeneratedAmountInputBinding {
	return {
		source: binding.source,
		value: binding.value,
		provider: binding.provider,
		arguments: binding.arguments,
	};
}

function toGeneratedResolutionInputs(
	inputs: Record<string, AmountInputBinding> | null | undefined,
): GeneratedTransactionAmountResolutionInputs {
	const result: GeneratedTransactionAmountResolutionInputs = {};
	for (const [name, binding] of Object.entries(inputs ?? {}))
		result[name] = toGeneratedAmountInputBinding(binding);
	return result;
}

export function toGeneratedAmountResolution(
	resolution: TransactionAmountResolution,
): GeneratedTransactionAmountResolution {
	return {
		resolver: resolution.resolver,
		config: generatedStringObject(resolution.config, "amount.config"),
		inputs: toGeneratedResolutionInputs(resolution.inputs),
	};
}

function toGeneratedRecurrence(
	recurrence: BackendRecurrence,
): GeneratedRecurrence {
	return {
		unit: recurrence.unit,
		interval: recurrence.interval,
		weekdays: recurrence.weekdays ?? null,
		monthlyMode: recurrence.monthlyMode ?? undefined,
	};
}

function toGeneratedPlannedPurchase(
	purchase: BackendPlannedPurchase,
): GeneratedPlannedPurchase {
	return {
		id: purchase.id,
		name: purchase.name,
		cost: purchase.cost,
		earliestDate: purchase.earliestDate,
		enabled: purchase.enabled,
		priority: purchase.priority,
		// null means "no funding account"; generated omits the field.
		fundingAccountId: purchase.fundingAccountId ?? undefined,
	};
}

function toGeneratedEvaluationInstance(
	instance: EvaluationInstance,
): GeneratedEvaluationInstance {
	return {
		instanceId: instance.instanceId,
		name: instance.name,
		enabled: instance.enabled,
		config: instance.config,
	};
}

function optionalInstances(
	instances: EvaluationInstance[] | undefined,
): GeneratedEvaluationInstance[] | null {
	// An absent table is absence, not an empty table: preserve it as null.
	return instances?.map(toGeneratedEvaluationInstance) ?? null;
}

export function toGeneratedEvaluationTables(
	tables: EvaluationTables,
): GeneratedEvaluationTables {
	return {
		financialIndependence: tables.financialIndependence.map(
			toGeneratedEvaluationInstance,
		),
		netWorthThreshold: tables.netWorthThreshold.map(
			toGeneratedEvaluationInstance,
		),
		accountBalance: tables.accountBalance.map(toGeneratedEvaluationInstance),
		transactionFulfillment: tables.transactionFulfillment.map(
			toGeneratedEvaluationInstance,
		),
		cycleFulfillment: optionalInstances(tables.cycleFulfillment),
		plannedPurchases: optionalInstances(tables.plannedPurchases),
		whatIf: optionalInstances(tables.whatIf),
	};
}

function toGeneratedSchedule(schedule: BackendSchedule): GeneratedSchedule {
	return {
		id: schedule.id,
		name: schedule.name,
		sourceAccountId: schedule.sourceAccountId,
		destinations: schedule.destinations,
		amount: toGeneratedAmountResolution(schedule.amount),
		recurrence: toGeneratedRecurrence(schedule.recurrence),
		startDate: schedule.startDate,
		endDate: schedule.endDate,
		annualCap: schedule.annualCap,
		priority: schedule.priority,
		enabled: schedule.enabled,
	};
}

function toGeneratedTransaction(
	transaction: BackendTransaction,
): GeneratedTransaction {
	return {
		id: transaction.id,
		name: transaction.name,
		sourceAccountId: transaction.sourceAccountId,
		destinations: transaction.destinations,
		amount: toGeneratedAmountResolution(transaction.amount),
		postedTime: transaction.postedTime,
		transactionTime: transaction.transactionTime,
		claim: transaction.claim ?? undefined,
		executionOrder: transaction.executionOrder,
		enabled: transaction.enabled,
		source: transaction.source,
		pending: transaction.pending,
		void: transaction.void,
	};
}

export function toGeneratedFinancialModel(
	model: FinancialModel,
): GeneratedFinancialModel {
	return {
		sourcePath: model.sourcePath,
		accounts: model.accounts.map((account) => ({ ...account })),
		checkpoints: model.checkpoints.map((checkpoint) => ({ ...checkpoint })),
		evaluations: toGeneratedEvaluationTables(model.evaluations),
		transactions: model.transactions.map(toGeneratedTransaction),
		schedules: model.schedules.map(toGeneratedSchedule),
		paymentTerms: model.paymentTerms ?? null,
		plannedPurchases:
			model.plannedPurchases?.map(toGeneratedPlannedPurchase) ?? null,
	};
}

export function toGeneratedModelOverrides(
	overrides: ModelOverrides,
): GeneratedModelOverrides {
	return {
		addedAccounts: overrides.addedAccounts.map((account) => ({ ...account })),
		addedTransactions: overrides.addedTransactions.map(toGeneratedTransaction),
		addedSchedules: overrides.addedSchedules.map(toGeneratedSchedule),
		disabledAccountIds: overrides.disabledAccountIds,
		disabledTransactionIds: overrides.disabledTransactionIds,
		disabledScheduleIds: overrides.disabledScheduleIds,
	};
}

export function toGeneratedProjectionRuntimeSettings(
	settings: ProjectionRuntimeSettings,
): GeneratedProjectionRuntimeSettings {
	return {
		fallbackProjectionStartDate: settings.fallbackProjectionStartDate,
		horizonYears: settings.horizonYears,
		evaluations: toGeneratedEvaluationTables(settings.evaluations),
	};
}

export function toGeneratedProjectionRequestBody(
	request: DeterministicProjectionRequest,
): GeneratedProjectionRequestBody {
	if (!request.range)
		throw new Error("A projection range is required. Retry the request.");
	const body: GeneratedProjectionRequestBody = {
		settings: toGeneratedProjectionRuntimeSettings(request.settings),
		range: {
			startDate: request.range.startDate,
			endDate: request.range.endDate,
		},
	};
	if (request.model) body.model = toGeneratedFinancialModel(request.model);
	if (request.overrides)
		body.overrides = toGeneratedModelOverrides(request.overrides);
	return body;
}

export function toGeneratedAmountPreset(
	preset: AmountPreset,
): GeneratedAmountPreset {
	return {
		id: preset.id,
		name: preset.name,
		label: preset.label,
		summary: preset.summary ?? undefined,
		whenUse: preset.whenUse ?? undefined,
		amount: toGeneratedAmountResolution(preset.amount),
		enabled: preset.enabled,
	};
}

export function toGeneratedSafeSpendingBody(
	settings: SafeSpendingSettings,
): GeneratedSafeSpendingBody {
	return {
		accountIds: settings.accountIds,
		cycleStartDay: settings.cycleStartDay,
		incomeScheduleIds: settings.incomeScheduleIds,
		paydayDay: settings.paydayDay,
		savingsTarget: settings.savingsTarget,
		spendingAccountIds: settings.spendingAccountIds,
		transactionIds: settings.transactionIds,
	};
}

export function generatedPositionRequest(
	asOfDate: string,
): GeneratedPositionRequestBody {
	return { asOfDate };
}

export function normalizeCurrentPosition(
	result: GeneratedCurrentPosition,
): import("../api/position.ts").CurrentPosition {
	return {
		asOfDate: result.asOfDate,
		netWorth: result.netWorth,
		// A null account list means no positions were reported; the dialog
		// renders it exactly like an empty list.
		accounts: result.accounts ?? [],
	};
}

// Generated responses are parsed JSON, but the generated types widen JSON to
// `unknown`. These readers check each value before handing it to the UI, so
// no unchecked assertion is needed to cross back to the client view.

function asJsonValue(value: unknown, field: string): JsonValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	)
		return value;
	if (Array.isArray(value))
		return value.map((item, index) => asJsonValue(item, `${field}[${index}]`));
	if (isRecord(value)) {
		const result: JsonObject = {};
		for (const [key, item] of Object.entries(value))
			result[key] = asJsonValue(item, `${field}.${key}`);
		return result;
	}
	throw new Error(`The server returned an invalid ${field} value.`);
}

function normalizeDiagnostic(
	diagnostic: GeneratedEvaluationDiagnostic,
): EvaluationDiagnostic {
	return {
		code: diagnostic.code,
		severity: diagnostic.severity,
		message: diagnostic.message,
		date: diagnostic.date,
		// Null related-id tables mean "none reported"; the client omits them.
		relatedAccountIds: diagnostic.relatedAccountIds ?? undefined,
		relatedTransactionIds: diagnostic.relatedTransactionIds ?? undefined,
	};
}

function normalizeResultEnvelope(
	envelope: GeneratedEvaluationResultEnvelope,
): EvaluationResultEnvelope {
	return {
		instanceId: envelope.instanceId,
		name: envelope.name,
		status: envelope.status,
		deterministic: asJsonValue(envelope.deterministic, "deterministic"),
		probabilistic: asJsonValue(envelope.probabilistic, "probabilistic"),
		diagnostics: (envelope.diagnostics ?? []).map(normalizeDiagnostic),
	};
}

function nullableEnvelopes(
	envelopes: GeneratedEvaluationResultEnvelope[] | null | undefined,
): EvaluationResultEnvelope[] | undefined {
	return envelopes?.map(normalizeResultEnvelope) ?? undefined;
}

function normalizeResultTables(
	tables: GeneratedEvaluationResultTables,
): EvaluationResultTables {
	return {
		financialIndependence: (tables.financialIndependence ?? []).map(
			normalizeResultEnvelope,
		),
		netWorthThreshold: (tables.netWorthThreshold ?? []).map(
			normalizeResultEnvelope,
		),
		accountBalance: (tables.accountBalance ?? []).map(normalizeResultEnvelope),
		transactionFulfillment: (tables.transactionFulfillment ?? []).map(
			normalizeResultEnvelope,
		),
		cycleFulfillment: nullableEnvelopes(tables.cycleFulfillment),
		plannedPurchases: nullableEnvelopes(tables.plannedPurchases),
		whatIf: nullableEnvelopes(tables.whatIf),
	};
}

function normalizeTransactionEvent(
	event: GeneratedTransactionEvent,
): TransactionEvent {
	return {
		date: event.date,
		sequence: event.sequence,
		origin: event.origin,
		requestedAmount: event.requestedAmount,
		realizedAmount: event.realizedAmount,
		accountDeltas: event.accountDeltas,
		bindingConstraints:
			event.bindingConstraints?.map((constraint, index) =>
				asJsonValue(constraint, `bindingConstraints[${index}]`),
			) ?? undefined,
		availableAmount: event.availableAmount,
		fulfillment: event.fulfillment,
	};
}

export function normalizeProjectionResult(
	result: GeneratedProjectionResult,
): ProjectionResult {
	return {
		timeline: {
			rows: (result.timeline.rows ?? []).map((row) => ({
				date: row.date,
				isHistorical: row.isHistorical,
				netWorth: row.netWorth,
				accountSnapshots: (row.accountSnapshots ?? []).map((snapshot) => ({
					accountId: snapshot.accountId,
					date: snapshot.date,
					balance: snapshot.balance,
					impacts: snapshot.impacts ?? [],
				})),
				externalInflowAmount: row.externalInflowAmount,
				externalOutflowAmount: row.externalOutflowAmount,
				internalTransferAmount: row.internalTransferAmount,
			})),
		},
		accountSummaries: result.accountSummaries ?? [],
		totals: result.totals,
		milestones: result.milestones,
		summary: result.summary,
		evaluations: normalizeResultTables(result.evaluations),
		transactionEvents: result.transactionEvents?.map(normalizeTransactionEvent),
	};
}
