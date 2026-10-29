import { queryOptions, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
	getFinancialModel,
	getAmountResolvers,
	getServerStatus as fetchServerStatus,
	listAccountBalances,
	listAmountPresets,
	listCheckpoints,
	listEvaluationSummary,
	listTransactionCatalog,
	listTransactions,
} from "@/api/generated/endpoints.ts";
import type { AccountBalanceRow } from "@/api/generated/model/accountBalanceRow.ts";
import type { Checkpoint } from "@/api/generated/model/checkpoint.ts";
import type { ListCheckpointsParams } from "@/api/generated/model/listCheckpointsParams.ts";
import type { TransactionRow } from "@/api/generated/model/transactionRow.ts";
import { ApiHttpError } from "@/api/http.ts";
import {
	backendToDisplayPlan,
	type AmountPreset,
	type EvaluationTables,
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
	kind:
		| "model"
		| "status"
		| "presets"
		| "resolvers"
		| "balances"
		| "transactions"
		| "catalog"
		| "eval-summary"
		| "checkpoints",
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
		cache.fetchQuery(balancesOptions(scope)),
		cache.fetchQuery(catalogOptions(scope)),
		cache.fetchQuery(evalSummaryOptions(scope)),
		cache.fetchQuery(transactionsOptions(scope)),
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

export interface AccountBalances {
	accounts: AccountBalanceRow[];
	asOf: string;
	revision: string | null;
}

export interface TransactionList {
	transactions: TransactionRow[];
	revision: string | null;
}

export interface TransactionCatalog {
	items: { id: string; kind: string; name: string }[];
	revision: string | null;
}

export interface CheckpointList {
	checkpoints: Checkpoint[];
	revision: string | null;
}

export interface EvaluationSummary {
	evaluations: EvaluationTables;
	revision: string | null;
}

export function balancesOptions(scope = getResourceScope(), asOf?: string) {
	return queryOptions({
		...defaults,
		queryKey: [...workspaceResourceKey("balances", scope), asOf ?? "latest"],
		queryFn: async ({ signal }): Promise<AccountBalances> => {
			const result = (
				await listAccountBalances(asOf ? { asOf } : undefined, { signal })
			).data as unknown as {
				accounts?: AccountBalanceRow[] | null;
				asOf?: string;
				revision?: string;
			};
			current(scope, signal);
			return {
				accounts: result.accounts ?? [],
				asOf: result.asOf ?? "",
				revision: result.revision ?? null,
			};
		},
	});
}

export function transactionsOptions(
	scope = getResourceScope(),
	filters: {
		accountId?: string;
		recurring?: "once" | "recurring" | "all";
	} = {},
) {
	const { accountId, recurring } = filters;
	return queryOptions({
		...defaults,
		queryKey: [
			...workspaceResourceKey("transactions", scope),
			accountId ?? "",
			recurring ?? "all",
		],
		queryFn: async ({ signal }): Promise<TransactionList> => {
			const result = (
				await listTransactions(
					{
						...(accountId ? { accountId } : {}),
						...(recurring && recurring !== "all" ? { recurring } : {}),
					},
					{ signal },
				)
			).data as unknown as {
				transactions?: TransactionRow[] | null;
				revision?: string;
			};
			current(scope, signal);
			return {
				transactions: result.transactions ?? [],
				revision: result.revision ?? null,
			};
		},
	});
}

export function catalogOptions(scope = getResourceScope()) {
	return queryOptions({
		...defaults,
		queryKey: workspaceResourceKey("catalog", scope),
		queryFn: async ({ signal }): Promise<TransactionCatalog> => {
			const result = (await listTransactionCatalog({ signal }))
				.data as unknown as {
				items?: { id: string; kind: string; name: string }[] | null;
				revision?: string;
			};
			current(scope, signal);
			return {
				items: result.items ?? [],
				revision: result.revision ?? null,
			};
		},
	});
}

export function useAccountBalances(options: { asOf?: string } = {}) {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{
			...balancesOptions(scope, options.asOf),
			refetchOnMount: "always",
			enabled: scope.status === "ready",
		},
		serverQueryClient(),
	);
}

export function getAccountBalances(scope = getResourceScope()) {
	return scope.status === "ready"
		? serverQueryClient().getQueryData<AccountBalances>([
				...workspaceResourceKey("balances", scope),
				"latest",
			])
		: undefined;
}

/**
 * Refresh the accounts view after a save: balances and checkpoints
 * refetch, and so does the model, which feeds the plan conversion and
 * every projection. Marking the model stale is not enough: nothing
 * refetches it until the next remount.
 */
export async function refreshAccounts(): Promise<void> {
	const scope = getResourceScope();
	const cache = serverQueryClient();
	await cache.invalidateQueries({
		queryKey: workspaceResourceKey("balances", scope),
	});
	await cache.invalidateQueries({
		queryKey: workspaceResourceKey("checkpoints", scope),
	});
	await cache.invalidateQueries({
		queryKey: workspaceResourceKey("model", scope),
		refetchType: "none",
	});
	if (scope !== getResourceScope() || scope.status !== "ready") return;
	// Refetch the list so the new row is visible immediately; mounted
	// observers would refetch anyway, but a save should not have to wait.
	await cache.fetchQuery(balancesOptions(scope)).catch(() => {});
	await cache.fetchQuery(modelOptions(scope)).catch(() => {});
}

export function useTransactions(
	filters: {
		accountId?: string;
		recurring?: "once" | "recurring" | "all";
	} = {},
) {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{
			...transactionsOptions(scope, filters),
			refetchOnMount: "always",
			enabled: scope.status === "ready",
		},
		serverQueryClient(),
	);
}

export function useTransactionCatalog() {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{
			...catalogOptions(scope),
			refetchOnMount: "always",
			enabled: scope.status === "ready",
		},
		serverQueryClient(),
	);
}

/**
 * Refresh the transactions view after a save: transactions and the catalog
 * refetch, and so does the model, which feeds the plan conversion and
 * every projection. Marking the model stale is not enough: nothing
 * refetches it until the next remount.
 */
export async function refreshTransactions(): Promise<void> {
	const scope = getResourceScope();
	const cache = serverQueryClient();
	await cache.invalidateQueries({
		queryKey: workspaceResourceKey("transactions", scope),
	});
	await cache.invalidateQueries({
		queryKey: workspaceResourceKey("catalog", scope),
	});
	await cache.invalidateQueries({
		queryKey: workspaceResourceKey("model", scope),
		refetchType: "none",
	});
	if (scope !== getResourceScope() || scope.status !== "ready") return;
	// Refetch the list so the new row is visible immediately; mounted
	// observers would refetch anyway, but a save should not have to wait.
	await cache.fetchQuery(transactionsOptions(scope)).catch(() => {});
	await cache.fetchQuery(modelOptions(scope)).catch(() => {});
}

export function checkpointsOptions(
	scope = getResourceScope(),
	filters: ListCheckpointsParams = {},
) {
	const { accountId, since, until } = filters;
	return queryOptions({
		...defaults,
		queryKey: [
			...workspaceResourceKey("checkpoints", scope),
			accountId ?? "",
			since ?? "",
			until ?? "",
		],
		queryFn: async ({ signal }): Promise<CheckpointList> => {
			const result = (
				await listCheckpoints(
					{
						...(accountId ? { accountId } : {}),
						...(since ? { since } : {}),
						...(until ? { until } : {}),
					},
					{ signal },
				)
			).data as unknown as {
				checkpoints?: Checkpoint[] | null;
				revision?: string;
			};
			current(scope, signal);
			return {
				checkpoints: result.checkpoints ?? [],
				revision: result.revision ?? null,
			};
		},
	});
}

export function evalSummaryOptions(scope = getResourceScope()) {
	return queryOptions({
		...defaults,
		queryKey: workspaceResourceKey("eval-summary", scope),
		queryFn: async ({ signal }): Promise<EvaluationSummary> => {
			const result = (await listEvaluationSummary({ signal }))
				.data as unknown as {
				evaluations?: {
					financialIndependence?:
						| EvaluationTables["financialIndependence"]
						| null;
					netWorthThreshold?: EvaluationTables["netWorthThreshold"] | null;
					accountBalance?: EvaluationTables["accountBalance"] | null;
					postingFulfillment?: EvaluationTables["postingFulfillment"] | null;
					cycleFulfillment?: EvaluationTables["cycleFulfillment"] | null;
				} | null;
				revision?: string;
			};
			current(scope, signal);
			const tables = result.evaluations ?? {};
			return {
				evaluations: {
					financialIndependence: tables.financialIndependence ?? [],
					netWorthThreshold: tables.netWorthThreshold ?? [],
					accountBalance: tables.accountBalance ?? [],
					postingFulfillment: tables.postingFulfillment ?? [],
				},
				revision: result.revision ?? null,
			};
		},
	});
}

export function useCheckpoints(filters: ListCheckpointsParams = {}) {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{
			...checkpointsOptions(scope, filters),
			refetchOnMount: "always",
			enabled: scope.status === "ready",
		},
		serverQueryClient(),
	);
}

export function getCheckpoints(
	scope = getResourceScope(),
	filters: ListCheckpointsParams = {},
) {
	const { accountId, since, until } = filters;
	return scope.status === "ready"
		? serverQueryClient().getQueryData<CheckpointList>([
				...workspaceResourceKey("checkpoints", scope),
				accountId ?? "",
				since ?? "",
				until ?? "",
			])
		: undefined;
}

export function useEvaluationSummary() {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	return useQuery(
		{
			...evalSummaryOptions(scope),
			refetchOnMount: "always",
			enabled: scope.status === "ready",
		},
		serverQueryClient(),
	);
}

export function getEvaluationSummary(scope = getResourceScope()) {
	return scope.status === "ready"
		? serverQueryClient().getQueryData<EvaluationSummary>(
				workspaceResourceKey("eval-summary", scope),
			)
		: undefined;
}

/**
 * Refresh the evaluations view after a save: the summary refetches for the
 * grids, and so does the model, which feeds the plan conversion and every
 * projection. Marking the model stale is not enough: nothing refetches it
 * until the next remount.
 */
export async function refreshEvaluations(): Promise<void> {
	const scope = getResourceScope();
	const cache = serverQueryClient();
	await cache.invalidateQueries({
		queryKey: workspaceResourceKey("eval-summary", scope),
	});
	await cache.invalidateQueries({
		queryKey: workspaceResourceKey("model", scope),
		refetchType: "none",
	});
	if (scope !== getResourceScope() || scope.status !== "ready") return;
	// Refetch the summary so the new row is visible immediately; mounted
	// observers would refetch anyway, but a save should not have to wait.
	await cache.fetchQuery(evalSummaryOptions(scope)).catch(() => {});
	await cache.fetchQuery(modelOptions(scope)).catch(() => {});
}
