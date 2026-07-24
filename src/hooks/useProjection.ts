import { useEffect, useMemo, useState } from "react";
import { useProjectionEngine } from "@/engine/ProjectionEngineContext";
import type {
	FinancialModelDocument,
	ModelOverrides,
	ProjectionResult,
	ProjectionRuntimeSettings,
} from "@/lib/projection";
import type { ProjectionHookState } from "./types";

export type { ProjectionHookState };

export function useProjection(
	document: FinancialModelDocument | null,
	projectionSettings: ProjectionRuntimeSettings,
	overrides: ModelOverrides,
	enabled: boolean,
): ProjectionHookState<ProjectionResult> {
	const engine = useProjectionEngine();
	const requestKey = useMemo(
		() => ({ document, projectionSettings, overrides, enabled }),
		[document, projectionSettings, overrides, enabled],
	);
	const [state, setState] = useState<
		ProjectionHookState<ProjectionResult> & { requestKey: object | null }
	>({
		result: null,
		runtimeError: null,
		isRunning: false,
		progress: null,
		requestKey: null,
	});

	useEffect(() => {
		if (!enabled || document === null) {
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
			result: null,
			runtimeError: null,
			isRunning: true,
			progress: null,
			requestKey,
		});

		engine
			.project({
				document,
				projectionSettings,
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
								result: null,
								runtimeError:
									err instanceof Error ? err.message : "Projection failed.",
								isRunning: false,
								progress: null,
								requestKey,
							}
						: current,
				);
			});

		return () => {
			controller.abort();
		};
	}, [document, projectionSettings, overrides, enabled, engine, requestKey]);

	if (state.requestKey !== requestKey) {
		return {
			result: null,
			runtimeError: null,
			isRunning: enabled && document !== null,
			progress: null,
		};
	}
	return state;
}
