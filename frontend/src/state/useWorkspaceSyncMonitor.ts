import { useEffect } from "react";
import { getResourceScope } from "@/auth/resourceScope.ts";
import {
	financialQueryFilter,
	serverQueryClient,
} from "@/state/serverQuery.ts";
import {
	getServerStatus,
	reloadWorkspace,
	statusOptions,
	workspaceIsBusy,
	workspaceResourceKey,
} from "@/state/workspaceResources.ts";

export function useWorkspaceSyncMonitor(enabled: boolean): void {
	// Keyed on the scope epoch: the caller re-renders on scope change, so a
	// ready-to-ready plan switch re-runs the effect and recaptures scope.
	// Keying on `enabled` alone left a stale capture whose guard bailed on
	// every poll after a plan switch.
	const scopeKey = getResourceScope().key;
	useEffect(() => {
		if (!enabled) return;
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
					...statusOptions(scope),
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
				await reloadWorkspace();
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
	}, [enabled, scopeKey]);
}
