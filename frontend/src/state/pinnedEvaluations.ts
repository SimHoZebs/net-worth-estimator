import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { ApiClient } from "../api/index.ts";
import { defaultScopedApiClient } from "../api/scopedClients.ts";
import {
	getResourceScope,
	subscribeResourceScope,
} from "../auth/resourceScope.ts";
import { dismissKey, notifyError } from "./notifications.ts";
import { serverQueryClient } from "./serverQuery.ts";

export function pinnedEvaluationsKey() {
	return ["pinned-evaluations", getResourceScope().key] as const;
}

function pinsOptions(client?: ApiClient) {
	const scope = getResourceScope();
	return {
		queryKey: pinnedEvaluationsKey(),
		staleTime: 30_000,
		queryFn: async ({ signal }: { signal: AbortSignal }) => {
			try {
				const result = await (
					client ?? defaultScopedApiClient()
				).getPinnedEvaluations({ signal });
				if (scope !== getResourceScope())
					throw new Error("The active resource changed.");
				if (result instanceof Error) throw result;
				dismissKey("evaluation-pins");
				return result.instanceIds;
			} catch (error) {
				if (scope === getResourceScope() && !signal.aborted)
					notifyError(
						"evaluation-pins",
						error instanceof Error
							? error.message
							: "Pins could not be loaded.",
						{
							label: "Reload pins",
							onAction: () => void refreshPins(client, true),
						},
					);
				throw error;
			}
		},
	};
}

export async function refreshPins(
	client?: ApiClient,
	force = false,
): Promise<void> {
	if (getResourceScope().status === "pending") return;
	const options = pinsOptions(client);
	try {
		if (force)
			await serverQueryClient().invalidateQueries({
				queryKey: options.queryKey,
				refetchType: "none",
			});
		await serverQueryClient().fetchQuery(options);
	} catch {
		/* The query reports its current-resource failure. */
	}
}

export async function togglePin(
	id: string,
	client?: ApiClient,
): Promise<boolean> {
	const scope = getResourceScope();
	if (scope.status === "pending") return false;
	const cache = serverQueryClient();
	const key = pinnedEvaluationsKey();
	const mutation = cache.getMutationCache().build(cache, {
		mutationKey: key,
		scope: { id: JSON.stringify(key) },
		mutationFn: async () => {
			if (scope !== getResourceScope())
				throw new Error("The active resource changed.");
			if (cache.getQueryData(key) === undefined)
				await cache.fetchQuery(pinsOptions(client));
			if (scope !== getResourceScope())
				throw new Error("The active resource changed.");
			await cache.cancelQueries({ queryKey: key });
			if (scope !== getResourceScope())
				throw new Error("The active resource changed.");
			const previous = cache.getQueryData<string[]>(key) ?? [];
			const next = previous.includes(id)
				? previous.filter((item) => item !== id)
				: [...previous, id];
			cache.setQueryData(key, next);
			try {
				const result = await (
					client ?? defaultScopedApiClient()
				).setPinnedEvaluations(next);
				if (result instanceof Error) throw result;
				if (scope === getResourceScope())
					cache.setQueryData(key, result.instanceIds);
			} catch (error) {
				if (scope === getResourceScope()) cache.setQueryData(key, previous);
				throw error;
			}
		},
	});
	try {
		await mutation.execute(undefined);
		if (scope !== getResourceScope()) return false;
		dismissKey("evaluation-pins");
		return true;
	} catch (error) {
		if (scope === getResourceScope()) {
			await cache.invalidateQueries({ queryKey: key, refetchType: "none" });
			notifyError(
				"evaluation-pins",
				error instanceof Error ? error.message : "Pins could not be saved.",
				{
					label: "Reload pins",
					onAction: () => void refreshPins(client, true),
				},
			);
		}
		return false;
	}
}

export function resetPinnedEvaluationsClient() {
	serverQueryClient().removeQueries({ queryKey: ["pinned-evaluations"] });
}

subscribeResourceScope(resetPinnedEvaluationsClient);

export function usePinnedEvaluations() {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	const query = useQuery(
		{ ...pinsOptions(), enabled: scope.status === "ready" },
		serverQueryClient(),
	);
	return {
		ids: query.data ?? null,
		loading: query.isFetching,
		error: query.error?.message ?? null,
		refresh: refreshPins,
		toggle: togglePin,
	};
}
