import { useEffect } from "react";
import { getResourceScope } from "../auth/resourceScope.ts";
import { financialQueryFilter, serverQueryClient } from "./serverQuery.ts";
import { type RemoteApiClient, useWorkspaceStore } from "./workspaceStore.ts";

/** Only status is polled. Loaded financial data has no time-based expiry. */
export function useWorkspaceSyncMonitor(api: RemoteApiClient | null): void {
	useEffect(() => {
		if (!api) return;
		const scope = getResourceScope();
		const controller = new AbortController();
		let pending = false;
		const isCurrent = () =>
			!controller.signal.aborted && getResourceScope() === scope;
		const check = async () => {
			const before = useWorkspaceStore.getState();
			if (
				pending ||
				!isCurrent() ||
				document.visibilityState === "hidden" ||
				!before.workspace ||
				!before.status ||
				before.engine.saving ||
				before.engine.hydrating
			)
				return;
			pending = true;
			try {
				const status = await api.getStatus({ signal: controller.signal });
				if (!isCurrent() || status instanceof Error) return;
				const current = useWorkspaceStore.getState();
				if (
					current.engine !== before.engine ||
					current.engine.saving ||
					current.engine.hydrating
				)
					return;
				if ((status.lastSyncAt ?? "") === (current.status?.lastSyncAt ?? ""))
					return;
				const client = serverQueryClient();
				const filter = financialQueryFilter(scope.key);
				await client.invalidateQueries({ ...filter, refetchType: "none" });
				if (!isCurrent()) return;
				const latest = useWorkspaceStore.getState();
				// A save can start during invalidation. Retry next minute instead
				// of queueing a foreground hydration behind that save.
				if (
					latest.engine !== before.engine ||
					latest.engine.saving ||
					latest.engine.hydrating
				)
					return;
				await latest.hydrate({ background: true });
				if (isCurrent())
					await client.refetchQueries({
						...filter,
						type: "active",
						stale: true,
					});
			} catch {
				// Retain the last good data. The next poll retries the check.
			} finally {
				pending = false;
			}
		};
		const onResume = () => {
			void check();
		};
		const timer = window.setInterval(onResume, 60_000);
		window.addEventListener("online", onResume);
		document.addEventListener("visibilitychange", onResume);
		return () => {
			controller.abort();
			window.clearInterval(timer);
			window.removeEventListener("online", onResume);
			document.removeEventListener("visibilitychange", onResume);
		};
	}, [api]);
}
