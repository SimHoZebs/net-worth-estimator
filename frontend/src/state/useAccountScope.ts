import { useSyncExternalStore } from "react";
import {
	getAccountScope,
	subscribeAccountScope,
	type AccountScope,
} from "@/auth/resourceScope.ts";
import { ApiHttpError } from "../api/index.ts";
import { useServerModel as useModel, useServerStatus } from "./workspaceResources.ts";
import {
	draftConflict,
	selectDraftChangeCount,
	useWorkspaceStore,
} from "./workspaceStore.ts";
import { useWorkspaceWriteError } from "./workspaceWrites.ts";

/** Verified account scope for the mounted session. */
export function useAccountScope(): AccountScope {
	return useSyncExternalStore(subscribeAccountScope, getAccountScope);
}

/** Verified account scope for the mounted session. */
export function useVerifiedResource(): AccountScope {
	return useAccountScope();
}

/** Verified account id (`accounts/*`, `user:<hash>`) or null while pending. */
export function useVerifiedAccountId(): string | null {
	return useAccountScope().resource?.id ?? null;
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

/**
 * Verified account's draft/review aggregate. New screens should prefer row
 * hooks (`useAccountBalances`/`useTransactions`) plus projection slices;
 * the `Plan` aggregate stays only for the draft/review layer.
 */
export function useAccountPlan() {
	const draft = useWorkspaceStore((state) => state.draft);
	const model = useModel();
	return model.data?.conversion ? (draft ?? model.data.conversion.plan) : null;
}

/** Read-only policy for the verified account (sample accounts stay read-only). */
export function useAccountReadOnly() {
	const model = useModel();
	const status = useServerStatus();
	const error = useWorkspaceWriteError();
	return Boolean(
		(status.data?.readOnly ?? true) ||
		model.data?.conversion?.plan.readOnly ||
		(error instanceof ApiHttpError && error.status === 403),
	);
}

export function useDraftChangeCount() {
	return useWorkspaceStore(selectDraftChangeCount);
}

export function useDraftConflict() {
	const model = useModel();
	const draft = useWorkspaceStore((state) => state.draft);
	const baseFingerprint = useWorkspaceStore((state) => state.baseFingerprint);
	const baseRevision = useWorkspaceStore((state) => state.baseRevision);
	const baseline = useWorkspaceStore((state) => state.baseline);
	return draftConflict(
		{
			...useWorkspaceStore.getState(),
			draft,
			baseFingerprint,
			baseRevision,
			baseline,
		},
		model.data,
	);
}
