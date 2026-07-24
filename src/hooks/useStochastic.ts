import { useEffect, useMemo, useState } from "react";
import { useProjectionEngine } from "@/engine/ProjectionEngineContext";
import type {
	FinancialModelDocument,
	ModelOverrides,
	ProjectionRuntimeSettings,
	StochasticConfig,
	StochasticProjectionResult,
} from "@/lib/projection";
import type { ProjectionHookState } from "./types";

export function useStochastic(
	document: FinancialModelDocument | null,
	projectionSettings: ProjectionRuntimeSettings,
	overrides: ModelOverrides,
	config: StochasticConfig | null,
	enabled: boolean,
): ProjectionHookState<StochasticProjectionResult> {
	const engine = useProjectionEngine();
	const requestKey = useMemo(
		() => ({ document, projectionSettings, overrides, config, enabled }),
		[document, projectionSettings, overrides, config, enabled],
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
		if (!enabled || document === null || config === null) {
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
					document,
					projectionSettings,
					overrides,
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
		document,
		projectionSettings,
		overrides,
		config,
		enabled,
		engine,
		requestKey,
	]);

	if (state.requestKey !== requestKey) {
		return {
			result: null,
			runtimeError: null,
			isRunning: enabled && document !== null && config !== null,
			progress: null,
		};
	}
	return state;
}
