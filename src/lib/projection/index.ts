export {
	getConfiguredEvaluation,
	getFinancialIndependenceConfig,
	getFinancialIndependenceResult,
	getNetWorthThresholdConfig,
	getNetWorthThresholdResult,
	getPostingFulfillmentConfig,
	getPostingFulfillmentResult,
	type ValidatedConfiguredEvaluation,
} from "./evaluation/accessors";
export { evaluationConfigValidators } from "./evaluation/configValidation";
export {
	FINANCIAL_INDEPENDENCE_DEFINITION_ID,
	type FinancialIndependenceProbabilisticResult,
	normalizeFinancialIndependencePlan,
	validateFinancialIndependencePlan,
} from "./evaluation/financialIndependence";
export { isJsonValue } from "./evaluation/json";
export {
	NET_WORTH_THRESHOLD_DEFINITION_ID,
	type NetWorthThresholdPathResult,
	type NetWorthThresholdProbabilisticResult,
	validateNetWorthThresholdConfig,
} from "./evaluation/netWorthThreshold";
export {
	DEFAULT_POSTING_FULFILLMENT_INSTANCE_ID,
	POSTING_FULFILLMENT_DEFINITION_ID,
	type PostingFulfillmentDateSummary,
	type PostingFulfillmentEvent,
	type PostingFulfillmentPathResult,
	type PostingFulfillmentPostingSummary,
	type PostingFulfillmentProbabilisticResult,
	validatePostingFulfillmentConfig,
} from "./evaluation/postingFulfillment";
export type {
	IncomeDataLoadResult,
	IncomeDataSource,
} from "./incomeData";
export {
	type AmountPresentation,
	type AmountPresentationNode,
	describePostingAmount,
	getAmountPresentation,
	getExpression,
} from "./model/amountPresentation";
export {
	applyModelOverrides,
	EMPTY_MODEL_OVERRIDES,
} from "./model/applyModelOverrides";
export type {
	FinancialModelParseResult,
	FinancialModelRepository,
	RepositoryAction,
} from "./modelRepository";
export { FinancialModelValidationError } from "./modelRepository";

import type { FinancialIndependenceRunOutcome } from "./types/model";

/**
 * View selector over backend-computed FI outcomes: first cycle-established
 * outcome, else the last eligible one, else the last outcome. Pure UI helper;
 * it does not run the projection kernel.
 */
export function selectFinancialIndependenceOutcomeIndex(
	outcomes: readonly FinancialIndependenceRunOutcome[],
) {
	const successfulIndex = outcomes.findIndex(
		(outcome) => outcome.cycleEstablished,
	);
	if (successfulIndex >= 0) return successfulIndex;
	for (let index = outcomes.length - 1; index >= 0; index--) {
		if (outcomes[index]?.status !== "ineligible") return index;
	}
	return outcomes.length - 1;
}
export {
	amountProviders,
	amountResolvers,
	createExpressionAmount,
	resolvePostingAmountDescriptor,
	updateExpressionAmount,
	validateAmountDescriptor,
} from "./simulation/amountResolution";
export { validateIncomeAmountConfig } from "./simulation/incomeConfig";
export { parseFinancialModelDocument } from "./sources/csv/csvDataSource";
export type {
	CsvFinancialModelOptions,
	CsvFinancialModelParseResult,
} from "./sources/csv/csvLoader";
export {
	fetchCsvFinancialModelFiles,
	loadCsvFinancialModel,
	parseCsvFinancialModel,
	serializeCsvFinancialModel,
} from "./sources/csv/csvLoader";
export {
	csvAccountSchema,
	csvAccountsHeaders,
	csvCheckpointSchema,
	csvCheckpointsHeaders,
	csvDateSchema,
	csvFinancialIndependenceHeaders,
	csvFinancialIndependenceSchema,
	csvNetWorthThresholdHeaders,
	csvNetWorthThresholdSchema,
	csvPostingFulfillmentHeaders,
	csvPostingFulfillmentSchema,
	csvPostingSchema,
	csvPostingsHeaders,
} from "./sources/csv/csvSchema";
export {
	summarizeValidationIssues,
	validateCsvFinancialModel,
} from "./sources/csv/csvValidation";
export {
	parseIncomeDataFiles,
	parseIncomeDataSnapshot,
} from "./sources/csv/incomeDataSource";
export type {
	IncomeDataSnapshot,
	IncomeSourceDefinition,
	IncomeTaxBracket,
	IncomeTaxProfile,
} from "./types/income";
export {
	EMPTY_INCOME_DATA,
	INCOME_DATA_API_PATH,
	INCOME_DATA_FILE_NAMES,
	INCOME_DATA_PUBLIC_PATH,
} from "./types/income";
export type {
	Account,
	AccountDelta,
	AccountMovementConstraint,
	AccountMovementConstraintType,
	AccountSnapshot,
	AmountInputBinding,
	BehaviorCollectionKey,
	Checkpoint,
	CheckpointCorrection,
	EvaluationDiagnostic,
	EvaluationForType,
	EvaluationInstance,
	EvaluationResultCollection,
	EvaluationResultEnvelope,
	EvaluationResultStatus,
	EvaluationResultTables,
	EvaluationTables,
	EvaluationType,
	FinancialIndependenceAnalysis,
	FinancialIndependenceAssetContribution,
	FinancialIndependenceBalanceTrajectoryRow,
	FinancialIndependenceDetailedRunOutcome,
	FinancialIndependenceEvaluation,
	FinancialIndependenceExpenseBasis,
	FinancialIndependencePlan,
	FinancialIndependencePrincipalPolicy,
	FinancialIndependenceRow,
	FinancialIndependenceRunOutcome,
	FinancialIndependenceSource,
	FinancialIndependenceSummaryOutcome,
	FinancialIndependenceWithdrawalAccountSummary,
	FinancialIndependenceWithdrawalSummary,
	FinancialModelDocument,
	IncomeAmountConfig,
	IncomeEvent,
	IncomeResolverStep,
	IsoDate,
	JsonPrimitive,
	JsonValue,
	ModelCollectionKey,
	ModelFileContents,
	ModelFileName,
	ModelOverrides,
	MovementEvent,
	NetWorthThresholdConfig,
	NetWorthThresholdEvaluation,
	Posting,
	PostingAmountResolution,
	PostingFrequency,
	PostingFulfillmentConfig,
	PostingFulfillmentEvaluation,
	ProjectionAccountSummary,
	ProjectionCoreResult,
	ProjectionPath,
	ProjectionResult,
	ProjectionRow,
	ProjectionRuntimeSettings,
	RawProjectionOutput,
} from "./types/model";
export {
	CSV_BEHAVIOR_FILE_NAMES,
	CSV_MODEL_FILE_NAMES,
	CSV_MODEL_PUBLIC_PATH,
	CSV_MODEL_REPO_PATH,
	EVALUATION_TYPE_ORDER,
} from "./types/model";
export type {
	FinancialModel,
	HistoricalObservationSnapshot,
	MonteCarloSample,
	PreparedProjection,
	SimulationRequest,
	SimulationRun,
	SimulationSnapshot,
	SimulationState,
} from "./types/simulation";
export type {
	PercentileBands,
	StochasticBandRow,
	StochasticConfig,
	StochasticEvaluationWorkload,
	StochasticProgress,
	StochasticProgressPhase,
	StochasticProjectionResult,
} from "./types/stochastic";
export type {
	ModelPath,
	ModelValidationIssue,
	ModelValidationSeverity,
} from "./types/validation";
export {
	computePercentiles,
	createStochasticSampler,
	normalizeStochasticConfig,
	reseed,
	type StochasticSampler,
	sampleLogNormal,
} from "./utils/stochastic";
export type {
	FinancialModelValidationOptions,
	ValidationPaths,
} from "./validation/types";
export {
	summarizeValidationIssues as summarizeModelValidationIssues,
	validateFinancialModel,
} from "./validation/validateFinancialModel";
