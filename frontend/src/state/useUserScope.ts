import { useSyncExternalStore } from "react";
import {
	getUserScope,
	subscribeUserScope,
	type UserScope,
} from "@/auth/resourceScope.ts";
import { ApiHttpError } from "../api/index.ts";
import {
	useServerModel as useModel,
	useServerStatus,
} from "./workspaceResources.ts";
import {
	draftConflict,
	selectDraftChangeCount,
	useWorkspaceStore,
} from "./workspaceStore.ts";
import { useWorkspaceWriteError } from "./workspaceWrites.ts";

/** Verified user scope for the mounted session. */
export function useUserScope(): UserScope {
	return useSyncExternalStore(subscribeUserScope, getUserScope);
}

/** Verified user scope for the mounted session. */
export function useVerifiedResource(): UserScope {
	return useUserScope();
}

/** Verified user id (`users/*`) or null while pending. */
export function useVerifiedUserId(): string | null {
	return useUserScope().resource?.id ?? null;
}

/** True while the user scope is still verifying. */
export function useUserPending(): boolean {
	return useUserScope().status === "pending";
}

/**
 * User-model presence for shell routing. New screens should prefer row
 * hooks directly; this only answers "is user data available yet?".
 */
export function useUserModelAvailable(): boolean {
	const model = useModel();
	return model.data?.document != null;
}

/**
 * Verified user's draft/review aggregate. New screens should prefer row
 * hooks (`useAccountBalances`/`useTransactions`) plus projection slices;
 * the `Plan` aggregate stays only for the draft/review layer.
 */
export function useUserPlan() {
	const draft = useWorkspaceStore((state) => state.draft);
	const model = useModel();
	return model.data?.conversion ? (draft ?? model.data.conversion.plan) : null;
}

/** Read-only policy for the verified user (sample users stay read-only). */
export function useUserReadOnly() {
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
