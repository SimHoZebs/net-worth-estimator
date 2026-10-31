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
import { useWorkspaceWriteError } from "./workspaceWrites.ts";

/** Verified user scope for the mounted session. */
export function useUserScope(): UserScope {
	return useSyncExternalStore(subscribeUserScope, getUserScope);
}

/** Verified user scope for the mounted session. */
export const useVerifiedResource = useUserScope;

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
 * hooks (`useSavedAccounts`/`useSavedTransactions`) plus projection slices;
 * this only answers "is user data available yet?".
 */
export function useUserModelAvailable(): boolean {
	const model = useModel();
	return model.data?.model != null;
}

/** Read-only state from server policy and the latest write denial. */
export function useUserReadOnly() {
	const status = useServerStatus();
	const error = useWorkspaceWriteError();
	return Boolean(
		(status.data?.readOnly ?? true) ||
		(error instanceof ApiHttpError && error.status === 403),
	);
}
