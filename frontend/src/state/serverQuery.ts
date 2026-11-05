import { QueryClient } from "@tanstack/react-query";
import { getUserScope } from "../auth/resourceScope.ts";

/**
 * Shared TanStack Query cache for server resources and derived projections. A projection is a
 * pure function of its inputs, so a cache key holding the full input set
 * can never go stale: identical concurrent requests attach to one in-flight
 * fetch instead of computing side by side, and completed results are reused
 * across remounts while fresh. User identity belongs in each key:
 * identical inputs from different users never share
 * data or in-flight requests. Mutable resources define their own freshness
 * and mutation policy. Identity discovery shares this cache under its own
 * eviction policy, so clearing user data never retires a running check.
 */

/** Identity discovery root. It is not user data and outlives its eviction. */
const SESSION_QUERY_ROOT = "auth-session";

export function sessionQueryKey(baseUrl: string) {
	return [SESSION_QUERY_ROOT, baseUrl] as const;
}

function isResourceOwned(query: { queryKey: readonly unknown[] }): boolean {
	return query.queryKey[0] !== SESSION_QUERY_ROOT;
}

export function deterministicQueryKey(
	modelKey: string,
	years: number,
	rangeKey = "",
): readonly unknown[] {
	const scope = getUserScope();
	return ["deterministic-projection", scope.key, modelKey, years, rangeKey];
}

export function stochasticQueryKey(
	modelKey: string,
	years: number,
	runCount: number,
	seed: number,
	attempt: number,
): readonly unknown[] {
	const scope = getUserScope();
	return [
		"stochastic-projection",
		scope.key,
		modelKey,
		years,
		runCount,
		seed,
		attempt,
	];
}

/**
 * Eval-overlay queries share the base path cache entry and add the
 * eval/view scope. Toggling an evaluation or view preference changes only
 * this key, so the base simulation is never refetched for it.
 */
export function evalOverlayQueryKey(
	baseKey: string,
	evalKey: string,
	years: number,
	rangeKey = "",
): readonly unknown[] {
	const scope = getUserScope();
	return [
		"deterministic-eval-overlay",
		scope.key,
		baseKey,
		evalKey,
		years,
		rangeKey,
	];
}

export function currentPositionQueryKey(
	modelKey: string,
	asOfDate: string,
): readonly unknown[] {
	return ["current-position", getUserScope().key, modelKey, asOfDate];
}

const FINANCIAL_QUERY_KINDS = [
	"deterministic-projection",
	"stochastic-projection",
	"current-position",
	"settle-candidates",
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
	const cache = shared;
	if (!cache) return;
	await cancelResourceQueries();
	// Discovery can still be in flight during logout or an owner switch.
	// Keep it in the cache; its own signal and gcTime own its lifetime.
	cache.removeQueries({ predicate: isResourceOwned });
}

/** Verification cancels old requests without evicting this owner's results. */
export async function cancelResourceQueries(): Promise<void> {
	await shared?.cancelQueries({ predicate: isResourceOwned });
}
