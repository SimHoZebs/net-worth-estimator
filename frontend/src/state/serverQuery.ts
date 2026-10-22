import { QueryClient } from "@tanstack/react-query";
import { getResourceScope } from "../auth/resourceScope.ts";

/**
 * Shared TanStack Query cache for derived projections. A projection is a
 * pure function of its inputs, so a cache key holding the full input set
 * can never go stale: identical concurrent requests attach to one in-flight
 * fetch instead of computing side by side, and completed results are reused
 * across remounts while fresh. Resource identity and verification epoch also
 * belong in each key: identical inputs from different accounts never share
 * data or in-flight requests. Session discovery uses a separate cache.
 */

export function deterministicQueryKey(
	documentKey: string,
	years: number,
): readonly unknown[] {
	const scope = getResourceScope();
	return [
		"deterministic-projection",
		scope.key,
		scope.epoch,
		documentKey,
		years,
	];
}

export function stochasticQueryKey(
	documentKey: string,
	years: number,
	runCount: number,
	seed: number,
	attempt: number,
): readonly unknown[] {
	const scope = getResourceScope();
	return [
		"stochastic-projection",
		scope.key,
		scope.epoch,
		documentKey,
		years,
		runCount,
		seed,
		attempt,
	];
}

let shared: QueryClient | null = null;

export function serverQueryClient(): QueryClient {
	if (!shared)
		shared = new QueryClient({
			defaultOptions: {
				queries: {
					// Failures surface immediately through hook error state;
					// framework retries would only delay the notices.
					retry: false,
					staleTime: 60_000,
					gcTime: 600_000,
					refetchOnWindowFocus: false,
				},
			},
		});
	return shared;
}

/** Test hook: keeps cached server state from leaking between cases. */
export function resetServerQueryCache(): void {
	shared?.clear();
}

/** Cancel first, then remove both data and in-flight projection identities. */
export async function clearResourceQueryCache(): Promise<void> {
	if (!shared) return;
	await shared.cancelQueries();
	shared.clear();
}
