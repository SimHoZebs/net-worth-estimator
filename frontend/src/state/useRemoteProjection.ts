import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type ApiRequestOptions,
	createApiClient,
	type DeterministicProjectionRequest,
	type DeterministicProjectionResponse,
	type EvaluationResultEnvelope,
	type FinancialModelDocument,
	type IncomeDataSnapshot,
	type JsonValue,
	type MovementEvent,
	type ProjectionAccountSummary,
	type ProjectionResult,
	parseSSE,
	type StochasticProjectionRequest,
	type StochasticProjectionResult,
} from "../api/index.ts";
import { dateLabel, money, percent, todayIso } from "../domain/format.ts";
import type {
	OtherEvaluationProgress,
	Projection,
	RangeResult,
} from "../domain/result.ts";

export interface RemoteProjectionClient {
	projectDeterministic(
		request: DeterministicProjectionRequest,
		options?: ApiRequestOptions,
	): Promise<Error | DeterministicProjectionResponse>;
	projectStochastic(
		request: StochasticProjectionRequest,
		options?: ApiRequestOptions,
	): Promise<Error | Response>;
}

export interface UseRemoteProjectionOptions {
	client?: RemoteProjectionClient;
	document?: FinancialModelDocument | null;
	draftDocument?: FinancialModelDocument | null;
	years: number;
	ranges: boolean;
	authToken?: string;
	incomeData?: IncomeDataSnapshot | null;
	// When false the hook issues no requests. The saved-plan projection is
	// identical to the active one whenever there is no draft, so running it
	// separately would compute the same projection twice.
	enabled?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.length ? value : null;
}

function valueRecord(
	value: JsonValue | undefined,
): Record<string, unknown> | null {
	return isRecord(value) ? value : null;
}

function latestDate(values: string[]): string | null {
	return values.length
		? values.reduce((latest, value) => (value > latest ? value : latest))
		: null;
}

export function projectionStartDate(document: FinancialModelDocument): string {
	return (
		latestDate(document.checkpoints.map((checkpoint) => checkpoint.Date)) ??
		document.postings[0]?.startDate ??
		todayIso()
	);
}

export function projectionRequest(
	document: FinancialModelDocument,
	years: number,
	incomeData?: IncomeDataSnapshot | null,
): DeterministicProjectionRequest {
	const horizonYears = Number.isFinite(years)
		? Math.max(1, Math.trunc(years))
		: 1;
	return {
		document,
		settings: {
			fallbackProjectionStartDate: projectionStartDate(document),
			horizonYears,
			evaluations: document.evaluations,
		},
		...(incomeData ? { incomeData } : {}),
	};
}

function evaluationDate(
	envelope: EvaluationResultEnvelope | undefined,
): string | null {
	const deterministic = valueRecord(envelope?.deterministic);
	return stringValue(deterministic?.firstReachedDate);
}

function evaluationProbability(
	envelope: EvaluationResultEnvelope | undefined,
	key: string,
): number | null {
	const probabilistic = valueRecord(envelope?.probabilistic);
	const value = finite(probabilistic?.[key]);
	return value === null ? null : Math.max(0, Math.min(1, value));
}

// Both threshold-shaped evaluations (net worth threshold, account balance)
// share this instance shape, so one mapper serves each kind.
type EditableEvaluation = {
	instanceId: string;
	name: string;
	enabled: boolean;
	config: JsonValue;
};

// An evaluation whose envelope is missing is named indeterminate rather than
// reported as unmet, so an unevaluated evaluation is never shown as a failure.
function evaluatedEvaluation(
	evaluation: EditableEvaluation,
	envelope: EvaluationResultEnvelope | undefined,
) {
	const represented =
		envelope?.status === "satisfied" || envelope?.status === "not-satisfied";
	const name = evaluation.name || evaluation.instanceId;
	return {
		name: represented ? name : `${name} (indeterminate)`,
		firstDate: represented ? evaluationDate(envelope) : null,
	};
}

function thresholdEvaluation(
	evaluation: EditableEvaluation,
	envelope: EvaluationResultEnvelope | undefined,
	current: number,
	final: number,
) {
	const config = valueRecord(evaluation.config);
	const { name, firstDate } = evaluatedEvaluation(evaluation, envelope);
	return {
		evaluation: {
			id: evaluation.instanceId,
			name,
			kind: "net-worth" as const,
			target: finite(config?.target) ?? 0,
			accountId: null,
			enabled: evaluation.enabled,
		},
		firstDate,
		current,
		final,
	};
}

function balanceEvaluation(
	evaluation: EditableEvaluation,
	envelope: EvaluationResultEnvelope | undefined,
	balances: Map<string, ProjectionAccountSummary>,
) {
	const config = valueRecord(evaluation.config);
	const accountId =
		typeof config?.accountId === "string" ? config.accountId : null;
	const { name, firstDate } = evaluatedEvaluation(evaluation, envelope);
	const summary = accountId === null ? undefined : balances.get(accountId);
	return {
		evaluation: {
			id: evaluation.instanceId,
			name,
			kind: "reserve" as const,
			target: finite(config?.target) ?? 0,
			accountId,
			enabled: evaluation.enabled,
		},
		firstDate,
		current: summary?.startingBalance ?? 0,
		final: summary?.endingBalance ?? 0,
	};
}

function arrayValue(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value)
		? value.filter((item): item is Record<string, unknown> => isRecord(item))
		: [];
}

interface OtherOutcome {
	goal: string | null;
	outcomeDate: string | null;
	outcomeText: string;
	qualifier: string | null;
	progress: OtherEvaluationProgress | null;
}

function fiOutcome(
	deterministic: Record<string, unknown> | null,
	config: Record<string, unknown> | null,
): OtherOutcome {
	const expenseTarget = finite(config?.annualExpenseTarget);
	const goal =
		expenseTarget !== null && expenseTarget > 0
			? `${money(expenseTarget)}/yr spending`
			: null;
	const evaluationYears =
		Math.trunc(finite(config?.evaluationYears) ?? 0) || null;
	const unresolved: OtherOutcome = {
		goal,
		outcomeDate: null,
		outcomeText: "Beyond this horizon",
		qualifier: null,
		progress: null,
	};
	if (!deterministic) return unresolved;
	const milestones = valueRecord(
		deterministic.milestones as JsonValue | undefined,
	);
	const sustaining = stringValue(milestones?.firstSelfSustainingDate);
	if (sustaining)
		return {
			goal,
			outcomeDate: sustaining,
			outcomeText: "Satisfied",
			qualifier: null,
			progress: null,
		};
	const coverage = stringValue(milestones?.firstCoverageDate);
	if (coverage) {
		const runOutcomes = arrayValue(deterministic.runOutcomes);
		const outcome = runOutcomes.find(
			(item) => stringValue(item.candidateDate) === coverage,
		);
		const shortfallDate = stringValue(outcome?.firstShortfallDate);
		return {
			goal,
			outcomeDate: coverage,
			outcomeText: "Covered",
			qualifier: shortfallDate
				? `Shortfall from ${dateLabel(shortfallDate)}`
				: evaluationYears
					? `Not sustained over ${evaluationYears} years`
					: "Not sustained",
			progress: null,
		};
	}
	const rows = arrayValue(deterministic.rows);
	const first = rows[0];
	const firstExpenseTarget =
		(first ? finite(first.annualExpenseTarget) : null) ?? expenseTarget;
	if (!first || firstExpenseTarget === null || firstExpenseTarget <= 0)
		return {
			...unresolved,
			qualifier:
				!first && evaluationYears
					? `No ${evaluationYears}-year window fits`
					: null,
		};
	const fraction = Math.max(0, finite(first.coverageRatio) ?? 0);
	const capacity = finite(first.totalAnnualCapacity) ?? 0;
	return {
		...unresolved,
		progress: {
			fraction,
			current: money(capacity),
			share: percent(fraction),
		},
	};
}

function postingOutcome(
	deterministic: Record<string, unknown> | null,
): OtherOutcome {
	const fulfilled: OtherOutcome = {
		goal: null,
		outcomeDate: null,
		outcomeText: "Fully fulfilled",
		qualifier: null,
		progress: null,
	};
	if (!deterministic) return fulfilled;
	const firstDate = stringValue(deterministic.firstUnderfulfilledDate);
	if (!firstDate) return fulfilled;
	const completion = finite(deterministic.completionRate);
	return {
		...fulfilled,
		outcomeDate: firstDate,
		outcomeText: "Shortfall",
		progress:
			completion !== null && completion >= 0
				? { fraction: completion, current: percent(completion), share: null }
				: null,
	};
}

function cycleOutcome(
	deterministic: Record<string, unknown> | null,
): OtherOutcome {
	const within = deterministic?.withinBudget === true;
	const base: OtherOutcome = {
		goal: null,
		outcomeDate: null,
		outcomeText: within ? "Within budget" : "Over budget",
		qualifier: null,
		progress: null,
	};
	const spent = finite(deterministic?.spent);
	const budget = finite(deterministic?.budget);
	if (spent === null || budget === null || budget <= 0) return base;
	const fraction = Math.max(0, spent / budget);
	return {
		...base,
		progress: {
			fraction,
			current: money(spent),
			share: `${Math.round(fraction * 100)}%`,
		},
	};
}

function movementName(
	event: MovementEvent,
	document: FinancialModelDocument | null,
): string {
	return (
		document?.postings.find((posting) => posting.id === event.origin.postingId)
			?.name || event.origin.postingId
	);
}

function movementEndpoints(
	event: MovementEvent,
	document: FinancialModelDocument | null,
): { fromId: string | null; toId: string | null } {
	const deltas = event.accountDeltas ?? [];
	const negative = deltas.find((delta) => delta.delta < 0)?.accountId ?? null;
	const positive = deltas.find((delta) => delta.delta > 0)?.accountId ?? null;
	const posting = document?.postings.find(
		(item) => item.id === event.origin.postingId,
	);
	return {
		fromId: posting?.sourceAccountId ?? negative,
		toId: posting?.destinations?.[0] ?? positive,
	};
}

type ServerMovementEvent = MovementEvent & {
	bindingConstraints?: JsonValue;
	availableAmount?: unknown;
};

function movementConstraintTypes(event: ServerMovementEvent): string[] {
	if (!Array.isArray(event.bindingConstraints)) return [];
	return event.bindingConstraints.flatMap((value) => {
		const type = stringValue(valueRecord(value)?.type);
		return type ? [type] : [];
	});
}

function movementConstraintLabel(type: string): string {
	switch (type) {
		case "source-floor":
			return "Protected account balance";
		case "destination-ceiling":
			return "Destination account ceiling";
		case "action-limit":
			return "Annual transaction limit";
		case "source-unavailable":
			return "Funding account unavailable";
		default:
			return type
				.split("-")
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join(" ");
	}
}

function movementEvidence(
	event: MovementEvent,
	constrained: boolean,
): {
	available: number | null;
	constraint: string | null;
	constraintTypes?: string[];
} {
	const serverEvent = event as ServerMovementEvent;
	const types = movementConstraintTypes(serverEvent);
	return {
		available: finite(serverEvent.availableAmount),
		constraint: types.length
			? movementConstraintLabel(types[0]!)
			: constrained
				? "Backend funding constraint"
				: null,
		...(types.length ? { constraintTypes: types } : {}),
	};
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
	const movements = (result.movementEvents ?? [])
		.filter(
			(event) =>
				event.date > projectionStartDate ||
				(event.date === projectionStartDate && !startCheckpoint),
		)
		.map((event) => {
			const endpoints = movementEndpoints(event, document);
			const constrained = event.realizedAmount + 0.01 < event.requestedAmount;
			const evidence = movementEvidence(event, constrained);
			return {
				date: event.date,
				movementId: event.origin.postingId,
				name: movementName(event, document),
				requested: event.requestedAmount,
				realized: event.realizedAmount,
				fromId: endpoints.fromId,
				toId: endpoints.toId,
				accountDeltas: event.accountDeltas ?? [],
				...evidence,
			};
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
	const otherEvaluations = [
		...(document?.evaluations.financialIndependence ?? []).map((evaluation) => {
			const config = valueRecord(evaluation.config);
			const outcome = fiOutcome(
				valueRecord(
					result.evaluations.financialIndependence.find(
						(item) => item.instanceId === evaluation.instanceId,
					)?.deterministic,
				),
				config,
			);
			return {
				id: evaluation.instanceId,
				name: evaluation.name || evaluation.instanceId,
				type: "financialIndependence" as const,
				enabled: evaluation.enabled,
				status:
					result.evaluations.financialIndependence.find(
						(item) => item.instanceId === evaluation.instanceId,
					)?.status ?? "indeterminate",
				...outcome,
			};
		}),
		...(document?.evaluations.postingFulfillment ?? []).map((evaluation) => ({
			id: evaluation.instanceId,
			name: evaluation.name || evaluation.instanceId,
			type: "postingFulfillment" as const,
			enabled: evaluation.enabled,
			status:
				result.evaluations.postingFulfillment.find(
					(item) => item.instanceId === evaluation.instanceId,
				)?.status ?? "indeterminate",
			...postingOutcome(
				valueRecord(
					result.evaluations.postingFulfillment.find(
						(item) => item.instanceId === evaluation.instanceId,
					)?.deterministic,
				),
			),
		})),
		...(document?.evaluations.cycleFulfillment ?? []).map((evaluation) => ({
			id: evaluation.instanceId,
			name: evaluation.name || evaluation.instanceId,
			type: "cycleFulfillment" as const,
			enabled: evaluation.enabled,
			status:
				(result.evaluations.cycleFulfillment ?? []).find(
					(item) => item.instanceId === evaluation.instanceId,
				)?.status ?? "indeterminate",
			...cycleOutcome(
				valueRecord(
					(result.evaluations.cycleFulfillment ?? []).find(
						(item) => item.instanceId === evaluation.instanceId,
					)?.deterministic,
				),
			),
		})),
	];
	return {
		points,
		currentNetWorth: result.summary.currentNetWorth,
		movements,
		firstFailure:
			movements.find((movement) => movement.constraint !== null) ?? null,
		evaluations,
		otherEvaluations,
		inflows: result.totals.externalInflowAmount,
		outflows: result.totals.externalOutflowAmount,
		transfers: result.totals.internalTransferAmount,
		startDateHasCheckpoint: startCheckpoint,
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
		failureShare:
			fulfillmentProbability === null ? 0 : 1 - fulfillmentProbability,
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

function progressValue(value: number): number {
	return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function randomRunCount(): number {
	return 400;
}

export function useRemoteProjection({
	client,
	document,
	draftDocument,
	years,
	ranges,
	authToken,
	incomeData,
	enabled = true,
}: UseRemoteProjectionOptions) {
	const api = useMemo(() => client ?? createApiClient(), [client]);
	const activeDocument = draftDocument ?? document ?? null;
	const documentKey = activeDocument ? JSON.stringify(activeDocument) : "null";
	const incomeDataKey = incomeData ? JSON.stringify(incomeData) : "null";
	const activeDocumentRef = useRef(activeDocument);
	const incomeDataRef = useRef(incomeData ?? null);
	activeDocumentRef.current = activeDocument;
	incomeDataRef.current = incomeData ?? null;
	const [base, setBase] = useState<Projection | Error | null>(null);
	const [range, setRange] = useState<RangeResult | null>(null);
	const [progress, setProgress] = useState(0);
	const [rangeError, setRangeError] = useState<string | null>(null);
	const [baseError, setBaseError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [deterministicAttempt, setDeterministicAttempt] = useState(0);
	const [rangeAttempt, setRangeAttempt] = useState(0);
	const mounted = useRef(true);
	const deterministicController = useRef<AbortController | null>(null);
	const rangeController = useRef<AbortController | null>(null);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			deterministicController.current?.abort();
			rangeController.current?.abort();
		};
	}, []);

	useEffect(() => {
		const current = enabled ? activeDocumentRef.current : null;
		const controller = new AbortController();
		deterministicController.current?.abort();
		deterministicController.current = controller;
		if (!current) {
			setBase(
				new Error(
					"No server financial model is available for projection. Load or replace a model before calculating.",
				),
			);
			setBaseError(
				"No server financial model is available for projection. Load or replace a model before calculating.",
			);
			setLoading(false);
			return () => controller.abort();
		}
		// Stale-while-revalidate: keep the previous base visible while the next
		// deterministic result loads. Only the initial load (base === null)
		// shows the full-screen loader; refetches render stale content with
		// loading=true so per-page gates can show an inline updating notice.
		setLoading(true);
		setBaseError(null);
		const failBase = (message: string) => {
			setBaseError(message);
			setBase((previous) =>
				previous && !(previous instanceof Error)
					? previous
					: new Error(message),
			);
			setLoading(false);
		};
		const request = projectionRequest(current, years, incomeDataRef.current);
		void Promise.resolve()
			.then(() =>
				api.projectDeterministic(request, {
					authToken,
					signal: controller.signal,
				}),
			)
			.then((response) => {
				if (!mounted.current || controller.signal.aborted) return;
				if (response instanceof Error) {
					failBase(response.message);
					return;
				}
				const responseError = projectionResponseError(response);
				if (responseError) {
					failBase(responseError.message);
					return;
				}
				if (!response.result) {
					failBase(
						"The server returned no deterministic projection result. Retry the request.",
					);
					return;
				}
				try {
					setBase(projectionResultToLocal(response.result, current));
					setBaseError(null);
				} catch (cause) {
					failBase(
						cause instanceof Error
							? cause.message
							: "The deterministic projection could not be mapped for display.",
					);
					return;
				}
				setLoading(false);
			})
			.catch((cause: unknown) => {
				if (!mounted.current || controller.signal.aborted) return;
				failBase(
					cause instanceof Error
						? cause.message
						: "The deterministic projection request failed. Retry the connection.",
				);
			});
		return () => controller.abort();
	}, [
		api,
		authToken,
		deterministicAttempt,
		documentKey,
		enabled,
		incomeDataKey,
		years,
	]);

	useEffect(() => {
		const current = enabled ? activeDocumentRef.current : null;
		if (!ranges || !current) {
			rangeController.current?.abort();
			setRange(null);
			setProgress(0);
			setRangeError(null);
			return () => rangeController.current?.abort();
		}
		const controller = new AbortController();
		rangeController.current?.abort();
		rangeController.current = controller;
		setRange(null);
		setProgress(0);
		setRangeError(null);
		let receivedResult = false;
		let receivedError = false;
		const request: StochasticProjectionRequest = {
			...projectionRequest(current, years, incomeDataRef.current),
			config: { runCount: randomRunCount(), seed: 42 },
		};
		void Promise.resolve()
			.then(() =>
				api.projectStochastic(request, {
					authToken,
					signal: controller.signal,
				}),
			)
			.then(async (response) => {
				if (!mounted.current || controller.signal.aborted) return;
				if (response instanceof Error) {
					setRangeError(response.message);
					return;
				}
				const parseResult = await parseSSE(
					response,
					{
						onProgress: (data) => {
							if (!mounted.current || controller.signal.aborted) return;
							setProgress(progressValue(data.progress.fraction));
						},
						onPartial: (data) => {
							if (!mounted.current || controller.signal.aborted) return;
							setProgress(progressValue(data.progress.fraction));
							setRange(stochasticResultToLocal(data.partial));
						},
						onResult: (data) => {
							if (!mounted.current || controller.signal.aborted) return;
							receivedResult = true;
							setProgress(1);
							setRange(stochasticResultToLocal(data.result));
							setRangeError(null);
						},
						onError: (data) => {
							if (!mounted.current || controller.signal.aborted) return;
							receivedError = true;
							setRangeError(data.error);
						},
					},
					controller.signal,
				);
				if (!mounted.current || controller.signal.aborted) return;
				if (parseResult && !receivedResult && !receivedError)
					setRangeError(parseResult.message);
				if (!parseResult && !receivedResult && !receivedError)
					setRangeError(
						"The range stream ended before returning a result. Retry the calculation.",
					);
			})
			.catch((cause: unknown) => {
				if (!mounted.current || controller.signal.aborted) return;
				setRangeError(
					cause instanceof Error
						? cause.message
						: "The range request failed. Retry the calculation.",
				);
			});
		return () => controller.abort();
	}, [
		api,
		authToken,
		documentKey,
		enabled,
		incomeDataKey,
		rangeAttempt,
		ranges,
		years,
	]);

	const abort = useCallback(() => {
		deterministicController.current?.abort();
		rangeController.current?.abort();
	}, []);

	return {
		base,
		range,
		progress,
		rangeError,
		baseError,
		retryRange: () => setRangeAttempt((value) => value + 1),
		retryProjection: () => setDeterministicAttempt((value) => value + 1),
		loading,
		abort,
	};
}
