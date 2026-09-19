import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { BackendProjectionEngine } from "@/engine/BackendProjectionEngine";
import type {
	FinancialModelDocument,
	ProjectionResult,
	ProjectionRuntimeSettings,
	StochasticConfig,
	StochasticProgress,
	StochasticProjectionResult,
} from "@/lib/projection";
import { projectionRequestIdentity } from "@/lib/projection/runtime/computationIdentity";
import type { ProjectionEngine } from "@/lib/projection/runtime/ProjectionEngine";
import type { IncomeDataSnapshot } from "@/lib/projection/types/income";
import {
	deriveStochasticSeed,
	normalizeStochasticConfig,
} from "@/lib/projection/utils/stochastic";
import type { ProjectionHookState } from "./types";

export type { ProjectionHookState };

// The backend engine is a stateless HTTP/SSE client, so a single shared
// instance serves all projection hooks. Routing stability comes from TanStack
// Query (identity-keyed cache, mounted above the route outlet in App), not
// from React context.
let activeEngine: ProjectionEngine = new BackendProjectionEngine();

/** Test seam used by wrapperWithEngine to install a mock engine. */
export function setProjectionEngine(engine: ProjectionEngine): void {
	activeEngine = engine;
}

// Shared TanStack defaults for both projection kinds: keep the previous
// result on screen while the next request runs, and never refetch on a timer.
const sharedQueryOptions = {
	placeholderData: keepPreviousData,
	staleTime: Infinity,
} as const;

type QuerySnapshot = {
	data: unknown;
	error: Error | null;
	isFetching: boolean;
	isPlaceholderData: boolean;
	isError: boolean;
};

function inactiveState<TResult, TProgress>(): ProjectionHookState<
	TResult,
	TProgress
> {
	return {
		result: null,
		runtimeError: null,
		isRunning: false,
		progress: null,
		resultIsStale: false,
	};
}

// Single mapping from a settled TanStack snapshot to hook state, so both
// projection kinds share placeholder/stale/retry semantics. The stochastic
// hook supplies its live progress/partial overrides; deterministic uses none.
function toHookState<TResult, TProgress>(
	query: QuerySnapshot & { data: TResult | undefined },
	overrides?: {
		result?: TResult | null;
		progress?: TProgress | null;
		resultIsStale?: boolean;
	},
): ProjectionHookState<TResult, TProgress> {
	const result = overrides?.result ?? query.data ?? null;
	return {
		result,
		runtimeError: query.error ? query.error.message : null,
		isRunning: query.isFetching,
		progress: overrides?.progress ?? null,
		resultIsStale:
			overrides?.resultIsStale ??
			(result !== null && (query.isPlaceholderData || query.isError)),
	};
}

export function useProjection(
	document: FinancialModelDocument | null,
	projectionSettings: ProjectionRuntimeSettings,
	enabled: boolean,
	incomeData?: IncomeDataSnapshot,
): ProjectionHookState<ProjectionResult> {
	const active = enabled && document !== null;
	const requestIdentity = projectionRequestIdentity({
		document,
		settings: projectionSettings,
		incomeData,
	});
	const query = useQuery({
		queryKey: ["projection", "deterministic", requestIdentity],
		queryFn: ({ signal }) => {
			if (document === null) {
				throw new Error("Projection requires a document.");
			}
			return activeEngine.project({
				document,
				projectionSettings,
				incomeData,
				signal,
			});
		},
		enabled: active,
		...sharedQueryOptions,
		// Deterministic runs are cheap and server-cacheable: retry transient
		// backgrounding blips automatically instead of sticking an error.
		retry: 2,
	});
	if (!active) {
		return inactiveState();
	}
	return toHookState(query);
}

export function useStochastic(
	document: FinancialModelDocument | null,
	projectionSettings: ProjectionRuntimeSettings,
	config: StochasticConfig | null,
	enabled: boolean,
	incomeData?: IncomeDataSnapshot,
): ProjectionHookState<StochasticProjectionResult, StochasticProgress> {
	const runCount = config?.runCount ?? null;
	const seed = config?.seed ?? null;
	// A blank seed means "derive from the inputs": identical models share
	// identical draws, so results are cacheable, attachable, and stable
	// across refreshes. An explicit seed always wins.
	const derivedSeed = useMemo(
		() =>
			runCount === null || seed !== null || document === null
				? null
				: deriveStochasticSeed({
						document,
						settings: projectionSettings,
						incomeData,
						runCount,
					}),
		[document, projectionSettings, incomeData, runCount, seed],
	);
	const stableConfig = useMemo(
		() =>
			runCount === null
				? null
				: normalizeStochasticConfig({ runCount, seed: seed ?? derivedSeed }),
		[runCount, seed, derivedSeed],
	);
	const active = enabled && stableConfig !== null && document !== null;
	const requestIdentity = projectionRequestIdentity({
		document,
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
			return activeEngine.projectStochastic(
				{
					document,
					projectionSettings,
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
		...sharedQueryOptions,
		// No TanStack retry here: BackendProjectionEngine already runs a
		// bounded SSE reconnect loop (full restart, partials preserved), and
		// a query-level retry would multiply attempts.
		retry: false,
	});
	if (!active) {
		return inactiveState();
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
	return toHookState(query, {
		result,
		progress: liveProgress,
		resultIsStale:
			result !== null &&
			livePartial === null &&
			(query.isPlaceholderData || query.isError),
	});
}
