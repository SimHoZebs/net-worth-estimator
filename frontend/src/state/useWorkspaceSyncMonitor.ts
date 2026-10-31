import { useEffect, useSyncExternalStore } from "react";
import { getUserScope, subscribeUserScope } from "@/auth/resourceScope.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import {
	getAppliedSyncStamp,
	markSyncApplied,
	refreshWorkspaceAfterSync,
} from "@/state/syncWorkspaceRefresh.ts";
import {
	getServerStatus,
	statusOptions,
	workspaceIsBusy,
	userResourceKey,
} from "@/state/workspaceResources.ts";

export function useWorkspaceSyncMonitor(enabled: boolean): void {
	// Subscribe directly to the user scope so a ready-to-ready user switch
	// re-runs the effect without requiring the caller to rerender.
	const scope = useSyncExternalStore(subscribeUserScope, getUserScope);
	const scopeKey = scope.status === "ready" ? scope.key : "pending";
	useEffect(() => {
		if (!enabled) return;
		const active = getUserScope();
		if (active.status !== "ready") return;
		// The applied baseline lives outside the shared status cache: a manual
		// sync's explicit refresh marks it, so a later poll with an
		// already-refreshed status does not reload twice, and a status refetch
		// can never consume a change before it is applied.
		if (getAppliedSyncStamp(active) === undefined)
			markSyncApplied(active, getServerStatus(active)?.lastSyncAt ?? null);
		const cache = serverQueryClient();
		// Effect-local lifecycle: cleanup on disable, unmount, or scope change
		// cancels in-flight work so it can never apply to a new scope.
		let cancelled = false;
		let checking = false;
		const check = async () => {
			if (cancelled || checking) return;
			const current = getUserScope();
			if (current.status !== "ready" || current !== active) return;
			if (document.visibilityState === "hidden") return;
			// While the workspace is busy a poll retains its baseline instead
			// of consuming the change, so a later poll retries it.
			if (workspaceIsBusy()) return;
			if (cache.isFetching({ queryKey: userResourceKey("status", current) }))
				return;
			checking = true;
			try {
				if (getAppliedSyncStamp(current) === undefined)
					markSyncApplied(
						current,
						getServerStatus(current)?.lastSyncAt ?? null,
					);
				const status = await cache
					.fetchQuery({
						...statusOptions(current),
						staleTime: 0,
					})
					.catch(() => null);
				if (
					cancelled ||
					!status ||
					current !== active ||
					current !== getUserScope()
				)
					return;
				// A failed poll retains Query's last good data.
				const next = status.lastSyncAt ?? null;
				if (next === getAppliedSyncStamp(current)) return;
				if (workspaceIsBusy()) return;
				await refreshWorkspaceAfterSync(current, next);
			} finally {
				checking = false;
			}
		};
		const onResume = () => void check();
		const timer = window.setInterval(onResume, 60_000);
		window.addEventListener("online", onResume);
		document.addEventListener("visibilitychange", onResume);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
			window.removeEventListener("online", onResume);
			document.removeEventListener("visibilitychange", onResume);
		};
	}, [enabled, scopeKey]);
}
