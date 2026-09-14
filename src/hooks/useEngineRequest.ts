import { useEffect, useMemo, useRef, useState } from "react";
import { useProjectionEngine } from "@/engine/ProjectionEngineContext";
import type {
	EvaluationTables,
	FinancialModelDocument,
	ModelOverrides,
	ProjectionRuntimeSettings,
} from "@/lib/projection";
import { applyModelOverrides } from "@/lib/projection";
import {
	evaluationComputationDescriptor,
	projectionComputationSettings,
	simulationDocument,
} from "@/lib/projection/runtime/computationIdentity";
import type { ProjectionEngine } from "@/lib/projection/runtime/ProjectionEngine";
import type { IncomeDataSnapshot } from "@/lib/projection/types/income";
import { canonicalSerialize } from "@/lib/projection/utils/canonical";
import type { ProjectionHookState } from "./types";

function settingsKey(settings: ProjectionRuntimeSettings) {
	return canonicalSerialize(projectionComputationSettings(settings));
}

interface EngineTaskState<TResult, TProgress>
	extends ProjectionHookState<TResult, TProgress> {
	requestKey: string | null;
	resultBaseKey: string | null;
}

export interface EngineRequestInput {
	document: FinancialModelDocument;
	projectionSettings: ProjectionRuntimeSettings;
	overrides: ModelOverrides;
	incomeData?: IncomeDataSnapshot;
	signal: AbortSignal;
}

/**
 * Shared state machine for backend projection requests. Both deterministic
 * and stochastic hooks are thin wrappers: they supply request identity
 * (extraKey), readiness (active), execution, and result labeling.
 */
export function useEngineRequest<TResult, TProgress>(options: {
	document: FinancialModelDocument | null;
	projectionSettings: ProjectionRuntimeSettings;
	overrides: ModelOverrides;
	active: boolean;
	extraKey?: unknown;
	incomeData?: IncomeDataSnapshot;
	execute: (
		engine: ProjectionEngine,
		input: EngineRequestInput,
		onProgress: (progress: TProgress, partial?: TResult) => void,
	) => Promise<TResult>;
	labelResult: (result: TResult, evaluations: EvaluationTables) => TResult;
	labelProgress?: (
		progress: TProgress,
		evaluations: EvaluationTables,
	) => TProgress;
	failureMessage: string;
}): ProjectionHookState<TResult, TProgress> {
	const {
		document,
		projectionSettings,
		overrides,
		active,
		extraKey,
		incomeData,
		execute,
		labelResult,
		labelProgress,
		failureMessage,
	} = options;
	const engine = useProjectionEngine();
	const computationSettingsKey = settingsKey(projectionSettings);
	const computationSettingsRef = useRef<{
		key: string;
		value: ProjectionRuntimeSettings;
	} | null>(null);
	if (computationSettingsRef.current?.key !== computationSettingsKey) {
		computationSettingsRef.current = {
			key: computationSettingsKey,
			value: projectionComputationSettings(projectionSettings),
		};
	}
	const computationSettings = computationSettingsRef.current.value;
	const baseKey = useMemo(
		() =>
			canonicalSerialize({
				document: document
					? simulationDocument(applyModelOverrides(document, overrides))
					: null,
				fallbackProjectionStartDate:
					computationSettings.fallbackProjectionStartDate,
				horizonYears: computationSettings.horizonYears,
				extra: extraKey ?? null,
				active,
				incomeData: incomeData ?? null,
			}),
		[
			document,
			computationSettings.fallbackProjectionStartDate,
			computationSettings.horizonYears,
			overrides,
			extraKey,
			active,
			incomeData,
		],
	);
	const requestKey = useMemo(
		() =>
			canonicalSerialize({
				baseKey,
				evaluations: evaluationComputationDescriptor(
					computationSettings.evaluations,
				),
			}),
		[baseKey, computationSettings.evaluations],
	);
	const inputRef = useRef({ document, overrides, active, incomeData, execute });
	inputRef.current = { document, overrides, active, incomeData, execute };
	const [state, setState] = useState<EngineTaskState<TResult, TProgress>>({
		result: null,
		runtimeError: null,
		isRunning: false,
		progress: null,
		resultIsStale: false,
		requestKey: null,
		resultBaseKey: null,
	});

	useEffect(() => {
		const input = inputRef.current;
		if (!input.active || input.document === null) {
			setState({
				result: null,
				runtimeError: null,
				isRunning: false,
				progress: null,
				resultIsStale: false,
				requestKey,
				resultBaseKey: null,
			});
			return;
		}

		const controller = new AbortController();
		setState((current) => {
			const retainBaseResult =
				current.result !== null && current.resultBaseKey === baseKey;
			return {
				result: retainBaseResult ? current.result : null,
				runtimeError: null,
				isRunning: true,
				progress: null,
				resultIsStale: retainBaseResult,
				requestKey,
				resultBaseKey: retainBaseResult ? baseKey : null,
			};
		});

		input
			.execute(
				engine,
				{
					document: input.document,
					projectionSettings: computationSettings,
					overrides: input.overrides,
					incomeData: input.incomeData,
					signal: controller.signal,
				},
				(progress, partial) => {
					setState((current) =>
						current.requestKey === requestKey
							? {
									...current,
									progress,
									result: partial ?? current.result,
									resultBaseKey: partial ? baseKey : current.resultBaseKey,
									resultIsStale: partial ? false : current.resultIsStale,
								}
							: current,
					);
				},
			)
			.then((result) => {
				setState((current) =>
					current.requestKey === requestKey
						? {
								result,
								runtimeError: null,
								isRunning: false,
								progress: null,
								resultIsStale: false,
								requestKey,
								resultBaseKey: baseKey,
							}
						: current,
				);
			})
			.catch((err: unknown) => {
				if (err instanceof DOMException && err.name === "AbortError") return;
				setState((current) =>
					current.requestKey === requestKey
						? {
								...current,
								runtimeError:
									err instanceof Error ? err.message : failureMessage,
								isRunning: false,
								progress: null,
								resultIsStale: current.result !== null,
							}
						: current,
				);
			});

		return () => controller.abort();
	}, [baseKey, computationSettings, engine, requestKey, failureMessage]);
	const labeledResult = useMemo(
		() =>
			state.result
				? labelResult(state.result, projectionSettings.evaluations)
				: null,
		[state.result, projectionSettings.evaluations, labelResult],
	);
	const labeledProgress = useMemo(
		() =>
			state.progress && labelProgress
				? labelProgress(state.progress, projectionSettings.evaluations)
				: null,
		[state.progress, projectionSettings.evaluations, labelProgress],
	);

	if (state.requestKey !== requestKey) {
		const retainBaseResult =
			active && state.result !== null && state.resultBaseKey === baseKey;
		return {
			result: retainBaseResult ? labeledResult : null,
			runtimeError: null,
			isRunning: active && document !== null,
			progress: null,
			resultIsStale: retainBaseResult,
		};
	}
	return {
		result: labeledResult,
		runtimeError: state.runtimeError,
		isRunning: state.isRunning,
		progress: labeledProgress,
		resultIsStale: state.resultIsStale,
	};
}
