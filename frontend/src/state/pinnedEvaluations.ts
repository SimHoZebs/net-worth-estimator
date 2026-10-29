import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
	getPinnedEvaluations,
	setPinnedEvaluations,
} from "@/api/generated/endpoints.ts";
import {
	getAccountScope,
	subscribeAccountScope,
} from "@/auth/resourceScope.ts";
import { dismissKey, notifyError } from "@/state/notifications.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";

export function pinnedEvaluationsKey() {
	return ["pinned-evaluations", getAccountScope().key] as const;
}

function pinsOptions() {
	const scope = getAccountScope();
	return {
		queryKey: pinnedEvaluationsKey(),
		staleTime: 30_000,
		queryFn: async ({ signal }: { signal: AbortSignal }) => {
			try {
				const data = (await getPinnedEvaluations({ signal })).data;
				if (scope !== getAccountScope())
					throw new Error("The active resource changed.");
				dismissKey("evaluation-pins");
				return data.instanceIds ?? [];
			} catch (error) {
				if (scope === getAccountScope() && !signal.aborted)
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
	if (getAccountScope().status === "pending") return;
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
	const scope = getAccountScope();
	if (scope.status === "pending") return false;
	const cache = serverQueryClient();
	const key = pinnedEvaluationsKey();
	const mutation = cache.getMutationCache().build(cache, {
		mutationKey: key,
		scope: { id: JSON.stringify(key) },
		mutationFn: async () => {
			if (scope !== getAccountScope())
				throw new Error("The active resource changed.");
			if (cache.getQueryData(key) === undefined)
				await cache.fetchQuery(pinsOptions());
			if (scope !== getAccountScope())
				throw new Error("The active resource changed.");
			await cache.cancelQueries({ queryKey: key });
			if (scope !== getAccountScope())
				throw new Error("The active resource changed.");
			const previous = cache.getQueryData<string[]>(key) ?? [];
			const next = previous.includes(id)
				? previous.filter((item) => item !== id)
				: [...previous, id];
			cache.setQueryData(key, next);
			try {
				const data = (await setPinnedEvaluations({ instanceIds: next })).data;
				if (scope === getAccountScope())
					cache.setQueryData(key, data.instanceIds ?? []);
			} catch (error) {
				if (scope === getAccountScope()) cache.setQueryData(key, previous);
				throw error;
			}
		},
	});
	try {
		await mutation.execute(undefined);
		if (scope !== getAccountScope()) return false;
		dismissKey("evaluation-pins");
		return true;
	} catch (error) {
		if (scope === getAccountScope()) {
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

subscribeAccountScope(resetPinnedEvaluationsClient);

export function usePinnedEvaluations() {
	const scope = useSyncExternalStore(subscribeAccountScope, getAccountScope);
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
