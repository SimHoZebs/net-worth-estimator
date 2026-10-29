import { useSyncExternalStore } from "react";
import {
	getAccountScope,
	normalizeAccountId,
	subscribeAccountScope,
	type AccountScope,
} from "@/auth/resourceScope.ts";
import { useServerModel as useModel } from "./workspaceResources.ts";

/**
 * Account-scoped session hook. Replaces `usePlan`/`useWorkspacePlan` for
 * new code: render from row hooks (`useAccountBalances`, `useTransactions`)
 * plus projection slices, not the `Plan` aggregate.
 */
export function useAccountScope(): AccountScope {
	return useSyncExternalStore(subscribeAccountScope, getAccountScope);
}

/** @deprecated Alias kept for the store/auth rebase. Use useAccountScope. */
export function useVerifiedResource(): AccountScope {
	return useAccountScope();
}

/** Verified account id (`accounts/*`, `user:<hash>`) or null while pending. */
export function useVerifiedAccountId(): string | null {
	const id = useAccountScope().resource?.id ?? null;
	return id ? normalizeAccountId(id) : null;
}

/** True while the account scope is still verifying. */
export function useAccountPending(): boolean {
	return useAccountScope().status === "pending";
}

/**
 * Account-model presence for shell routing. New screens should prefer row
 * hooks directly; this only answers "is account data available yet?".
 */
export function useAccountModelAvailable(): boolean {
	const model = useModel();
	return model.data?.document != null;
}
