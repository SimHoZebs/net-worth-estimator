import { useEffect, useMemo, useState } from "react";
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
	const requestKey = useMemo(
		() => ({ pack, projectionSettings, whatIfState, config, enabled }),
		[pack, projectionSettings, whatIfState, config, enabled],
	);
	const [state, setState] = useState<
		ProjectionHookState<StochasticProjectionResult> & {
			requestKey: object | null;
		}
	>({
		result: null,
		runtimeError: null,
		isRunning: false,
		progress: null,
		requestKey: null,
	});

	useEffect(() => {
		if (!enabled || pack === null || config === null) {
			setState({
				result: null,
				runtimeError: null,
				isRunning: false,
				progress: null,
				requestKey,
			});
			return;
		}

		const controller = new AbortController();
		setState({
			isRunning: true,
			runtimeError: null,
			result: null,
			progress: null,
			requestKey,
		});

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
					setState((current) =>
						current.requestKey === requestKey
							? {
									...current,
									progress,
									result: partial ?? current.result,
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
								requestKey,
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
							}
						: current,
				);
			});

		return () => {
			controller.abort();
		};
	}, [
		pack,
		projectionSettings,
		whatIfState,
		config,
		enabled,
		engine,
		requestKey,
	]);

	if (state.requestKey !== requestKey) {
		return {
			result: null,
			runtimeError: null,
			isRunning: enabled && pack !== null && config !== null,
			progress: null,
		};
	}
	return state;
}
