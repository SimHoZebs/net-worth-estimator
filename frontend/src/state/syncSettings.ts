import { useQuery } from "@tanstack/react-query";
import {
	connectSyncCredential,
	disconnectSyncCredential,
	getSyncCredential,
	listAccountLinks,
	supersedeSimplefinAccount,
	triggerSimplefinSync,
} from "@/api/generated/endpoints.ts";
import type {
	SyncCredentialBody,
	AccountLink,
} from "@/api/generated/model/index.ts";
import {
	getUserScope,
	subscribeUserScope,
	type UserScope,
} from "@/auth/resourceScope.ts";
import { dismissKey, notifyError } from "@/state/notifications.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import { integrationsKey } from "@/state/integrations.ts";
import { refreshWorkspaceAfterSync } from "@/state/syncWorkspaceRefresh.ts";
import { useUserScope } from "@/state/useUserScope.ts";
import { performSave } from "@/state/workspaceWrites.ts";
import {
	reloadWorkspace,
	userResourceKey,
} from "@/state/workspaceResources.ts";

export function syncCredentialKey(scope = getUserScope()) {
	return ["sync-credential", scope.key] as const;
}

export function syncLinksKey(scope = getUserScope()) {
	return ["sync-links", scope.key] as const;
}

function syncTriggerKey(scope = getUserScope()) {
	return ["sync-trigger", scope.key] as const;
}

function current(scope: UserScope, signal?: AbortSignal) {
	if (scope !== getUserScope() || scope.status !== "ready" || signal?.aborted)
		throw new Error("The active resource changed or the request was canceled.");
}

function credentialOptions(scope = getUserScope()) {
	return {
		queryKey: syncCredentialKey(scope),
		staleTime: 30_000,
		queryFn: async ({ signal }: { signal: AbortSignal }) => {
			// The bank sync panel owns load failures inline. The query stays
			// silent so one failure keeps one place to find.
			const data: SyncCredentialBody = (await getSyncCredential({ signal }))
				.data;
			current(scope, signal);
			dismissKey("sync-credential");
			return data;
		},
	};
}

function linksOptions(scope = getUserScope()) {
	return {
		queryKey: syncLinksKey(scope),
		staleTime: 30_000,
		queryFn: async ({ signal }: { signal: AbortSignal }) => {
			const data = (await listAccountLinks({ signal })).data;
			current(scope, signal);
			dismissKey("sync-links");
			return (data.links ?? []) as AccountLink[];
		},
	};
}

async function refreshStatus(scope: UserScope) {
	if (scope.status === "pending" || scope !== getUserScope()) return;
	await serverQueryClient().invalidateQueries({
		queryKey: userResourceKey("status", scope),
		refetchType: "active",
	});
}

async function refreshSyncData(scope: UserScope) {
	if (scope.status === "pending" || scope !== getUserScope()) return;
	await serverQueryClient().invalidateQueries({
		queryKey: syncLinksKey(scope),
		refetchType: "active",
	});
	await serverQueryClient().invalidateQueries({
		queryKey: integrationsKey(scope),
		refetchType: "active",
	});
	await refreshStatus(scope);
}

export async function refreshSyncSettings(force = false): Promise<void> {
	const scope = getUserScope();
	if (scope.status === "pending") return;
	try {
		const options = credentialOptions(scope);
		if (force)
			await serverQueryClient().invalidateQueries({
				queryKey: options.queryKey,
				refetchType: "none",
			});
		await serverQueryClient().fetchQuery(options);
	} catch {
		/* The query reports its current-resource failure. */
	}
	try {
		const options = linksOptions(scope);
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

async function runMutation<T>(
	key: readonly unknown[],
	mutationFn: () => Promise<T>,
	notice: string | null,
): Promise<T | null> {
	const scope = getUserScope();
	if (scope.status === "pending") return null;
	const cache = serverQueryClient();
	const mutation = cache.getMutationCache().build(cache, {
		mutationKey: key,
		scope: { id: JSON.stringify(key) },
		mutationFn: async () => {
			if (scope !== getUserScope())
				throw new Error("The active resource changed.");
			return mutationFn();
		},
	});
	try {
		const result = await mutation.execute(undefined);
		if (scope !== getUserScope()) return null;
		return result as T;
	} catch (error) {
		if (notice && scope === getUserScope())
			notifyError(
				notice,
				error instanceof Error ? error.message : "The sync request failed.",
			);
		return null;
	}
}

async function settleMutation<T>(
	key: readonly unknown[],
	value: T,
): Promise<void> {
	const cache = serverQueryClient();
	await cache.cancelQueries({ queryKey: key });
	cache.setQueryData(key, value);
}

export async function connectSyncKey(input: {
	setupToken?: string;
	accessUrl?: string;
}): Promise<boolean> {
	const scope = getUserScope();
	// A null notice keeps connect failures in the token field error.
	const updated = await runMutation<SyncCredentialBody>(
		syncCredentialKey(scope),
		async () => (await connectSyncCredential(input)).data,
		null,
	);
	if (!updated) return false;
	await settleMutation(syncCredentialKey(scope), updated);
	void refreshSyncData(scope);
	dismissKey("sync-credential");
	return true;
}

export async function disconnectSyncKey(): Promise<boolean> {
	const scope = getUserScope();
	const updated = await runMutation<SyncCredentialBody>(
		syncCredentialKey(scope),
		async () => (await disconnectSyncCredential()).data,
		"sync-credential",
	);
	if (!updated) return false;
	await settleMutation(syncCredentialKey(scope), updated);
	void refreshSyncData(scope);
	dismissKey("sync-credential");
	return true;
}

// triggerSyncNow runs one manual Bridge sync. Server guards apply: a recent
// trigger or post-429 blackout returns 429, a concurrent run returns 409,
// and a missing credential returns 503. Failures surface the server message
// through the toast. success explicitly refreshes links,
// status, the workspace, and this scope's financial queries before completing.
// The workspace refresh is explicit because the status refresh lands the new
// lastSyncAt in the shared cache before the scheduled monitor polls, so the
// monitor alone would miss the change permanently.
export async function triggerSyncNow(): Promise<boolean> {
	const scope = getUserScope();
	const result = await runMutation<unknown>(
		syncTriggerKey(scope),
		async () => (await triggerSimplefinSync()).data,
		"sync-trigger",
	);
	if (!result) return false;
	if (scope !== getUserScope()) return false;
	await refreshSyncData(scope);
	if (scope !== getUserScope()) return false;
	await refreshWorkspaceAfterSync(scope);
	if (scope !== getUserScope()) return false;
	dismissKey("sync-trigger");
	return true;
}

// supersedeSyncedAccount retires one manual account in favor of the synced
// account already linked to this bridge account. The server moves the manual
// profile, configuration, and sharing-policy selections onto the synced
// account, then deletes the manual account and its history. The workspace
// reload runs inside the guarded model mutation, but the mutation is already
// waiting on this callback, so it must not wait for itself.
export async function supersedeSyncedAccount(
	bridgeAccountId: string,
	manualAccountId: string,
	onRejected?: (message: string) => void,
): Promise<boolean> {
	const scope = getUserScope();
	if (scope.status !== "ready") return false;
	return performSave({
		call: () => supersedeSimplefinAccount(bridgeAccountId, { manualAccountId }),
		refresh: async () => {
			const modelOk = await reloadWorkspace({ waitForWrites: false });
			if (!modelOk)
				throw new Error("The linked accounts could not be reloaded.");
			await serverQueryClient().invalidateQueries({
				queryKey: ["safe-spending-settings"],
				refetchType: "active",
			});
			await refreshSyncSettings(true);
		},
		failureMessage: "The accounts could not be linked.",
		// Keep failures in the link editor so the user can correct and retry.
		suppressToast: true,
		onRejected,
	});
}

export function resetSyncSettingsClient(): void {
	serverQueryClient().removeQueries({ queryKey: ["sync-credential"] });
	serverQueryClient().removeQueries({ queryKey: ["sync-links"] });
	serverQueryClient().removeQueries({ queryKey: ["integrations"] });
}

subscribeUserScope(resetSyncSettingsClient);

export function useSyncCredential() {
	const scope = useUserScope();
	return useQuery(
		{ ...credentialOptions(scope), enabled: scope.status === "ready" },
		serverQueryClient(),
	);
}

export function useSyncLinks(enabled = true) {
	const scope = useUserScope();
	return useQuery(
		{ ...linksOptions(scope), enabled: scope.status === "ready" && enabled },
		serverQueryClient(),
	);
}
