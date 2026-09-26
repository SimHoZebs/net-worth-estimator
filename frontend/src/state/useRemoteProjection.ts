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
import type { Projection, RangeResult } from "../domain/projection.ts";

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
		new Date().toISOString().slice(0, 10)
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

// Both goal-shaped evaluations (net worth threshold, account balance) share
// this instance shape, so one mapper serves each kind.
type GoalEvaluation = {
	instanceId: string;
	label: string;
	enabled: boolean;
	config: JsonValue;
};

// A goal whose evaluation produced no envelope is labelled indeterminate rather
// than reported as unmet, so an unevaluated goal is never shown as a failure.
function evaluatedGoal(
	evaluation: GoalEvaluation,
	envelope: EvaluationResultEnvelope | undefined,
) {
	const represented =
		envelope?.status === "satisfied" || envelope?.status === "not-satisfied";
	const label = evaluation.label || evaluation.instanceId;
	return {
		name: represented ? label : `${label} (indeterminate)`,
		firstDate: represented ? evaluationDate(envelope) : null,
	};
}

function thresholdGoal(
	evaluation: GoalEvaluation,
	envelope: EvaluationResultEnvelope | undefined,
	current: number,
	final: number,
) {
	const config = valueRecord(evaluation.config);
	const { name, firstDate } = evaluatedGoal(evaluation, envelope);
	return {
		goal: {
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

function balanceGoal(
	evaluation: GoalEvaluation,
	envelope: EvaluationResultEnvelope | undefined,
	balances: Map<string, ProjectionAccountSummary>,
) {
	const config = valueRecord(evaluation.config);
	const accountId =
		typeof config?.accountId === "string" ? config.accountId : null;
	const { name, firstDate } = evaluatedGoal(evaluation, envelope);
	const summary = accountId === null ? undefined : balances.get(accountId);
	return {
		goal: {
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

function movementName(
	event: MovementEvent,
	document: FinancialModelDocument | null,
): string {
	return (
		document?.postings.find((posting) => posting.id === event.origin.postingId)
			?.label || event.origin.postingId
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
			return "Annual movement limit";
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
	const goals = [
		...(document?.evaluations.netWorthThreshold ?? [])
			.filter((evaluation) => evaluation.enabled)
			.map((evaluation) =>
				thresholdGoal(
					evaluation,
					thresholdByID.get(evaluation.instanceId),
					result.summary.currentNetWorth,
					result.summary.finalNetWorth,
				),
			),
		...(document?.evaluations.accountBalance ?? [])
			.filter((evaluation) => evaluation.enabled)
			.map((evaluation) =>
				balanceGoal(
					evaluation,
					balanceByID.get(evaluation.instanceId),
					balances,
				),
			),
	];
	return {
		points,
		currentNetWorth: result.summary.currentNetWorth,
		movements,
		firstFailure:
			movements.find((movement) => movement.constraint !== null) ?? null,
		goals,
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
	const goalSuccess: Record<string, number> = {};
	for (const evaluation of result.evaluations.netWorthThreshold) {
		const probability = evaluationProbability(evaluation, "probability");
		if (probability !== null) goalSuccess[evaluation.instanceId] = probability;
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
		goalSuccess,
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
		const current = activeDocumentRef.current;
		const controller = new AbortController();
		deterministicController.current?.abort();
		deterministicController.current = controller;
		if (!current) {
			setBase(
				new Error(
					"No server financial model is available for projection. Load or replace a model before calculating.",
				),
			);
			setLoading(false);
			return () => controller.abort();
		}
		setBase(null);
		setLoading(true);
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
					setBase(response);
					setLoading(false);
					return;
				}
				const responseError = projectionResponseError(response);
				if (responseError) {
					setBase(responseError);
					setLoading(false);
					return;
				}
				if (!response.result) {
					setBase(
						new Error(
							"The server returned no deterministic projection result. Retry the request.",
						),
					);
					setLoading(false);
					return;
				}
				try {
					setBase(projectionResultToLocal(response.result, current));
				} catch (cause) {
					setBase(
						cause instanceof Error
							? cause
							: new Error(
									"The deterministic projection could not be mapped for display.",
								),
					);
				}
				setLoading(false);
			})
			.catch((cause: unknown) => {
				if (!mounted.current || controller.signal.aborted) return;
				setBase(
					cause instanceof Error
						? cause
						: new Error(
								"The deterministic projection request failed. Retry the connection.",
							),
				);
				setLoading(false);
			});
		return () => controller.abort();
	}, [api, authToken, deterministicAttempt, documentKey, incomeDataKey, years]);

	useEffect(() => {
		const current = activeDocumentRef.current;
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
	}, [api, authToken, documentKey, incomeDataKey, rangeAttempt, ranges, years]);

	const abort = useCallback(() => {
		deterministicController.current?.abort();
		rangeController.current?.abort();
	}, []);

	return {
		base,
		range,
		progress,
		rangeError,
		retryRange: () => setRangeAttempt((value) => value + 1),
		retryProjection: () => setDeterministicAttempt((value) => value + 1),
		loading,
		abort,
	};
}
