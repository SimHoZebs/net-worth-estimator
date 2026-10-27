import { queryOptions, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
	getFinancialModel,
	getAmountResolvers,
	getServerStatus as fetchServerStatus,
	listAmountPresets,
} from "@/api/generated/endpoints.ts";
import { ApiHttpError } from "@/api/http.ts";
import {
	backendToDisplayPlan,
	type AmountPreset,
	type FinancialModelResponse,
	type PlanConversion,
	type ServerStatus,
} from "@/api/index.ts";
import {
	getResourceScope,
	subscribeResourceScope,
	type ResourceScope,
} from "@/auth/resourceScope.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import { serverDocumentFingerprint } from "@/state/remoteStorage.ts";
import { notifyError } from "@/state/notifications.ts";

export interface ServerModel extends FinancialModelResponse {
	conversion: PlanConversion | null;
	fingerprint: string | null;
}

export function workspaceResourceKey(
	kind: "model" | "status" | "presets" | "resolvers",
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

export function statusOptions(scope = getResourceScope()) {
	return queryOptions({
		...defaults,
		queryKey: workspaceResourceKey("status", scope),
		queryFn: async ({ signal }) => {
			const previousStatus = getServerStatus(scope);
			const result: ServerStatus = (await fetchServerStatus({ signal })).data;
			current(scope, signal);
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

export function modelOptions(scope = getResourceScope()) {
	return queryOptions({
		...defaults,
		queryKey: workspaceResourceKey("model", scope),
		queryFn: async ({ signal }): Promise<ServerModel> => {
			try {
				const [result, status] = await Promise.all([
					(
						await getFinancialModel({
							signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
						})
					).data as unknown as FinancialModelResponse,
					serverQueryClient().fetchQuery(statusOptions(scope)),
				]);
				current(scope, signal);
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
							onAction: () => void reloadWorkspace(),
						},
					);
				throw error;
			}
		},
	});
}

export function presetsOptions(scope = getResourceScope()) {
	return queryOptions({
		...defaults,
		queryKey: workspaceResourceKey("presets", scope),
		queryFn: async ({ signal }) => {
			try {
				const result = (await listAmountPresets({ signal })).data;
				current(scope, signal);
				return (result.presets ?? []) as unknown as AmountPreset[];
			} catch (error) {
				if (scope === getResourceScope() && !signal.aborted)
					notifyError(
						"amount-presets",
						error instanceof Error
							? error.message
							: "The amount presets could not be loaded.",
					);
				throw error;
			}
		},
	});
}

export function resolversOptions(scope = getResourceScope()) {
	return queryOptions({
		...defaults,
		queryKey: workspaceResourceKey("resolvers", scope),
		queryFn: async ({ signal }) => {
			current(scope, signal);
			const result = (await getAmountResolvers({ signal })).data;
			current(scope, signal);
			return result;
		},
	});
}

export function useAmountResolvers() {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{
			...resolversOptions(scope),
			enabled: scope.status === "ready",
		},
		serverQueryClient(),
	);
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
export function useServerModel(options: { enabled?: boolean } = {}) {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{
			...modelOptions(scope),
			refetchOnMount: "always",
			enabled: scope.status === "ready" && (options.enabled ?? false),
		},
		serverQueryClient(),
	);
}
export function useServerStatus(options: { enabled?: boolean } = {}) {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{
			...statusOptions(scope),
			refetchOnMount: "always",
			enabled: scope.status === "ready" && (options.enabled ?? false),
		},
		serverQueryClient(),
	);
}
export function useAmountPresets(options: { enabled?: boolean } = {}) {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{
			...presetsOptions(scope),
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
export async function reloadWorkspace() {
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
		cache.fetchQuery(statusOptions(scope)),
		cache.fetchQuery(modelOptions(scope)),
		cache.fetchQuery(presetsOptions(scope)),
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
