import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
	getPinnedEvaluations,
	setPinnedEvaluations,
} from "@/api/generated/endpoints.ts";
import {
	getResourceScope,
	subscribeResourceScope,
} from "@/auth/resourceScope.ts";
import { dismissKey, notifyError } from "@/state/notifications.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";

export function pinnedEvaluationsKey() {
	return ["pinned-evaluations", getResourceScope().key] as const;
}

function pinsOptions() {
	const scope = getResourceScope();
	return {
		queryKey: pinnedEvaluationsKey(),
		staleTime: 30_000,
		queryFn: async ({ signal }: { signal: AbortSignal }) => {
			try {
				const data = (await getPinnedEvaluations({ signal })).data;
				if (scope !== getResourceScope())
					throw new Error("The active resource changed.");
				dismissKey("evaluation-pins");
				return data.instanceIds ?? [];
			} catch (error) {
				if (scope === getResourceScope() && !signal.aborted)
					notifyError(
						"evaluation-pins",
						error instanceof Error
							? error.message
							: "Pins could not be loaded.",
						{
							label: "Reload pins",
							onAction: () => void refreshPins(true),
						},
					);
				throw error;
			}
		},
	};
}

export async function refreshPins(force = false): Promise<void> {
	if (getResourceScope().status === "pending") return;
	const options = pinsOptions();
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

export async function togglePin(id: string): Promise<boolean> {
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
				await cache.fetchQuery(pinsOptions());
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
				const data = (await setPinnedEvaluations({ instanceIds: next })).data;
				if (scope === getResourceScope())
					cache.setQueryData(key, data.instanceIds ?? []);
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
					onAction: () => void refreshPins(true),
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
