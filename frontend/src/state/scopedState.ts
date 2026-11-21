import type { FetchQueryOptions } from "@tanstack/react-query";
import { getUserScope, type UserScope } from "@/auth/resourceScope.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";

const RESOURCE_CHANGED =
	"The active resource changed or the request was canceled.";

/** Guard against a response fetched for a scope that is no longer current. */
export function assertCurrentScope(
	scope: UserScope,
	signal?: AbortSignal,
	message = RESOURCE_CHANGED,
): void {
	if (scope !== getUserScope() || scope.status !== "ready" || signal?.aborted)
		throw new Error(message);
}

/**
 * Run a write behind one mutation key with the shared scope guards and
 * mutation marker. The caller owns the endpoint call, optimistic values, and
 * its success and error contracts. `onError` runs after execution;
 * `mutationOnError` runs as the mutation's own error callback. Callers that
 * previously returned a rejecting promise set `rethrow`.
 */
export async function runScopedMutation<T>({
	key,
	mutationFn,
	onError,
	mutationOnError,
	rethrow = false,
}: {
	key: readonly unknown[];
	mutationFn: () => Promise<T>;
	onError?: (error: unknown) => void | Promise<void>;
	mutationOnError?: (error: unknown) => void;
	rethrow?: boolean;
}): Promise<T | null> {
	const scope = getUserScope();
	if (scope.status === "pending") return null;
	const cache = serverQueryClient();
	const mutation = cache.getMutationCache().build(cache, {
		mutationKey: key,
		scope: { id: JSON.stringify(key) },
		mutationFn: async () => {
			if (scope !== getUserScope())
				throw new Error("The active resource changed.");
			return mutationFn();
		},
		onError: mutationOnError
			? (error: unknown) => {
					if (scope === getUserScope()) mutationOnError(error);
				}
			: undefined,
	});
	try {
		const result = await mutation.execute(undefined);
		if (scope !== getUserScope()) return null;
		return result as T;
	} catch (error) {
		if (scope === getUserScope()) await onError?.(error);
		if (rethrow) throw error;
		return null;
	}
}

/**
 * Explicit refresh of one scoped query. Pending scopes and the optional
 * forced stale-window reset live here; error policy stays at each call site.
 */
export async function fetchScopedQuery<
	TQueryFnData = unknown,
	TError = Error,
	TData = TQueryFnData,
	TQueryKey extends readonly unknown[] = readonly unknown[],
>(
	options: FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
	force = false,
): Promise<void> {
	const scope = getUserScope();
	if (scope.status === "pending") return;
	const cache = serverQueryClient();
	if (force)
		await cache.invalidateQueries({
			queryKey: options.queryKey,
			refetchType: "none",
		});
	if (scope !== getUserScope()) return;
	await cache.fetchQuery(options);
}
