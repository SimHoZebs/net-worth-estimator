import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useProjectionEngine } from "@/engine/ProjectionEngineContext";
import type {
	FinancialModelDocument,
	ProjectionResult,
	ProjectionRuntimeSettings,
} from "@/lib/projection";
import { projectionRequestIdentity } from "@/lib/projection/runtime/computationIdentity";
import type { IncomeDataSnapshot } from "@/lib/projection/types/income";
import type { ProjectionHookState } from "./types";

export type { ProjectionHookState };

export function useProjection(
	document: FinancialModelDocument | null,
	projectionSettings: ProjectionRuntimeSettings,
	enabled: boolean,
	incomeData?: IncomeDataSnapshot,
): ProjectionHookState<ProjectionResult> {
	const engine = useProjectionEngine();
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
			return engine.project({
				document,
				projectionSettings,
				incomeData,
				signal,
			});
		},
		enabled: active,
		placeholderData: keepPreviousData,
		staleTime: Infinity,
		// Deterministic runs are cheap and server-cacheable: retry transient
		// backgrounding blips automatically instead of sticking an error.
		retry: 2,
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
	const result = query.data ?? null;
	return {
		result,
		runtimeError: query.error ? query.error.message : null,
		isRunning: query.isFetching,
		progress: null,
		resultIsStale:
			result !== null && (query.isPlaceholderData || query.isError),
	};
}
