import { useEffect, useMemo, useState } from "react";
import { useProjectionEngine } from "@/engine/ProjectionEngineContext";
import type {
	FinancialModelDocument,
	ModelOverrides,
	ProjectionResult,
	ProjectionRuntimeSettings,
} from "@/lib/projection";
import {
	labelProjectionResult,
	projectionComputationSettingsKey,
} from "./projectionComputationSettings";
import type { ProjectionHookState } from "./types";

export type { ProjectionHookState };

interface ProjectionState extends ProjectionHookState<ProjectionResult> {
	requestKey: object | null;
	resultBaseKey: object | null;
}

function publicState(
	state: ProjectionState,
	evaluations: ProjectionRuntimeSettings["evaluations"],
): ProjectionHookState<ProjectionResult> {
	return {
		result: state.result
			? labelProjectionResult(state.result, evaluations)
			: null,
		runtimeError: state.runtimeError,
		isRunning: state.isRunning,
		progress: state.progress,
		resultIsStale: state.resultIsStale,
	};
}

export function useProjection(
	document: FinancialModelDocument | null,
	projectionSettings: ProjectionRuntimeSettings,
	overrides: ModelOverrides,
	enabled: boolean,
): ProjectionHookState<ProjectionResult> {
	const engine = useProjectionEngine();
	const computationSettingsKey =
		projectionComputationSettingsKey(projectionSettings);
	const computationSettings = useMemo(
		() => JSON.parse(computationSettingsKey) as ProjectionRuntimeSettings,
		[computationSettingsKey],
	);
	const baseKey = useMemo(
		() => ({
			document,
			fallbackProjectionStartDate:
				computationSettings.fallbackProjectionStartDate,
			horizonYears: computationSettings.horizonYears,
			overrides,
			enabled,
		}),
		[
			document,
			computationSettings.fallbackProjectionStartDate,
			computationSettings.horizonYears,
			overrides,
			enabled,
		],
	);
	const requestKey = useMemo(
		() => ({ baseKey, evaluations: computationSettings.evaluations }),
		[baseKey, computationSettings.evaluations],
	);
	const [state, setState] = useState<ProjectionState>({
		result: null,
		runtimeError: null,
		isRunning: false,
		progress: null,
		resultIsStale: false,
		requestKey: null,
		resultBaseKey: null,
	});

	useEffect(() => {
		if (!enabled || document === null) {
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
			.project({
				document,
				projectionSettings: computationSettings,
				overrides,
				signal: controller.signal,
			})
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
									err instanceof Error ? err.message : "Projection failed.",
								isRunning: false,
								progress: null,
								resultIsStale: current.result !== null,
							}
						: current,
				);
			});

		return () => controller.abort();
	}, [
		baseKey,
		computationSettings,
		document,
		enabled,
		engine,
		overrides,
		requestKey,
	]);

	if (state.requestKey !== requestKey) {
		const retainBaseResult =
			enabled && state.result !== null && state.resultBaseKey === baseKey;
		return {
			result: retainBaseResult
				? labelProjectionResult(state.result!, projectionSettings.evaluations)
				: null,
			runtimeError: null,
			isRunning: enabled && document !== null,
			progress: null,
			resultIsStale: retainBaseResult,
		};
	}
	return publicState(state, projectionSettings.evaluations);
}
