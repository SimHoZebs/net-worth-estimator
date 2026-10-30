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
	type FinancialModelDocument,
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
import { useProjectionDocument } from "./useProjectionDocument.ts";
import { projectionStartDate } from "./projectionStartDate.ts";
export { projectionStartDate } from "./projectionStartDate.ts";
import { purchaseEvaluationResult } from "./purchaseEvaluation.ts";
import { stochasticProjectionOptions } from "./stochasticProjectionQuery.ts";

export interface ProjectionDateRange {
	startDate?: string;
	endDate?: string;
}

export interface UseRemoteProjectionOptions {
	document?: FinancialModelDocument | null;
	years?: number;
	ranges?: boolean;
	// Request-local evaluation scope. It participates in document/cache identity.
	evaluations?: EvaluationTables;
	// Requested timeline slice. Undefined keeps the full span the hook has
	// always fetched: everything through the horizon end.
	dateRange?: ProjectionDateRange;
	// When false the hook issues no requests.
	enabled?: boolean;
}

const MISSING_DOCUMENT_MESSAGE =
	"No server financial model is available for projection. Load or replace a model before calculating.";

async function fetchDeterministicResult(
	document: FinancialModelDocument,
	years: number,
	range: ProjectionDateRange,
	signal: AbortSignal,
): Promise<ProjectionResult> {
	const request: DeterministicProjectionRequest = {
		...projectionRequest(document, years),
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
	document: FinancialModelDocument,
	years: number,
): Omit<DeterministicProjectionRequest, "document"> {
	const horizonYears = Number.isFinite(years)
		? Math.max(1, Math.trunc(years))
		: 1;
	return {
		settings: {
			fallbackProjectionStartDate: projectionStartDate(document),
			horizonYears,
			evaluations: document.evaluations,
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
	document: FinancialModelDocument,
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
				start: projectionStartDate(document),
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
	accountSummaries: ProjectionResult["accountSummaries"],
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
	if (first)
		return Object.fromEntries(
			accountSummaries.map((summary) => [
				summary.accountId,
				summary.startingBalance,
			]),
		);
	if (last)
		return Object.fromEntries(
			accountSummaries.map((summary) => [
				summary.accountId,
				summary.endingBalance,
			]),
		);
	return {};
}

export function projectionResultToLocal(
	result: ProjectionResult,
	document: FinancialModelDocument | null,
	horizonYears?: number,
): Projection {
	const rows = result.timeline.rows;
	const points = rows.length
		? rows.map((row, index) => ({
				date: row.date,
				total: row.netWorth,
				balances: rowBalances(
					row,
					result.accountSummaries,
					index === 0,
					index === rows.length - 1,
				),
			}))
		: [
				{
					date: result.milestones.projectionStartDate,
					total: result.summary.currentNetWorth,
					balances: Object.fromEntries(
						result.accountSummaries.map((summary) => [
							summary.accountId,
							summary.startingBalance,
						]),
					),
				},
			];
	const projectionStartDate = result.milestones.projectionStartDate;
	const startCheckpoint =
		document?.checkpoints.some(
			(checkpoint) => checkpoint.Date === projectionStartDate,
		) ?? false;
	const transactions = projectionTransactions(result, document);
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
	const evaluations = [
		...(document?.evaluations.netWorthThreshold ?? [])
			.filter((evaluation) => evaluation.enabled)
			.map((evaluation) =>
				thresholdEvaluation(
					evaluation,
					thresholdByID.get(evaluation.instanceId),
					result.summary.currentNetWorth,
					result.summary.finalNetWorth,
				),
			),
		...(document?.evaluations.accountBalance ?? [])
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
		...(document?.evaluations.financialIndependence ?? []).map((evaluation) =>
			OTHER_EVAL_OUTCOME_RENDERERS.financialIndependence(evaluation, {
				envelope: result.evaluations.financialIndependence.find(
					(item) => item.instanceId === evaluation.instanceId,
				),
				postingIds: null,
				enabled: evaluation.enabled,
				document,
				projectionStartDate,
				horizonEndDate: horizonEnd,
			}),
		),
		...(document?.evaluations.postingFulfillment ?? []).map((evaluation) =>
			OTHER_EVAL_OUTCOME_RENDERERS.postingFulfillment(evaluation, {
				envelope: result.evaluations.postingFulfillment.find(
					(item) => item.instanceId === evaluation.instanceId,
				),
				postingIds: Array.isArray(valueRecord(evaluation.config)?.postingIds)
					? (valueRecord(evaluation.config)!.postingIds as string[])
					: null,
				enabled: evaluation.enabled,
			}),
		),
		...(document?.evaluations.cycleFulfillment ?? []).map((evaluation) =>
			OTHER_EVAL_OUTCOME_RENDERERS.cycleFulfillment(evaluation, {
				envelope: (result.evaluations.cycleFulfillment ?? []).find(
					(item) => item.instanceId === evaluation.instanceId,
				),
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
			transactions.find((transaction) => transaction.constraint !== null) ?? null,
		evaluations,
		otherEvaluations,
		inflows: result.totals.externalInflowAmount,
		outflows: result.totals.externalOutflowAmount,
		transfers: result.totals.internalTransferAmount,
		startDateHasCheckpoint: startCheckpoint,
		plannedPurchases: purchaseEvaluationResult(
			result.evaluations,
			document?.evaluations,
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

export function useRemoteProjection({
	document: documentOverride,
	years: yearsOverride,
	ranges: rangesOverride,
	evaluations: evaluationsOverride,
	dateRange: dateRangeOverride,
	enabled = true,
}: UseRemoteProjectionOptions = {}) {
	const { activeDocument, baseDocument, baseKey, evalKey } =
		useProjectionDocument({
			document: documentOverride,
			evaluations: evaluationsOverride,
		});
	const storeYears = useUiStore((state) => state.years);
	const storeRanges = useUiStore((state) => state.ranges);
	const years = yearsOverride ?? storeYears;
	const ranges = rangesOverride ?? storeRanges;
	// The eval/view scope layers onto the plan without rewriting it, so the
	// base simulation keys on plan data alone. Eval/view changes (toggles,
	// statement day, account selection) only move the overlay key below.
	const overlayNeeded =
		evaluationsOverride !== undefined &&
		baseDocument !== null &&
		activeDocument !== null;
	// The requested slice participates in cache identity alongside the
	// document: different ranges hold different payloads.
	const effectiveRange = useMemo(
		() =>
			baseDocument
				? resolveProjectionRange(baseDocument, years, dateRangeOverride)
				: null,
		[baseDocument, years, dateRangeOverride],
	);
	const rangeKey = effectiveRange ? projectionRangeKey(effectiveRange) : "";
	const hasDocument = baseDocument !== null;
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
	// Base path: plan data only. Eval/view preference changes never move
	// this key, so the cached simulation (and its mapped path) is reused.
	const deterministic = useQuery({
		queryKey: deterministicQueryKey(baseKey, years, rangeKey),
		queryFn: ({ signal, queryKey }) => {
			const current = baseDocument;
			if (!current) throw new Error(MISSING_DOCUMENT_MESSAGE);
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
		enabled: enabled && hasDocument,
		placeholderData: keepPreviousData,
		retry: false,
	});
	// Eval overlay: request-local evaluations layered onto the cached base
	// path. Shares the base timeline; only envelope identity changes.
	const overlay = useQuery({
		queryKey: evalOverlayQueryKey(baseKey, evalKey, years, rangeKey),
		queryFn: ({ signal, queryKey }) => {
			const current = activeDocument;
			if (!current) throw new Error(MISSING_DOCUMENT_MESSAGE);
			const range = effectiveRange ?? resolveProjectionRange(current, years);
			return fetchDeterministicResult(current, years, range, signal).catch(
				(cause: unknown) => {
					notifyDeterministicError(queryKey, cause);
					throw cause;
				},
			);
		},
		enabled: enabled && hasDocument && overlayNeeded,
		placeholderData: keepPreviousData,
		retry: false,
	});
	const missingDocument = enabled && !hasDocument;
	const missingError = useMemo(() => new Error(MISSING_DOCUMENT_MESSAGE), []);
	// Map the cached path locally: without an overlay the base document
	// carries its own evaluations; with one, the base path renders instantly
	// while the overlay envelopes arrive progressively underneath.
	const mapped = useMemo((): {
		projection: Projection | null;
		error: string | null;
	} => {
		const raw = deterministic.data ?? null;
		if (!raw || !baseDocument) return { projection: null, error: null };
		const horizonYears = projectionRequest(baseDocument, years).settings
			.horizonYears;
		try {
			if (!overlayNeeded || !activeDocument) {
				return {
					projection: projectionResultToLocal(raw, baseDocument, horizonYears),
					error: null,
				};
			}
			const overlaid = overlay.data ?? null;
			if (!overlaid) {
				return {
					projection: projectionResultToLocal(raw, baseDocument, horizonYears),
					error: null,
				};
			}
			return {
				projection: projectionResultToLocal(
					mergeEvaluationResults(raw, overlaid),
					activeDocument,
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
		baseDocument,
		activeDocument,
		overlayNeeded,
		years,
	]);
	// Failures resolve with fetching false, so an error under load is
	// superseded by the pending skeletons instead of flashing stale errors.
	const base: Projection | Error | null = missingDocument
		? missingError
		: (mapped.projection ?? null);
	const overlayErrorMessage =
		overlayNeeded && overlay.error
			? (overlay.error.message ??
				"The evaluation overlay request failed. Retry the connection.")
			: null;
	const mappingErrorMessage = mapped.error;
	const baseError =
		missingDocument ||
		(deterministic.error === null &&
			!overlayErrorMessage &&
			!mappingErrorMessage)
			? missingDocument
				? MISSING_DOCUMENT_MESSAGE
				: null
			: (deterministic.error?.message ??
				overlayErrorMessage ??
				mappingErrorMessage ??
				"The deterministic projection request failed. Retry the connection.");
	const loading = deterministic.isFetching || overlay.isFetching;
	const runCount = randomRunCount();
	const seed = 42;
	// Ranges derive from the base path. Eval/view preferences never move this
	// key: overlay envelopes describe single-path outcomes, not bands.
	const rangeEnabled = enabled && ranges && baseDocument !== null;
	// A disabled observer must detach from the active stream, so the last
	// real subscriber leaving lets Query cancel its signal.
	const rangeQueryKey = rangeEnabled
		? stochasticQueryKey(baseKey, years, runCount, seed, 0)
		: ["stochastic-projection-disabled"];
	const rangeRequest: StochasticProjectionRequest | null =
		rangeEnabled && baseDocument
			? {
					...projectionRequest(baseDocument, years),
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
			: missingDocument || deterministic.isError || mappingErrorMessage !== null
				? ("error" as const)
				: deterministic.isPending || (overlayNeeded && overlay.isPending)
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
