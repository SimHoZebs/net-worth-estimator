import { getUserScope, type UserScope } from "@/auth/resourceScope.ts";
import {
	financialQueryFilter,
	serverQueryClient,
} from "@/state/serverQuery.ts";
import {
	getServerStatus,
	reloadWorkspace,
} from "@/state/workspaceResources.ts";

// Per-scope record of the last sync stamp the workspace has already applied.
// The shared status cache cannot serve as this baseline: a manual sync's
// status refresh lands in the cache before the scheduled monitor polls, so
// comparing cache-against-cache would miss the change permanently.
const appliedSyncStamps = new Map<string, string | null>();

export function getAppliedSyncStamp(
	scope: UserScope,
): string | null | undefined {
	return appliedSyncStamps.get(scope.key);
}

export function markSyncApplied(
	scope: UserScope,
	lastSyncAt: string | null | undefined,
): void {
	appliedSyncStamps.set(scope.key, lastSyncAt ?? null);
}

/** Test hook: keeps applied sync stamps from leaking between cases. */
export function resetSyncWorkspaceRefresh(): void {
	appliedSyncStamps.clear();
}

// Shared refresh for sync changes: reload the workspace and, only on a
// confirmed fresh model, refresh this scope's financial calculations and mark
// the stamp applied. Both the manual sync action and the scheduled monitor
// own their trigger; this helper owns only the refresh. It never starts a
// manual sync. The reload owner reports its scoped model result explicitly,
// so a failed model GET leaves the stamp unapplied (and financial
// calculations untouched) and a later poll retries the same stamp.
export async function refreshWorkspaceAfterSync(
	scope: UserScope = getUserScope(),
	targetLastSyncAt?: string | null,
): Promise<boolean> {
	if (scope.status !== "ready" || scope !== getUserScope()) return false;
	// The stamp this refresh applies for: captured up front so a newer stamp
	// landing mid-refresh gets its own later cycle instead of being marked
	// without its model refresh.
	const target = targetLastSyncAt ?? getServerStatus(scope)?.lastSyncAt ?? null;
	const cache = serverQueryClient();
	try {
		const modelOk = await reloadWorkspace();
		if (scope !== getUserScope()) return false;
		if (!modelOk) return false;
		const filter = financialQueryFilter(scope.key);
		await cache.invalidateQueries({ ...filter, refetchType: "none" });
		if (scope !== getUserScope()) return false;
		await cache.refetchQueries({ ...filter, type: "active", stale: true });
		if (scope !== getUserScope()) return false;
		markSyncApplied(scope, target);
		return true;
	} catch {
		return false;
	}
}
