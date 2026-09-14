import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useProjectionEngine } from "@/engine/ProjectionEngineContext";
import type {
	FinancialModelDocument,
	ModelOverrides,
	ProjectionRuntimeSettings,
	StochasticConfig,
	StochasticProgress,
	StochasticProjectionResult,
} from "@/lib/projection";
import { projectionRequestIdentity } from "@/lib/projection/runtime/computationIdentity";
import type { IncomeDataSnapshot } from "@/lib/projection/types/income";
import { normalizeStochasticConfig } from "@/lib/projection/utils/stochastic";
import type { ProjectionHookState } from "./types";

export function useStochastic(
	document: FinancialModelDocument | null,
	projectionSettings: ProjectionRuntimeSettings,
	overrides: ModelOverrides,
	config: StochasticConfig | null,
	enabled: boolean,
	incomeData?: IncomeDataSnapshot,
): ProjectionHookState<StochasticProjectionResult, StochasticProgress> {
	const engine = useProjectionEngine();
	const runCount = config?.runCount ?? null;
	const seed = config?.seed ?? null;
	const stableConfig = useMemo(
		() =>
			runCount === null ? null : normalizeStochasticConfig({ runCount, seed }),
		[runCount, seed],
	);
	const active = enabled && stableConfig !== null && document !== null;
	const requestIdentity = projectionRequestIdentity({
		document,
		overrides,
		settings: projectionSettings,
		incomeData,
		extra: stableConfig,
	});
	const [progressState, setProgressState] = useState<{
		key: string;
		progress: StochasticProgress;
		partial: StochasticProjectionResult | null;
	} | null>(null);
	const identityRef = useRef(requestIdentity);
	identityRef.current = requestIdentity;
	const query = useQuery({
		queryKey: ["projection", "stochastic", requestIdentity],
		queryFn: ({ signal }) => {
			if (document === null || stableConfig === null) {
				throw new Error(
					"Stochastic projection requires a document and config.",
				);
			}
			const fetchIdentity = requestIdentity;
			return engine.projectStochastic(
				{
					document,
					projectionSettings,
					overrides,
					incomeData,
					config: stableConfig,
					signal,
				},
				(progress, partial) => {
					if (identityRef.current !== fetchIdentity) return;
					setProgressState((current) => ({
						key: fetchIdentity,
						progress,
						partial:
							partial ??
							(current?.key === fetchIdentity ? current.partial : null),
					}));
				},
			);
		},
		enabled: active,
		placeholderData: keepPreviousData,
		staleTime: Infinity,
		retry: false,
	});
	if (!active) {
		return {
			result: null,
			runtimeError: null,
			isRunning: false,
			progress: null,
			resultIsStale: false,
		};
	}
	const settledResult =
		!query.isFetching && !query.isPlaceholderData ? (query.data ?? null) : null;
	const livePartial =
		progressState?.key === requestIdentity ? progressState.partial : null;
	const liveProgress =
		progressState?.key === requestIdentity && settledResult === null
			? progressState.progress
			: null;
	const result =
		settledResult ??
		livePartial ??
		(query.data !== undefined ? query.data : null);
	return {
		result,
		runtimeError: query.error ? query.error.message : null,
		isRunning: query.isFetching,
		progress: liveProgress,
		resultIsStale:
			result !== null &&
			livePartial === null &&
			(query.isPlaceholderData || query.isError),
	};
}
