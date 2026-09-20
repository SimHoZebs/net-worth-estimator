import { type UseQueryResult, useQuery } from "@tanstack/react-query";

export interface ProjectionHookState<TResult, TProgress = number> {
	result: TResult | null;
	runtimeError: string | null;
	isRunning: boolean;
	progress: TProgress | null;
	resultIsStale: boolean;
	// Manual recovery for terminal errors (e.g. a backgrounded stream that
	// exhausted reconnects). Same identity, so a still-running server
	// computation attaches instead of restarting.
	refetch: () => void;
}

/**
 * Shared shell for backend-loaded immutable snapshots (model, income data,
 * server status). All three are load-once resources: infinite stale time,
 * no refetch on focus (configured globally).
 */
export function useImmutableQuery<T>(
	queryKey: readonly string[],
	queryFn: () => Promise<T>,
	options?: { retry?: boolean | number },
): UseQueryResult<T, Error> {
	return useQuery({
		queryKey,
		queryFn,
		staleTime: Infinity,
		...(options?.retry !== undefined ? { retry: options.retry } : {}),
	});
}
