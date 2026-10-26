import { QueryClient } from "@tanstack/react-query";
import { getResourceScope } from "../auth/resourceScope.ts";

/**
 * Shared TanStack Query cache for derived projections. A projection is a
 * pure function of its inputs, so a cache key holding the full input set
 * can never go stale: identical concurrent requests attach to one in-flight
 * fetch instead of computing side by side, and completed results are reused
 * across remounts while fresh. Resource identity belongs in each key:
 * identical inputs from different accounts never share
 * data or in-flight requests. Session discovery belongs to its own hook.
 */

export function deterministicQueryKey(
	documentKey: string,
	years: number,
	rangeKey = "",
): readonly unknown[] {
	const scope = getResourceScope();
	return ["deterministic-projection", scope.key, documentKey, years, rangeKey];
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
		documentKey,
		years,
		runCount,
		seed,
		attempt,
	];
}

export function currentPositionQueryKey(
	documentKey: string,
	asOfDate: string,
): readonly unknown[] {
	return ["current-position", getResourceScope().key, documentKey, asOfDate];
}

const FINANCIAL_QUERY_KINDS = [
	"deterministic-projection",
	"stochastic-projection",
	"current-position",
] as const;

let shared: QueryClient | null = null;

export function serverQueryClient(): QueryClient {
	if (!shared) {
		shared = new QueryClient({
			defaultOptions: {
				queries: {
					// Failures surface immediately through hook error state;
					// framework retries would only delay the notices.
					retry: false,
					gcTime: 600_000,
					refetchOnWindowFocus: false,
				},
			},
		});
		// Calculations change with their keyed inputs, not elapsed time.
		for (const kind of FINANCIAL_QUERY_KINDS)
			shared.setQueryDefaults([kind], { staleTime: Infinity });
	}
	return shared;
}

export function financialQueryFilter(scopeKey: string) {
	return {
		predicate: (query: { queryKey: readonly unknown[] }) =>
			query.queryKey[1] === scopeKey &&
			FINANCIAL_QUERY_KINDS.some((kind) => kind === query.queryKey[0]),
	};
}

/** Test hook: keeps cached server state from leaking between cases. */
export function resetServerQueryCache(): void {
	shared?.clear();
}

/** Cancel first, then remove both data and in-flight projection identities. */
export async function clearResourceQueryCache(): Promise<void> {
	if (!shared) return;
	await cancelResourceQueries();
	shared.clear();
}

/** Verification cancels old requests without evicting this owner's results. */
export async function cancelResourceQueries(): Promise<void> {
	await shared?.cancelQueries();
}
