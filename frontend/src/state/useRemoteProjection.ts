import {
	keepPreviousData,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { projectDeterministic } from "../api/generated/endpoints.ts";
import {
	type DeterministicProjectionRequest,
	type DeterministicProjectionResponse,
	type EvaluationResultEnvelope,
	type EvaluationTables,
	type FinancialModel,
	type ProjectionResult,
	type StochasticProjectionRequest,
	type StochasticProjectionResult,
} from "../api/index.ts";
import { projectionTransactions } from "../api/projectionTransactions.ts";
import {
	OTHER_EVAL_OUTCOME_RENDERERS,
	balanceEvaluation,
	thresholdEvaluation,
	valueRecord,
} from "../api/evalOutcomes.ts";
import { financialIndependenceRange } from "../api/financialIndependence.ts";
import { UserScopeError } from "../api/scopedRequest.ts";
import { finite } from "../domain/guards.ts";
import type { Projection, RangeResult } from "../domain/result.ts";
import { horizonDate } from "../domain/result.ts";
import {
	deterministicQueryKey,
	evalOverlayQueryKey,
	serverQueryClient,
	stochasticQueryKey,
} from "./serverQuery.ts";
import { dismissKey, notifyError } from "./notifications.ts";
import { useUiStore } from "./uiStore.ts";
import { projectionEvaluationKey } from "./projectionKeys.ts";
import { projectionStartDate } from "./projectionStartDate.ts";
import {
	normalizedEvaluations,
	projectionSourceFromModel,
	projectionStartDateFromRows,
	type ProjectionSource,
} from "./projectionSource.ts";
import {
	balancesOptions,
	checkpointsOptions,
	evalSummaryOptions,
	purchasesOptions,
	schedulesOptions,
	statusOptions,
	transactionsOptions,
} from "./workspaceResources.ts";
import { useUserScope } from "./useUserScope.ts";
export { projectionStartDate } from "./projectionStartDate.ts";
import { purchaseEvaluationResult } from "./purchaseEvaluation.ts";
import { stochasticProjectionOptions } from "./stochasticProjectionQuery.ts";

export interface ProjectionDateRange {
	startDate?: string;
	endDate?: string;
}

/** Rows the projection layer needs. Model and row sources both satisfy it. */
type ProjectionRows = {
	evaluations: EvaluationTables;
	checkpoints: { observedAt: number }[];
	postings: {
		id: string;
		name: string;
		sourceAccountId: string | null;
		destinations: string[] | null;
	}[];
	schedules: {
		id: string;
		name: string;
		sourceAccountId: string | null;
		destinations: string[] | null;
		startDate: string;
	}[];
	plannedPurchases?: {
		id: string;
		name: string;
		fundingAccountId?: string | null;
	}[];
};

type ProjectionInput = ProjectionRows & {
	startDate?: string;
	revision?: string;
};

function projectionStartOf(input: ProjectionInput): string {
	if (input.startDate) return input.startDate;
	return projectionStartDate(input as FinancialModel);
}

function projectionKeyOf(input: ProjectionInput): string {
	if (input.revision) return input.revision;
	return JSON.stringify(input);
}

export interface UseRemoteProjectionOptions {
	model?: FinancialModel | null;
	years?: number;
	ranges?: boolean;
	// Request-local evaluation scope. It participates in model/cache identity.
	evaluations?: EvaluationTables;
	// Requested timeline slice. Undefined keeps the full span the hook has
	// always fetched: everything through the horizon end.
	dateRange?: ProjectionDateRange;
	// When false the hook issues no requests.
	enabled?: boolean;
}

const MISSING_MODEL_MESSAGE =
	"No server financial model is available for projection. Load or replace a model before calculating.";

async function fetchDeterministicResult(
	input: ProjectionInput,
	years: number,
	range: ProjectionDateRange,
	signal: AbortSignal,
	pinModel?: FinancialModel | null,
): Promise<ProjectionResult> {
	const request: DeterministicProjectionRequest = {
		...projectionRequest(input, years),
		// A request-local overlay must describe the same model the UI
		// rendered. Without a pinned model, a concurrent row write can
		// answer with a different queue and stale dates. Row sources have no
		// document to pin, so they rely on the server snapshot.
		...(pinModel ? { model: pinModel } : {}),
		range,
	};
	const response = (await projectDeterministic(request as never, { signal }))
		.data as unknown as DeterministicProjectionResponse;
	const responseError = projectionResponseError(response);
	if (responseError) throw responseError;
	if (!response.result)
		throw new Error(
			"The server returned no deterministic projection result. Retry the request.",
		);
	return response.result;
}

export function projectionRequest(
	model: ProjectionInput,
	years: number,
): Omit<DeterministicProjectionRequest, "model"> {
	const horizonYears = Number.isFinite(years)
		? Math.max(1, Math.trunc(years))
		: 1;
	return {
		settings: {
			fallbackProjectionStartDate: projectionStartOf(model),
			horizonYears,
			evaluations: normalizedEvaluations(model.evaluations),
		},
	};
}

// The default timeline slice keeps the full span this hook has always
// fetched: everything through the horizon end, which matches the backend
// clamped end date exactly. Callers narrow it with dateRange; the server
// requires a range on every request and guesses nothing. Total: a malformed
// start date still sends a request (with an empty range the server rejects
// as data) instead of throwing during render.
export function resolveProjectionRange(
	model: ProjectionInput,
	years: number,
	override?: ProjectionDateRange,
): ProjectionDateRange {
	if (override) return override;
	const horizonYears = Number.isFinite(years)
		? Math.max(1, Math.trunc(years))
		: 1;
	try {
		return {
			endDate: horizonDate({
				start: projectionStartOf(model),
				years: horizonYears,
			}),
		};
	} catch {
		return {};
	}
}

export function projectionRangeKey(range: ProjectionDateRange): string {
	return `${range.startDate ?? ""}..${range.endDate ?? ""}`;
}

function evaluationProbability(
	envelope: EvaluationResultEnvelope | undefined,
	key: string,
): number | null {
	const probabilistic = valueRecord(envelope?.probabilistic);
	const value = finite(probabilistic?.[key]);
	return value === null ? null : Math.max(0, Math.min(1, value));
}

function rowBalances(
	row: ProjectionResult["timeline"]["rows"][number],
	startingBalances: Record<string, number> | null,
	endingBalances: Record<string, number> | null,
	first: boolean,
	last: boolean,
): Record<string, number> {
	if (row.accountSnapshots.length)
		return Object.fromEntries(
			row.accountSnapshots.map((snapshot) => [
				snapshot.accountId,
				snapshot.balance,
			]),
		);
	if (first && startingBalances) return startingBalances;
	if (last && endingBalances) return endingBalances;
	return {};
}

export function projectionResultToLocal(
	result: ProjectionResult,
	model: ProjectionRows | null,
	horizonYears?: number,
): Projection {
	const rows = result.timeline.rows;
	// Starting/ending balance records built at most once per mapping instead
	// of once per timeline row.
	let startingBalances: Record<string, number> | null = null;
	let endingBalances: Record<string, number> | null = null;
	const balancesFor = (kind: "starting" | "ending"): Record<string, number> => {
		if (kind === "starting") {
			if (!startingBalances) {
				startingBalances = Object.fromEntries(
					result.accountSummaries.map((summary) => [
						summary.accountId,
						summary.startingBalance,
					]),
				);
			}
			return startingBalances;
		}
		if (!endingBalances) {
			endingBalances = Object.fromEntries(
				result.accountSummaries.map((summary) => [
					summary.accountId,
					summary.endingBalance,
				]),
			);
		}
		return endingBalances;
	};
	const needsStarting =
		rows.length === 0 || rows[0]!.accountSnapshots.length === 0;
	const needsEnding =
		rows.length > 0 && rows[rows.length - 1]!.accountSnapshots.length === 0;
	const starting =
		needsStarting || rows.length === 0 ? balancesFor("starting") : null;
	const ending = needsEnding ? balancesFor("ending") : null;
	const points = rows.length
		? rows.map((row, index) => ({
				date: row.date,
				total: row.netWorth,
				balances: rowBalances(
					row,
					starting,
					ending,
					index === 0,
					index === rows.length - 1,
				),
			}))
		: [
				{
					date: result.milestones.projectionStartDate,
					total: result.summary.currentNetWorth,
					balances: { ...starting! },
				},
			];
	const projectionStartDate = result.milestones.projectionStartDate;
	const startCheckpoint =
		model?.checkpoints.some((checkpoint) => {
			const day = new Date(checkpoint.observedAt * 1000)
				.toISOString()
				.slice(0, 10);
			return day === projectionStartDate;
		}) ?? false;
	const transactions = projectionTransactions(result, model, {
		startCheckpoint,
	});
	const balances = new Map(
		result.accountSummaries.map((summary) => [summary.accountId, summary]),
	);
	const thresholdByID = new Map(
		result.evaluations.netWorthThreshold.map((evaluation) => [
			evaluation.instanceId,
			evaluation,
		]),
	);
	const balanceByID = new Map(
		result.evaluations.accountBalance.map((evaluation) => [
			evaluation.instanceId,
			evaluation,
		]),
	);
	const independenceByID = new Map(
		result.evaluations.financialIndependence.map((evaluation) => [
			evaluation.instanceId,
			evaluation,
		]),
	);
	const fulfillmentByID = new Map(
		result.evaluations.postingFulfillment.map((evaluation) => [
			evaluation.instanceId,
			evaluation,
		]),
	);
	const cycleByID = new Map(
		(result.evaluations.cycleFulfillment ?? []).map((evaluation) => [
			evaluation.instanceId,
			evaluation,
		]),
	);
	const evaluations = [
		...(model?.evaluations.netWorthThreshold ?? [])
			.filter((evaluation) => evaluation.enabled)
			.map((evaluation) =>
				thresholdEvaluation(
					evaluation,
					thresholdByID.get(evaluation.instanceId),
					result.summary.currentNetWorth,
					result.summary.finalNetWorth,
				),
			),
		...(model?.evaluations.accountBalance ?? [])
			.filter((evaluation) => evaluation.enabled)
			.map((evaluation) =>
				balanceEvaluation(
					evaluation,
					balanceByID.get(evaluation.instanceId),
					balances,
				),
			),
	];
	// Eval displays resolve through the outcome renderer registry: pure
	// readers over the cached base path plus each evaluation envelope. A
	// missing envelope renders indeterminate values without refetching.
	const horizonEnd =
		horizonYears === undefined
			? null
			: horizonDate({ start: projectionStartDate, years: horizonYears });
	const otherEvaluations = [
		...(model?.evaluations.financialIndependence ?? []).map((evaluation) =>
			OTHER_EVAL_OUTCOME_RENDERERS.financialIndependence(evaluation, {
				envelope: independenceByID.get(evaluation.instanceId),
				postingIds: null,
				enabled: evaluation.enabled,
				model,
				projectionStartDate,
				horizonEndDate: horizonEnd,
			}),
		),
		...(model?.evaluations.postingFulfillment ?? []).map((evaluation) =>
			OTHER_EVAL_OUTCOME_RENDERERS.postingFulfillment(evaluation, {
				envelope: fulfillmentByID.get(evaluation.instanceId),
				postingIds: Array.isArray(valueRecord(evaluation.config)?.postingIds)
					? (valueRecord(evaluation.config)!.postingIds as string[])
					: null,
				enabled: evaluation.enabled,
			}),
		),
		...(model?.evaluations.cycleFulfillment ?? []).map((evaluation) =>
			OTHER_EVAL_OUTCOME_RENDERERS.cycleFulfillment(evaluation, {
				envelope: cycleByID.get(evaluation.instanceId),
				postingIds: null,
				enabled: evaluation.enabled,
			}),
		),
	];
	return {
		points,
		currentNetWorth: result.summary.currentNetWorth,
		transactions,
		firstFailure:
			transactions.find((transaction) => transaction.constraint !== null) ??
			null,
		evaluations,
		otherEvaluations,
		inflows: result.totals.externalInflowAmount,
		outflows: result.totals.externalOutflowAmount,
		transfers: result.totals.internalTransferAmount,
		startDateHasCheckpoint: startCheckpoint,
		plannedPurchases: purchaseEvaluationResult(
			result.evaluations,
			model?.evaluations,
		),
	};
}

function aggregateFulfillmentEvaluation(
	result: StochasticProjectionResult,
): EvaluationResultEnvelope | undefined {
	return (
		result.evaluations.postingFulfillment.find((evaluation) => {
			const deterministic = valueRecord(evaluation.deterministic);
			const ids = deterministic?.postingIds;
			return ids === null || ids === undefined;
		}) ?? result.evaluations.postingFulfillment[0]
	);
}

export function stochasticResultToLocal(
	result: StochasticProjectionResult,
): RangeResult {
	const evaluationSuccess: Record<string, number> = {};
	for (const evaluation of result.evaluations.netWorthThreshold) {
		const probability = evaluationProbability(evaluation, "probability");
		if (probability !== null)
			evaluationSuccess[evaluation.instanceId] = probability;
	}
	for (const evaluation of result.evaluations.accountBalance) {
		const probability = evaluationProbability(evaluation, "probability");
		if (probability !== null)
			evaluationSuccess[evaluation.instanceId] = probability;
	}
	for (const evaluation of result.evaluations.cycleFulfillment ?? []) {
		const probability = evaluationProbability(
			evaluation,
			"withinBudgetProbability",
		);
		if (probability !== null)
			evaluationSuccess[evaluation.instanceId] = probability;
	}
	const fulfillment = aggregateFulfillmentEvaluation(result);
	const fulfillmentProbability = evaluationProbability(
		fulfillment,
		"fullFulfillmentProbability",
	);
	return {
		points: result.bands.map((band) => ({
			date: band.date,
			lower: band.netWorth.p10,
			median: band.netWorth.p50,
			upper: band.netWorth.p90,
		})),
		count: result.config.runCount,
		evaluationSuccess,
		financialIndependence: Object.fromEntries(
			result.evaluations.financialIndependence.map((envelope) => [
				envelope.instanceId,
				financialIndependenceRange(envelope, result.config.runCount),
			]),
		),
		failureShare:
			fulfillmentProbability === null ? 0 : 1 - fulfillmentProbability,
	};
}

/**
 * Overlay the eval-scoped envelopes onto the cached base path. The base
 * result owns timeline, transactions, totals, and summary; the overlay owns
 * evaluation envelopes. Overlay tables win per instance ID so request-local
 * evaluations replace the base scope without touching the path.
 */
export function mergeEvaluationResults(
	base: ProjectionResult,
	overlay: ProjectionResult,
): ProjectionResult {
	const pick = <T extends { instanceId: string }>(
		left: T[],
		right: T[],
	): T[] => {
		const ids = new Set(right.map((item) => item.instanceId));
		return [...left.filter((item) => !ids.has(item.instanceId)), ...right];
	};
	return {
		...base,
		evaluations: {
			financialIndependence: pick(
				base.evaluations.financialIndependence,
				overlay.evaluations.financialIndependence,
			),
			netWorthThreshold: pick(
				base.evaluations.netWorthThreshold,
				overlay.evaluations.netWorthThreshold,
			),
			accountBalance: pick(
				base.evaluations.accountBalance,
				overlay.evaluations.accountBalance,
			),
			postingFulfillment: pick(
				base.evaluations.postingFulfillment,
				overlay.evaluations.postingFulfillment,
			),
			cycleFulfillment: pick(
				base.evaluations.cycleFulfillment ?? [],
				overlay.evaluations.cycleFulfillment ?? [],
			),
			plannedPurchases: pick(
				base.evaluations.plannedPurchases ?? [],
				overlay.evaluations.plannedPurchases ?? [],
			),
		},
	};
}

function projectionResponseError(
	response: DeterministicProjectionResponse,
): Error | null {
	if (response.error) return new Error(response.error);
	const errors = (response.issues ?? []).filter(
		(issue) => issue.severity === "error",
	);
	if (!errors.length) return null;
	return new Error(errors.map((issue) => issue.message).join(" "));
}

function randomRunCount(): number {
	return 400;
}

// Abortion travels disguised: the API client wraps every fetch rejection,
// including aborts, in ApiNetworkError carrying the original as cause.
// Walk the chain instead of matching the surface type.
function isAbortError(cause: unknown): boolean {
	let current: unknown = cause;
	for (let depth = 0; depth < 5; depth++) {
		if (typeof DOMException !== "undefined" && current instanceof DOMException)
			return current.name === "AbortError";
		if (!(current instanceof Error)) return false;
		if (current.name === "AbortError") return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
}

function useProjectionSource(enabled: boolean): {
	source: ProjectionSource | null;
	hasModel: boolean;
	pending: boolean;
	error: string | null;
} {
	const scope = useUserScope();
	const active = enabled && scope.status === "ready";
	const client = serverQueryClient();
	const status = useQuery({ ...statusOptions(scope), enabled: active }, client);
	const balances = useQuery(
		{ ...balancesOptions(scope), enabled: active },
		client,
	);
	const transactions = useQuery(
		{ ...transactionsOptions(scope), enabled: active },
		client,
	);
	const schedules = useQuery(
		{ ...schedulesOptions(scope), enabled: active },
		client,
	);
	const purchases = useQuery(
		{ ...purchasesOptions(scope), enabled: active },
		client,
	);
	const checkpoints = useQuery(
		{ ...checkpointsOptions(scope), enabled: active },
		client,
	);
	const summary = useQuery(
		{ ...evalSummaryOptions(scope), enabled: active },
		client,
	);
	if (!active)
		return { source: null, hasModel: false, pending: false, error: null };
	if (status.error)
		return {
			source: null,
			hasModel: false,
			pending: false,
			error: status.error.message,
		};
	if (status.data?.hasModel !== true)
		return {
			source: null,
			hasModel: false,
			pending: status.isPending,
			error: null,
		};
	const rows = [
		balances,
		transactions,
		schedules,
		purchases,
		checkpoints,
		summary,
	];
	const rowError = rows.find((row) => row.error)?.error;
	if (rowError)
		return {
			source: null,
			hasModel: true,
			pending: false,
			error: rowError.message,
		};
	if (rows.some((row) => row.data === undefined))
		return { source: null, hasModel: true, pending: true, error: null };
	const transactionRows = transactions.data!.transactions;
	const scheduleRows = schedules.data!.schedules;
	const checkpointRows = checkpoints.data!.checkpoints;
	const revisions = [
		balances.data!.revision,
		transactions.data!.revision,
		schedules.data!.revision,
		purchases.data!.revision,
		checkpoints.data!.revision,
		summary.data!.revision,
	].filter((revision): revision is string => Boolean(revision));
	return {
		source: {
			revision: [...new Set(revisions)].sort().join("|"),
			startDate: projectionStartDateFromRows({
				checkpoints: checkpointRows,
				schedules: scheduleRows,
				transactions: transactionRows,
			}),
			accounts: balances.data!.accounts.map((account) => ({
				id: account.id,
				name: account.name,
			})),
			postings: transactionRows,
			schedules: scheduleRows,
			plannedPurchases: purchases.data!.plannedPurchases,
			checkpoints: checkpointRows,
			evaluations: normalizedEvaluations(summary.data!.evaluations),
		},
		hasModel: true,
		pending: false,
		error: null,
	};
}

export function useRemoteProjection({
	model: modelOverride,
	years: yearsOverride,
	ranges: rangesOverride,
	evaluations: evaluationsOverride,
	dateRange: dateRangeOverride,
	enabled = true,
}: UseRemoteProjectionOptions = {}) {
	const scope = useUserScope();
	const rowSource = useProjectionSource(enabled && modelOverride === undefined);
	const source =
		modelOverride !== undefined
			? projectionSourceFromModel(modelOverride)
			: rowSource.source;
	const hasModel =
		modelOverride !== undefined ? modelOverride !== null : rowSource.hasModel;
	const baseSource = scope.status === "ready" ? source : null;
	const activeSource = useMemo(
		() =>
			baseSource && evaluationsOverride
				? {
						...baseSource,
						evaluations: normalizedEvaluations(evaluationsOverride),
					}
				: baseSource,
		[baseSource, evaluationsOverride],
	);
	const baseKey = useMemo(
		() => (baseSource ? projectionKeyOf(baseSource) : "pending"),
		[baseSource],
	);
	const evalKey = useMemo(
		() => projectionEvaluationKey(evaluationsOverride),
		[evaluationsOverride],
	);
	const storeYears = useUiStore((state) => state.years);
	const storeRanges = useUiStore((state) => state.ranges);
	const years = yearsOverride ?? storeYears;
	const ranges = rangesOverride ?? storeRanges;
	const overlayNeeded =
		evaluationsOverride !== undefined &&
		baseSource !== null &&
		activeSource !== null;
	const effectiveRange = useMemo(
		() =>
			baseSource
				? resolveProjectionRange(baseSource, years, dateRangeOverride)
				: null,
		[baseSource, years, dateRangeOverride],
	);
	const rangeKey = effectiveRange ? projectionRangeKey(effectiveRange) : "";
	const queryClient = useQueryClient();
	const queryClientRef = useRef(queryClient);
	// oxlint-disable-next-line react/refs
	queryClientRef.current = queryClient;
	const reportDeterministicError = (queryKey: readonly unknown[]) => ({
		label: "Retry calculation",
		onAction: () => {
			void queryClientRef.current.refetchQueries({ queryKey, exact: true });
		},
	});
	const notifyDeterministicError = (
		queryKey: readonly unknown[],
		cause: unknown,
	) => {
		if (!isAbortError(cause) && !(cause instanceof UserScopeError))
			notifyError(
				"projection",
				cause instanceof Error && cause.message
					? cause.message
					: "The deterministic projection request failed. Retry the connection.",
				reportDeterministicError(queryKey),
			);
	};
	const deterministic = useQuery({
		queryKey: deterministicQueryKey(baseKey, years, rangeKey),
		queryFn: ({ signal, queryKey }) => {
			const current = baseSource;
			if (!current) throw new Error(MISSING_MODEL_MESSAGE);
			const range = effectiveRange ?? resolveProjectionRange(current, years);
			return fetchDeterministicResult(current, years, range, signal)
				.then((result) => {
					dismissKey("projection");
					return result;
				})
				.catch((cause: unknown) => {
					notifyDeterministicError(queryKey, cause);
					throw cause;
				});
		},
		enabled: enabled && baseSource !== null,
		placeholderData: keepPreviousData,
		retry: false,
	});
	const overlay = useQuery({
		queryKey: evalOverlayQueryKey(baseKey, evalKey, years, rangeKey),
		queryFn: ({ signal, queryKey }) => {
			const current = activeSource;
			if (!current) throw new Error(MISSING_MODEL_MESSAGE);
			const range = effectiveRange ?? resolveProjectionRange(current, years);
			return fetchDeterministicResult(
				current,
				years,
				range,
				signal,
				modelOverride,
			).catch((cause: unknown) => {
				notifyDeterministicError(queryKey, cause);
				throw cause;
			});
		},
		enabled: enabled && baseSource !== null && overlayNeeded,
		placeholderData: keepPreviousData,
		retry: false,
	});
	const sourcePending =
		modelOverride === undefined && enabled && rowSource.pending;
	const missingModel =
		enabled && !hasModel && !sourcePending && rowSource.error === null;
	const missingError = useMemo(() => new Error(MISSING_MODEL_MESSAGE), []);
	const mapped = useMemo((): {
		projection: Projection | null;
		error: string | null;
	} => {
		const raw = deterministic.data ?? null;
		if (!raw || !baseSource) return { projection: null, error: null };
		const horizonYears = projectionRequest(baseSource, years).settings
			.horizonYears;
		try {
			if (!overlayNeeded || !activeSource) {
				return {
					projection: projectionResultToLocal(raw, baseSource, horizonYears),
					error: null,
				};
			}
			const overlaid = overlay.data ?? null;
			if (!overlaid) {
				return {
					projection: projectionResultToLocal(raw, baseSource, horizonYears),
					error: null,
				};
			}
			return {
				projection: projectionResultToLocal(
					mergeEvaluationResults(raw, overlaid),
					activeSource,
					horizonYears,
				),
				error: null,
			};
		} catch (cause) {
			return {
				projection: null,
				error:
					cause instanceof Error && cause.message
						? cause.message
						: "The deterministic projection could not be mapped for display.",
			};
		}
	}, [
		deterministic.data,
		overlay.data,
		baseSource,
		activeSource,
		overlayNeeded,
		years,
	]);
	const sourceError = rowSource.error;
	const base: Projection | Error | null = missingModel
		? missingError
		: sourceError
			? new Error(sourceError)
			: (mapped.projection ?? null);
	const overlayErrorMessage =
		overlayNeeded && overlay.error
			? (overlay.error.message ??
				"The evaluation overlay request failed. Retry the connection.")
			: null;
	const mappingErrorMessage = mapped.error;
	const baseError =
		missingModel || sourceError
			? missingModel
				? MISSING_MODEL_MESSAGE
				: sourceError
			: deterministic.error === null &&
				  !overlayErrorMessage &&
				  !mappingErrorMessage
				? null
				: (deterministic.error?.message ??
					overlayErrorMessage ??
					mappingErrorMessage ??
					"The deterministic projection request failed. Retry the connection.");
	const loading =
		sourcePending || deterministic.isFetching || overlay.isFetching;
	const runCount = randomRunCount();
	const seed = 42;
	const rangeEnabled = enabled && ranges && baseSource !== null;
	const rangeQueryKey = rangeEnabled
		? stochasticQueryKey(baseKey, years, runCount, seed, 0)
		: ["stochastic-projection-disabled"];
	const rangeRequest: StochasticProjectionRequest | null =
		rangeEnabled && baseSource
			? {
					...projectionRequest(baseSource, years),
					config: { runCount, seed },
				}
			: null;
	const rangeQuery = useQuery(
		stochasticProjectionOptions({
			queryKey: rangeQueryKey,
			request: rangeRequest,
			mapResult: stochasticResultToLocal,
		}),
		serverQueryClient(),
	);

	return {
		base,
		status: !enabled
			? ("disabled" as const)
			: missingModel ||
				  sourceError !== null ||
				  deterministic.isError ||
				  mappingErrorMessage !== null
				? ("error" as const)
				: sourcePending ||
					  deterministic.isPending ||
					  (overlayNeeded && overlay.isPending)
					? ("pending" as const)
					: ("success" as const),
		isPlaceholderData:
			deterministic.isPlaceholderData || overlay.isPlaceholderData,
		range: rangeQuery.data?.range ?? null,
		progress: rangeQuery.data?.progress ?? 0,
		rangeError: rangeQuery.error?.message ?? null,
		baseError,
		retryRange: () => {
			if (rangeEnabled) void rangeQuery.refetch();
		},
		retryProjection: () => {
			void deterministic.refetch();
			if (overlayNeeded) void overlay.refetch();
		},
		loading,
		abort: () => {
			void serverQueryClient().cancelQueries({
				queryKey: rangeQueryKey,
				exact: true,
			});
		},
	};
}
