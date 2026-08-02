import { useEffect, useMemo, useRef, useState } from "react";
import { useProjectionEngine } from "@/engine/ProjectionEngineContext";
import type {
	FinancialModelDocument,
	ModelOverrides,
	ProjectionRuntimeSettings,
	StochasticConfig,
	StochasticProgress,
	StochasticProjectionResult,
} from "@/lib/projection";
import { applyModelOverrides } from "@/lib/projection";
import { canonicalSerialize } from "@/lib/projection/artifacts";
import {
	evaluationComputationDescriptor,
	projectionComputationSettings,
	simulationDocument,
} from "@/lib/projection/runtime/computationIdentity";
import type { IncomeDataSnapshot } from "@/lib/projection/types/income";
import { normalizeStochasticConfig } from "@/lib/projection/utils/stochastic";
import {
	labelStochasticProgress,
	labelStochasticResult,
	projectionComputationSettingsKey,
} from "./projectionComputationSettings";
import type { ProjectionHookState } from "./types";

interface StochasticState
	extends ProjectionHookState<StochasticProjectionResult, StochasticProgress> {
	requestKey: string | null;
	resultBaseKey: string | null;
}

function publicState(
	state: StochasticState,
	evaluations: ProjectionRuntimeSettings["evaluations"],
): ProjectionHookState<StochasticProjectionResult, StochasticProgress> {
	return {
		result: state.result
			? labelStochasticResult(state.result, evaluations)
			: null,
		runtimeError: state.runtimeError,
		isRunning: state.isRunning,
		progress: state.progress
			? labelStochasticProgress(state.progress, evaluations)
			: null,
		resultIsStale: state.resultIsStale,
	};
}

export function useStochastic(
	document: FinancialModelDocument | null,
	projectionSettings: ProjectionRuntimeSettings,
	overrides: ModelOverrides,
	config: StochasticConfig | null,
	enabled: boolean,
	incomeData?: IncomeDataSnapshot,
): ProjectionHookState<StochasticProjectionResult, StochasticProgress> {
	const engine = useProjectionEngine();
	const computationSettingsKey =
		projectionComputationSettingsKey(projectionSettings);
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
	const runCount = config?.runCount ?? null;
	const seed = config?.seed ?? null;
	const stableConfig = useMemo(
		() =>
			runCount === null ? null : normalizeStochasticConfig({ runCount, seed }),
		[runCount, seed],
	);
	const baseKey = useMemo(
		() =>
			canonicalSerialize({
				document: document
					? simulationDocument(applyModelOverrides(document, overrides))
					: null,
				fallbackProjectionStartDate:
					computationSettings.fallbackProjectionStartDate,
				horizonYears: computationSettings.horizonYears,
				config: stableConfig,
				enabled,
				incomeData: incomeData ?? null,
			}),
		[
			document,
			computationSettings.fallbackProjectionStartDate,
			computationSettings.horizonYears,
			overrides,
			stableConfig,
			enabled,
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
	const inputRef = useRef({
		document,
		overrides,
		enabled,
		stableConfig,
		incomeData,
	});
	inputRef.current = { document, overrides, enabled, stableConfig, incomeData };
	const [state, setState] = useState<StochasticState>({
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
		if (
			!input.enabled ||
			input.document === null ||
			input.stableConfig === null
		) {
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

		engine
			.projectStochastic(
				{
					document: input.document,
					projectionSettings: computationSettings,
					overrides: input.overrides,
					config: input.stableConfig,
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
									err instanceof Error
										? err.message
										: "Stochastic simulation failed.",
								isRunning: false,
								progress: null,
								resultIsStale: current.result !== null,
							}
						: current,
				);
			});

		return () => controller.abort();
	}, [baseKey, computationSettings, engine, requestKey]);

	if (state.requestKey !== requestKey) {
		const retainBaseResult =
			enabled && state.result !== null && state.resultBaseKey === baseKey;
		return {
			result: retainBaseResult
				? labelStochasticResult(state.result!, projectionSettings.evaluations)
				: null,
			runtimeError: null,
			isRunning: enabled && document !== null && config !== null,
			progress: null,
			resultIsStale: retainBaseResult,
		};
	}
	return publicState(state, projectionSettings.evaluations);
}
