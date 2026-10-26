import { useEffect } from "react";
import { getResourceScope } from "../auth/resourceScope.ts";
import { financialQueryFilter, serverQueryClient } from "./serverQuery.ts";
import type { RemoteApiClient } from "./workspaceStore.ts";
import {
	getServerStatus,
	reloadWorkspace,
	statusOptions,
	workspaceIsBusy,
	workspaceResourceKey,
} from "./workspaceResources.ts";

export function useWorkspaceSyncMonitor(api: RemoteApiClient | null): void {
	useEffect(() => {
		if (!api) return;
		const scope = getResourceScope();
		const cache = serverQueryClient();
		const check = async () => {
			if (
				scope !== getResourceScope() ||
				document.visibilityState === "hidden" ||
				workspaceIsBusy() ||
				cache.isFetching({ queryKey: workspaceResourceKey("status", scope) })
			)
				return;
			const before = getServerStatus(scope)?.lastSyncAt ?? "";
			try {
				const status = await cache.fetchQuery({
					...statusOptions(api, scope),
					staleTime: 0,
				});
				if (
					scope !== getResourceScope() ||
					workspaceIsBusy() ||
					before === (status.lastSyncAt ?? "")
				)
					return;
				const filter = financialQueryFilter(scope.key);
				await cache.invalidateQueries({ ...filter, refetchType: "none" });
				await reloadWorkspace(api);
				if (scope === getResourceScope())
					await cache.refetchQueries({
						...filter,
						type: "active",
						stale: true,
					});
			} catch {
				/* A failed poll retains Query's last good data. */
			}
		};
		const onResume = () => void check();
		const timer = window.setInterval(onResume, 60_000);
		window.addEventListener("online", onResume);
		document.addEventListener("visibilitychange", onResume);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("online", onResume);
			document.removeEventListener("visibilitychange", onResume);
		};
	}, [api]);
}
