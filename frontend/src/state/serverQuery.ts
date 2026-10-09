import { QueryClient } from "@tanstack/react-query";

/**
 * Shared TanStack Query cache for derived projections. A projection is a
 * pure function of its inputs, so a cache key holding the full input set
 * can never go stale: identical concurrent requests attach to one in-flight
 * fetch instead of computing side by side, and completed results are reused
 * across remounts while fresh. Mutable server reads (status, model, income)
 * deliberately stay out: the server changes outside any key (syncs, other
 * tabs), so caching them would serve stale state. Reads are unguarded, so
 * the auth token stays out of every key on purpose.
 */

export function deterministicQueryKey(
	documentKey: string,
	incomeDataKey: string,
	years: number,
): readonly unknown[] {
	return ["deterministic-projection", documentKey, incomeDataKey, years];
}

export function stochasticQueryKey(
	documentKey: string,
	incomeDataKey: string,
	years: number,
	runCount: number,
	seed: number,
	attempt: number,
): readonly unknown[] {
	return [
		"stochastic-projection",
		documentKey,
		incomeDataKey,
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
