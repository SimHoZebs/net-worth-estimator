import { QueryClient } from "@tanstack/react-query";

/**
 * Shared TanStack Query cache for projections. Identical concurrent
 * deterministic requests attach to one in-flight fetch instead of computing
 * side by side; completed results are reused across remounts while fresh.
 * Reads are unguarded, so the auth token stays out of the key on purpose.
 */
export function deterministicQueryKey(
	documentKey: string,
	incomeDataKey: string,
	years: number,
	attempt: number,
): readonly unknown[] {
	return [
		"deterministic-projection",
		documentKey,
		incomeDataKey,
		years,
		attempt,
	];
}

let shared: QueryClient | null = null;

export function projectionQueryClient(): QueryClient {
	if (!shared)
		shared = new QueryClient({
			defaultOptions: {
				queries: {
					// Failures surface immediately through the hook's error
					// state; framework retries would only delay the notice.
					retry: false,
					staleTime: 60_000,
					gcTime: 600_000,
					refetchOnWindowFocus: false,
				},
			},
		});
	return shared;
}

/** Test hook: keeps cached projections from leaking between cases. */
export function resetProjectionQueryCache(): void {
	shared?.clear();
}
