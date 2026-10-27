import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
	connectSyncCredential,
	disconnectSyncCredential,
	getSyncCards,
	getSyncCredential,
	listAccountLinks,
	setSyncCards,
} from "@/api/generated/endpoints.ts";
import type {
	SyncCredentialBody,
	SyncCardsOutputBody,
	AccountLink,
} from "@/api/generated/model/index.ts";
import {
	getResourceScope,
	subscribeResourceScope,
	type ResourceScope,
} from "@/auth/resourceScope.ts";
import { dismissKey, notifyError } from "@/state/notifications.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import { workspaceResourceKey } from "@/state/workspaceResources.ts";

export function syncCredentialKey(scope = getResourceScope()) {
	return ["sync-credential", scope.key] as const;
}

export function syncCardsKey(scope = getResourceScope()) {
	return ["sync-cards", scope.key] as const;
}

export function syncLinksKey(scope = getResourceScope()) {
	return ["sync-links", scope.key] as const;
}

function current(scope: ResourceScope, signal?: AbortSignal) {
	if (
		scope !== getResourceScope() ||
		scope.status !== "ready" ||
		signal?.aborted
	)
		throw new Error("The active resource changed or the request was canceled.");
}

function credentialOptions(scope = getResourceScope()) {
	return {
		queryKey: syncCredentialKey(scope),
		staleTime: 30_000,
		queryFn: async ({ signal }: { signal: AbortSignal }) => {
			try {
				const data: SyncCredentialBody = (await getSyncCredential({ signal }))
					.data;
				current(scope, signal);
				dismissKey("sync-credential");
				return data;
			} catch (error) {
				if (scope === getResourceScope() && !signal.aborted)
					notifyError(
						"sync-credential",
						error instanceof Error
							? error.message
							: "The sync connection could not be loaded.",
						{
							label: "Reload sync",
							onAction: () => void refreshSyncSettings(true),
						},
					);
				throw error;
			}
		},
	};
}

function cardsOptions(scope = getResourceScope()) {
	return {
		queryKey: syncCardsKey(scope),
		staleTime: 30_000,
		queryFn: async ({ signal }: { signal: AbortSignal }) => {
			try {
				const data: SyncCardsOutputBody = (await getSyncCards({ signal })).data;
				current(scope, signal);
				dismissKey("sync-cards");
				return data.cards ?? [];
			} catch (error) {
				if (scope === getResourceScope() && !signal.aborted)
					notifyError(
						"sync-cards",
						error instanceof Error
							? error.message
							: "The card selection could not be loaded.",
						{
							label: "Reload cards",
							onAction: () => void refreshSyncSettings(true),
						},
					);
				throw error;
			}
		},
	};
}

function linksOptions(scope = getResourceScope()) {
	return {
		queryKey: syncLinksKey(scope),
		staleTime: 30_000,
		queryFn: async ({ signal }: { signal: AbortSignal }) => {
			try {
				const data = (await listAccountLinks({ signal })).data;
				current(scope, signal);
				dismissKey("sync-links");
				return (data.links ?? []) as AccountLink[];
			} catch (error) {
				if (scope === getResourceScope() && !signal.aborted)
					notifyError(
						"sync-links",
						error instanceof Error
							? error.message
							: "The linked accounts could not be loaded.",
						{
							label: "Reload links",
							onAction: () => void refreshSyncSettings(true),
						},
					);
				throw error;
			}
		},
	};
}

async function refreshStatus(scope: ResourceScope) {
	if (scope.status === "pending" || scope !== getResourceScope()) return;
	await serverQueryClient().invalidateQueries({
		queryKey: workspaceResourceKey("status", scope),
		refetchType: "active",
	});
}

async function refreshSyncData(scope: ResourceScope) {
	if (scope.status === "pending" || scope !== getResourceScope()) return;
	await serverQueryClient().invalidateQueries({
		queryKey: syncLinksKey(scope),
		refetchType: "active",
	});
	void refreshStatus(scope);
}

export async function refreshSyncSettings(force = false): Promise<void> {
	const scope = getResourceScope();
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
		const options = cardsOptions(scope);
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
	notice: string,
): Promise<T | null> {
	const scope = getResourceScope();
	if (scope.status === "pending") return null;
	const cache = serverQueryClient();
	const mutation = cache.getMutationCache().build(cache, {
		mutationKey: key,
		scope: { id: JSON.stringify(key) },
		mutationFn: async () => {
			if (scope !== getResourceScope())
				throw new Error("The active resource changed.");
			return mutationFn();
		},
	});
	try {
		const result = await mutation.execute(undefined);
		if (scope !== getResourceScope()) return null;
		return result as T;
	} catch (error) {
		if (scope === getResourceScope())
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
	const scope = getResourceScope();
	const updated = await runMutation<SyncCredentialBody>(
		syncCredentialKey(scope),
		async () => (await connectSyncCredential(input)).data,
		"sync-credential",
	);
	if (!updated) return false;
	await settleMutation(syncCredentialKey(scope), updated);
	void refreshSyncData(scope);
	dismissKey("sync-credential");
	return true;
}

export async function disconnectSyncKey(): Promise<boolean> {
	const scope = getResourceScope();
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

export async function saveSyncCards(cards: string[]): Promise<boolean> {
	const scope = getResourceScope();
	const key = syncCardsKey(scope);
	const cache = serverQueryClient();
	const previous = cache.getQueryData<string[]>(key) ?? [];
	const updated = await runMutation<string[]>(
		key,
		async () => (await setSyncCards({ cards })).data.cards ?? [],
		"sync-cards",
	);
	if (!updated) {
		await cache.cancelQueries({ queryKey: key });
		cache.setQueryData(key, previous);
		return false;
	}
	await settleMutation(key, updated);
	dismissKey("sync-cards");
	return true;
}

export function resetSyncSettingsClient(): void {
	serverQueryClient().removeQueries({ queryKey: ["sync-credential"] });
	serverQueryClient().removeQueries({ queryKey: ["sync-cards"] });
	serverQueryClient().removeQueries({ queryKey: ["sync-links"] });
}

subscribeResourceScope(resetSyncSettingsClient);

export function useSyncCredential() {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{ ...credentialOptions(scope), enabled: scope.status === "ready" },
		serverQueryClient(),
	);
}

export function useSyncCards() {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{ ...cardsOptions(scope), enabled: scope.status === "ready" },
		serverQueryClient(),
	);
}

export function useSyncLinks(enabled = true) {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{ ...linksOptions(scope), enabled: scope.status === "ready" && enabled },
		serverQueryClient(),
	);
}
