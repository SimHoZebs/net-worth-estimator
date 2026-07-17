import { useEffect, useState } from "react";
import { useProjectionEngine } from "@/engine/ProjectionEngineContext";
import type {
	ProjectionRuntimeSettings,
	ScenarioPack,
	ScenarioWhatIfState,
	StochasticConfig,
	StochasticProjectionResult,
} from "@/lib/projection";
import type { ProjectionHookState } from "./types";

export function useStochastic(
	pack: ScenarioPack | null,
	projectionSettings: ProjectionRuntimeSettings,
	whatIfState: ScenarioWhatIfState,
	config: StochasticConfig | null,
	enabled: boolean,
): ProjectionHookState<StochasticProjectionResult> {
	const engine = useProjectionEngine();
	const [state, setState] = useState<
		ProjectionHookState<StochasticProjectionResult>
	>({
		result: null,
		runtimeError: null,
		isRunning: false,
		progress: null,
	});

	useEffect(() => {
		if (!enabled || pack === null || config === null) {
			setState({
				result: null,
				runtimeError: null,
				isRunning: false,
				progress: null,
			});
			return;
		}

		const controller = new AbortController();
		setState((s) => ({
			...s,
			isRunning: true,
			runtimeError: null,
			result: null,
			progress: null,
		}));

		engine
			.projectStochastic(
				{
					pack,
					projectionSettings,
					whatIfState,
					config,
					signal: controller.signal,
				},
				(progress, partial) => {
					setState((s) => ({
						...s,
						progress,
						result: partial ?? s.result,
					}));
				},
			)
			.then((result) => {
				setState({
					result,
					runtimeError: null,
					isRunning: false,
					progress: null,
				});
			})
			.catch((err: unknown) => {
				if (err instanceof DOMException && err.name === "AbortError") return;
				setState((s) => ({
					...s,
					runtimeError:
						err instanceof Error
							? err.message
							: "Stochastic simulation failed.",
					isRunning: false,
					progress: null,
				}));
			});

		return () => {
			controller.abort();
		};
	}, [pack, projectionSettings, whatIfState, config, enabled, engine]);

	return state;
}
