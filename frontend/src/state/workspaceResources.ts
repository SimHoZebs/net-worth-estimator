import { queryOptions, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
	ApiHttpError,
	backendToDisplayPlan,
	type FinancialModelResponse,
	type PlanConversion,
	type ServerStatus,
} from "../api/index.ts";
import { defaultScopedApiClient } from "../api/scopedClients.ts";
import {
	getResourceScope,
	subscribeResourceScope,
	type ResourceScope,
} from "../auth/resourceScope.ts";
import { serverQueryClient } from "./serverQuery.ts";
import { serverDocumentFingerprint } from "./remoteStorage.ts";
import type { RemoteApiClient } from "./workspaceStore.ts";
import { notifyError } from "./notifications.ts";

export interface ServerModel extends FinancialModelResponse {
	conversion: PlanConversion | null;
	fingerprint: string | null;
}

export function workspaceResourceKey(
	kind: "model" | "status" | "presets",
	scope = getResourceScope(),
) {
	return ["workspace-resources", scope.key, kind] as const;
}

function current(scope: ResourceScope, signal?: AbortSignal) {
	if (
		scope !== getResourceScope() ||
		scope.status !== "ready" ||
		signal?.aborted
	)
		throw new Error("The active resource changed or the request was canceled.");
}

const defaults = {
	staleTime: Infinity,
	gcTime: Infinity,
	retry: false as const,
};

export function statusOptions(
	client: RemoteApiClient = defaultScopedApiClient(),
	scope = getResourceScope(),
) {
	return queryOptions({
		...defaults,
		queryKey: workspaceResourceKey("status", scope),
		queryFn: async ({ signal }) => {
			const previousStatus = getServerStatus(scope);
			const result = await client.getStatus({ signal });
			current(scope, signal);
			if (result instanceof Error) throw result;
			if (previousStatus?.readOnly !== result.readOnly)
				serverQueryClient().setQueryData<ServerModel>(
					workspaceResourceKey("model", scope),
					(model) =>
						model?.document
							? {
									...model,
									conversion: backendToDisplayPlan({
										document: model.document,
										status: result,
									}),
								}
							: model,
				);
			return result;
		},
	});
}

export function modelOptions(
	client: RemoteApiClient = defaultScopedApiClient(),
	scope = getResourceScope(),
) {
	return queryOptions({
		...defaults,
		queryKey: workspaceResourceKey("model", scope),
		queryFn: async ({ signal }): Promise<ServerModel> => {
			try {
				const [result, status] = await Promise.all([
					client.getModel({
						signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
					}),
					serverQueryClient().fetchQuery(statusOptions(client, scope)),
				]);
				current(scope, signal);
				if (result instanceof Error) throw result;
				return {
					...result,
					conversion: result.document
						? backendToDisplayPlan({ document: result.document, status })
						: null,
					fingerprint: result.document
						? serverDocumentFingerprint(result.document)
						: null,
				};
			} catch (error) {
				if (scope === getResourceScope() && !signal.aborted)
					notifyError(
						"workspace",
						error instanceof Error
							? error.message
							: "The server model could not be loaded.",
						{
							label: "Retry server request",
							onAction: () => void reloadWorkspace(client),
						},
					);
				throw error;
			}
		},
	});
}

export function presetsOptions(
	client: RemoteApiClient = defaultScopedApiClient(),
	scope = getResourceScope(),
) {
	return queryOptions({
		...defaults,
		queryKey: workspaceResourceKey("presets", scope),
		queryFn: async ({ signal }) => {
			const result = await client.listAmountPresets({ signal });
			current(scope, signal);
			if (result instanceof Error) {
				notifyError("amount-presets", result.message);
				throw result;
			}
			return result.presets;
		},
	});
}

export function getServerModel(scope = getResourceScope()) {
	return scope.status === "ready"
		? serverQueryClient().getQueryData<ServerModel>(
				workspaceResourceKey("model", scope),
			)
		: undefined;
}
export function getServerStatus(scope = getResourceScope()) {
	return scope.status === "ready"
		? serverQueryClient().getQueryData<ServerStatus>(
				workspaceResourceKey("status", scope),
			)
		: undefined;
}
export function useServerModel(
	options: { client?: RemoteApiClient; enabled?: boolean } = {},
) {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{
			...modelOptions(options.client, scope),
			refetchOnMount: "always",
			enabled: scope.status === "ready" && (options.enabled ?? false),
		},
		serverQueryClient(),
	);
}
export function useServerStatus(
	options: { client?: RemoteApiClient; enabled?: boolean } = {},
) {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{
			...statusOptions(options.client, scope),
			refetchOnMount: "always",
			enabled: scope.status === "ready" && (options.enabled ?? false),
		},
		serverQueryClient(),
	);
}
export function useAmountPresets(
	options: { client?: RemoteApiClient; enabled?: boolean } = {},
) {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{
			...presetsOptions(options.client, scope),
			refetchOnMount: "always",
			enabled: scope.status === "ready" && (options.enabled ?? false),
		},
		serverQueryClient(),
	);
}

export function workspaceIsBusy() {
	const cache = serverQueryClient();
	return (
		cache.isFetching({ queryKey: workspaceResourceKey("model") }) > 0 ||
		cache.isMutating({
			mutationKey: ["workspace-write", getResourceScope().key, "model"],
		}) > 0
	);
}

/** Explicit refreshes retain Query's last good data. A save completes before a refresh starts. */
export async function reloadWorkspace(
	client: RemoteApiClient = defaultScopedApiClient(),
) {
	const scope = getResourceScope();
	const cache = serverQueryClient();
	const mutationKey = ["workspace-write", scope.key, "model"];
	if (cache.isMutating({ mutationKey }))
		await new Promise<void>((resolve) => {
			const stop = cache.getMutationCache().subscribe(() => {
				if (!cache.isMutating({ mutationKey })) {
					stop();
					resolve();
				}
			});
		});
	if (scope !== getResourceScope() || scope.status !== "ready") return;
	await cache.invalidateQueries({
		queryKey: ["workspace-resources", scope.key],
		refetchType: "none",
	});
	const results = await Promise.allSettled([
		cache.fetchQuery(statusOptions(client, scope)),
		cache.fetchQuery(modelOptions(client, scope)),
		cache.fetchQuery(presetsOptions(client, scope)),
	]);
	if (scope === getResourceScope() && results[1]?.status === "fulfilled") {
		// A successful explicit reload resets a temporary permission guard. Other save failures stay visible.
		for (const mutation of cache
			.getMutationCache()
			.findAll({ mutationKey, status: "error" }))
			if (
				mutation.state.error instanceof ApiHttpError &&
				mutation.state.error.status === 403
			)
				cache.getMutationCache().remove(mutation);
	}
}
