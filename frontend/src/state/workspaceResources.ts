import { queryOptions, useQuery } from "@tanstack/react-query";
import { getUserScope, type UserScope } from "@/auth/resourceScope.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import { notifyError } from "@/state/notifications.ts";
import { useUserScope } from "@/state/useUserScope.ts";
import {
	getAmountResolvers,
	getServerStatus as fetchServerStatus,
	listAccountBalances,
	listAmountPresets,
	listCheckpoints,
	listEvaluationSummary,
	listPlannedPurchases,
	listSchedules,
	listTransactionCatalog,
	listTransactions,
} from "@/api/generated/endpoints.ts";
import type { AccountBalanceRow } from "@/api/generated/model/accountBalanceRow.ts";
import type { Checkpoint } from "@/api/generated/model/checkpoint.ts";
import type { ListCheckpointsParams } from "@/api/generated/model/listCheckpointsParams.ts";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import type { TransactionRow } from "@/api/generated/model/transactionRow.ts";
import type { AmountPreset as GeneratedAmountPreset } from "@/api/generated/model/amountPreset.ts";
import type { EvaluationInstanceInterface } from "@/api/generated/model/evaluationInstanceInterface.ts";
import type { PlannedPurchase as GeneratedPlannedPurchase } from "@/api/generated/model/plannedPurchase.ts";
import { ApiHttpError } from "@/api/http.ts";
import {
	type AmountPreset,
	type BackendPlannedPurchase,
	type EvaluationConfig,
	type EvaluationInstance,
	type EvaluationTables,
	type FinancialModelResponse,
	type ServerStatus,
} from "@/api/index.ts";

/** @deprecated Row queries own the workspace; this alias remains for fixture types. */
export type ServerModel = FinancialModelResponse;

export function userResourceKey(
	kind:
		| "status"
		| "presets"
		| "resolvers"
		| "balances"
		| "transactions"
		| "rules"
		| "purchases"
		| "catalog"
		| "eval-summary"
		| "checkpoints",
	scope = getUserScope(),
) {
	return ["user-resources", scope.key, kind] as const;
}

function current(scope: UserScope, signal?: AbortSignal) {
	if (scope !== getUserScope() || scope.status !== "ready" || signal?.aborted)
		throw new Error("The active user changed or the request was canceled.");
}

const defaults = {
	staleTime: Infinity,
	gcTime: Infinity,
	retry: false as const,
};

export function statusOptions(scope = getUserScope()) {
	return queryOptions({
		...defaults,
		queryKey: userResourceKey("status", scope),
		queryFn: async ({ signal }) => {
			const result: ServerStatus = (await fetchServerStatus({ signal })).data;
			current(scope, signal);
			return result;
		},
	});
}

/** Single normalization for a generated preset row into the display shape. */
function normalizePreset(row: GeneratedAmountPreset): AmountPreset {
	return {
		id: row.id,
		name: row.name,
		label: row.label,
		summary: row.summary ?? null,
		whenUse: row.whenUse ?? null,
		amount: row.amount as AmountPreset["amount"],
		enabled: row.enabled,
	};
}

/** Single normalization for a generated evaluation instance into the display shape. */
function normalizeEvaluationInstance(
	row: EvaluationInstanceInterface,
): EvaluationInstance {
	return {
		instanceId: row.instanceId,
		name: row.name,
		enabled: row.enabled,
		config: row.config as EvaluationConfig,
	};
}

/** Single normalization for a generated planned-purchase row. */
function normalizePurchase(
	row: GeneratedPlannedPurchase,
): BackendPlannedPurchase {
	return {
		id: row.id,
		name: row.name,
		fundingAccountId: row.fundingAccountId ?? null,
		cost: row.cost,
		earliestDate: row.earliestDate,
		enabled: row.enabled,
		priority: row.priority,
	};
}

export function presetsOptions(scope = getUserScope()) {
	return queryOptions({
		...defaults,
		queryKey: userResourceKey("presets", scope),
		queryFn: async ({ signal }) => {
			try {
				const result = (await listAmountPresets({ signal })).data;
				current(scope, signal);
				return (result.presets ?? []).map(normalizePreset);
			} catch (error) {
				if (scope === getUserScope() && !signal.aborted)
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

export function resolversOptions(scope = getUserScope()) {
	return queryOptions({
		...defaults,
		queryKey: userResourceKey("resolvers", scope),
		queryFn: async ({ signal }) => {
			current(scope, signal);
			const result = (await getAmountResolvers({ signal })).data;
			current(scope, signal);
			return result;
		},
	});
}

export function useAmountResolvers() {
	const scope = useUserScope();
	return useQuery(
		{
			...resolversOptions(scope),
			enabled: scope.status === "ready",
		},
		serverQueryClient(),
	);
}

export function getServerStatus(scope = getUserScope()) {
	return scope.status === "ready"
		? serverQueryClient().getQueryData<ServerStatus>(
				userResourceKey("status", scope),
			)
		: undefined;
}
// Startup activation: readers observe cache without fetching.
export function useServerStatus(options: { enabled?: boolean } = {}) {
	const scope = useUserScope();
	return useQuery(
		{
			...statusOptions(scope),
			refetchOnMount: "always",
			enabled: options.enabled ?? false,
		},
		serverQueryClient(),
	);
}
export function useAmountPresets(options: { enabled?: boolean } = {}) {
	const scope = useUserScope();
	return useQuery(
		{
			...presetsOptions(scope),
			refetchOnMount: "always",
			enabled: options.enabled ?? false,
		},
		serverQueryClient(),
	);
}

export function workspaceIsBusy() {
	const cache = serverQueryClient();
	return (
		cache.isFetching({ queryKey: userResourceKey("status") }) > 0 ||
		cache.isMutating({
			mutationKey: ["workspace-write", getUserScope().key, "model"],
		}) > 0
	);
}

/**
 * Explicit refreshes retain Query's last good data. A save completes before a
 * refresh starts. `waitForWrites: false` is for a refresh already running
 * inside the guarded write, whose own mutation would otherwise deadlock it.
 * Returns whether the status and projection rows fetched. Only presets
 * and catalog stay best-effort: the projection reads the six rows, so
 * a failed row must leave the stamp unapplied for retry.
 */
export async function reloadWorkspace(
	options: { waitForWrites?: boolean } = {},
): Promise<boolean> {
	const scope = getUserScope();
	const cache = serverQueryClient();
	const mutationKey = ["workspace-write", scope.key, "model"];
	if ((options.waitForWrites ?? true) && cache.isMutating({ mutationKey }))
		await new Promise<void>((resolve) => {
			const stop = cache.getMutationCache().subscribe(() => {
				if (!cache.isMutating({ mutationKey })) {
					stop();
					resolve();
				}
			});
		});
	if (scope !== getUserScope() || scope.status !== "ready") return false;
	await cache.invalidateQueries({
		queryKey: ["user-resources", scope.key],
		refetchType: "none",
	});
	const results = await Promise.allSettled([
		cache.fetchQuery(statusOptions(scope)),
		cache.fetchQuery(presetsOptions(scope)),
		cache.fetchQuery(balancesOptions(scope)),
		cache.fetchQuery(catalogOptions(scope)),
		cache.fetchQuery(evalSummaryOptions(scope)),
		cache.fetchQuery(transactionsOptions(scope)),
		cache.fetchQuery(schedulesOptions(scope)),
		cache.fetchQuery(checkpointsOptions(scope)),
		cache.fetchQuery(purchasesOptions(scope)),
	]);
	const requiredIdx = [0, 2, 4, 5, 6, 7, 8] as const;
	const requiredOk = requiredIdx.every(
		(index) => results[index]?.status === "fulfilled",
	);
	const statusOk = results[0]?.status === "fulfilled";
	if (scope === getUserScope() && statusOk) {
		// A successful explicit reload resets a temporary permission guard.
		// Each failed row keeps its last good data; callers stay retryable.
		for (const mutation of cache
			.getMutationCache()
			.findAll({ mutationKey, status: "error" }))
			if (
				mutation.state.error instanceof ApiHttpError &&
				mutation.state.error.status === 403
			)
				cache.getMutationCache().remove(mutation);
	}
	return requiredOk && scope === getUserScope();
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

export interface ScheduleList {
	schedules: Schedule[];
	revision: string | null;
}

export interface PurchaseList {
	plannedPurchases: BackendPlannedPurchase[];
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

export function balancesOptions(scope = getUserScope(), asOf?: string) {
	return queryOptions({
		...defaults,
		queryKey: [...userResourceKey("balances", scope), asOf ?? "latest"],
		queryFn: async ({ signal }): Promise<AccountBalances> => {
			const result = (
				await listAccountBalances(asOf ? { asOf } : undefined, { signal })
			).data;
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
	scope = getUserScope(),
	filters: { accountId?: string } = {},
) {
	const { accountId } = filters;
	return queryOptions({
		...defaults,
		queryKey: [...userResourceKey("transactions", scope), accountId ?? ""],
		queryFn: async ({ signal }): Promise<TransactionList> => {
			const result = (
				await listTransactions(accountId ? { accountId } : {}, {
					signal,
				})
			).data;
			current(scope, signal);
			return {
				transactions: result.transactions ?? [],
				revision: result.revision ?? null,
			};
		},
	});
}

export function schedulesOptions(
	scope = getUserScope(),
	filters: { accountId?: string } = {},
) {
	const { accountId } = filters;
	return queryOptions({
		...defaults,
		queryKey: [...userResourceKey("rules", scope), accountId ?? ""],
		queryFn: async ({ signal }): Promise<ScheduleList> => {
			const result = (
				await listSchedules(accountId ? { accountId } : {}, { signal })
			).data;
			current(scope, signal);
			return {
				schedules: result.schedules ?? [],
				revision: result.revision ?? null,
			};
		},
	});
}

export function purchasesOptions(scope = getUserScope()) {
	return queryOptions({
		...defaults,
		queryKey: userResourceKey("purchases", scope),
		queryFn: async ({ signal }): Promise<PurchaseList> => {
			const result = (await listPlannedPurchases({ signal })).data;
			current(scope, signal);
			return {
				plannedPurchases: (result.plannedPurchases ?? []).map(
					normalizePurchase,
				),
				revision: result.revision ?? null,
			};
		},
	});
}

export function catalogOptions(scope = getUserScope()) {
	return queryOptions({
		...defaults,
		queryKey: userResourceKey("catalog", scope),
		queryFn: async ({ signal }): Promise<TransactionCatalog> => {
			const result = (await listTransactionCatalog({ signal })).data;
			current(scope, signal);
			return {
				items: result.items ?? [],
				revision: result.revision ?? null,
			};
		},
	});
}

export function useAccountBalances(options: { asOf?: string } = {}) {
	const scope = useUserScope();
	return useQuery(
		{
			...balancesOptions(scope, options.asOf),
			refetchOnMount: "always",
			enabled: scope.status === "ready",
		},
		serverQueryClient(),
	);
}

export function getAccountBalances(scope = getUserScope()) {
	return scope.status === "ready"
		? serverQueryClient().getQueryData<AccountBalances>([
				...userResourceKey("balances", scope),
				"latest",
			])
		: undefined;
}

/**
 * Refresh the accounts view after a save: balances and checkpoints
 * refetch. Marking the rows stale is not enough: nothing
 * refetches them until the next remount.
 */
export async function refreshAccounts(): Promise<void> {
	const scope = getUserScope();
	const cache = serverQueryClient();
	await cache.invalidateQueries({
		queryKey: userResourceKey("balances", scope),
	});
	await cache.invalidateQueries({
		queryKey: userResourceKey("checkpoints", scope),
	});
	if (scope !== getUserScope() || scope.status !== "ready") return;
	// Refetch so new rows are visible immediately without waiting for remount.
	const settled = await Promise.allSettled([
		cache.fetchQuery(balancesOptions(scope)),
	]);
	for (const result of settled)
		if (result.status === "rejected") throw result.reason;
}

export function useTransactions(filters: { accountId?: string } = {}) {
	const scope = useUserScope();
	return useQuery(
		{
			...transactionsOptions(scope, filters),
			refetchOnMount: "always",
			enabled: scope.status === "ready",
		},
		serverQueryClient(),
	);
}

export function useSchedules(filters: { accountId?: string } = {}) {
	const scope = useUserScope();
	return useQuery(
		{
			...schedulesOptions(scope, filters),
			refetchOnMount: "always",
			enabled: scope.status === "ready",
		},
		serverQueryClient(),
	);
}

export function usePlannedPurchases(options: { enabled?: boolean } = {}) {
	const scope = useUserScope();
	return useQuery(
		{
			...purchasesOptions(scope),
			refetchOnMount: "always",
			enabled: options.enabled ?? scope.status === "ready",
		},
		serverQueryClient(),
	);
}

export function useTransactionCatalog() {
	const scope = useUserScope();
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
 * refetch. Marking the rows stale is not enough: nothing
 * refetches them until the next remount.
 */
export async function refreshTransactions(): Promise<void> {
	const scope = getUserScope();
	const cache = serverQueryClient();
	await cache.invalidateQueries({
		queryKey: userResourceKey("transactions", scope),
	});
	await cache.invalidateQueries({
		queryKey: userResourceKey("rules", scope),
	});
	await cache.invalidateQueries({
		queryKey: userResourceKey("catalog", scope),
	});
	if (scope !== getUserScope() || scope.status !== "ready") return;
	// Refetch so new rows are visible immediately; failures throw instead of hiding.
	const settled = await Promise.allSettled([
		cache.fetchQuery(transactionsOptions(scope)),
		cache.fetchQuery(schedulesOptions(scope)),
	]);
	for (const result of settled)
		if (result.status === "rejected") throw result.reason;
}

export function checkpointsOptions(
	scope = getUserScope(),
	filters: ListCheckpointsParams = {},
) {
	const { accountId, since, until } = filters;
	return queryOptions({
		...defaults,
		queryKey: [
			...userResourceKey("checkpoints", scope),
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
			).data;
			current(scope, signal);
			return {
				checkpoints: result.checkpoints ?? [],
				revision: result.revision ?? null,
			};
		},
	});
}

export function evalSummaryOptions(scope = getUserScope()) {
	return queryOptions({
		...defaults,
		queryKey: userResourceKey("eval-summary", scope),
		queryFn: async ({ signal }): Promise<EvaluationSummary> => {
			const result = (await listEvaluationSummary({ signal })).data;
			current(scope, signal);
			const tables = result.evaluations;
			const normalize = (
				rows: EvaluationInstanceInterface[] | null | undefined,
			): EvaluationInstance[] => (rows ?? []).map(normalizeEvaluationInstance);
			return {
				evaluations: {
					financialIndependence: normalize(tables.financialIndependence),
					netWorthThreshold: normalize(tables.netWorthThreshold),
					accountBalance: normalize(tables.accountBalance),
					transactionFulfillment: normalize(tables.transactionFulfillment),
					cycleFulfillment: normalize(tables.cycleFulfillment),
					plannedPurchases: normalize(tables.plannedPurchases),
				},
				revision: result.revision ?? null,
			};
		},
	});
}

export function useCheckpoints(filters: ListCheckpointsParams = {}) {
	const scope = useUserScope();
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
	scope = getUserScope(),
	filters: ListCheckpointsParams = {},
) {
	const { accountId, since, until } = filters;
	return scope.status === "ready"
		? serverQueryClient().getQueryData<CheckpointList>([
				...userResourceKey("checkpoints", scope),
				accountId ?? "",
				since ?? "",
				until ?? "",
			])
		: undefined;
}

export function useEvaluationSummary() {
	const scope = useUserScope();
	return useQuery(
		{
			...evalSummaryOptions(scope),
			refetchOnMount: "always",
			enabled: scope.status === "ready",
		},
		serverQueryClient(),
	);
}

export function getEvaluationSummary(scope = getUserScope()) {
	return scope.status === "ready"
		? serverQueryClient().getQueryData<EvaluationSummary>(
				userResourceKey("eval-summary", scope),
			)
		: undefined;
}

/**
 * Refresh the evaluations view after a save: the summary refetches for the
 * grids. Marking the row stale is not enough: nothing refetches it
 * until the next remount.
 */
export async function refreshEvaluations(): Promise<void> {
	const scope = getUserScope();
	const cache = serverQueryClient();
	await cache.invalidateQueries({
		queryKey: userResourceKey("eval-summary", scope),
	});
	if (scope !== getUserScope() || scope.status !== "ready") return;
	// Refetch so the new row is visible immediately.
	const settled = await Promise.allSettled([
		cache.fetchQuery(evalSummaryOptions(scope)),
	]);
	for (const result of settled)
		if (result.status === "rejected") throw result.reason;
}

export function getScheduleList(scope = getUserScope()) {
	return scope.status === "ready"
		? serverQueryClient().getQueryData<ScheduleList>([
				...userResourceKey("rules", scope),
				"",
			])
		: undefined;
}

export function getTransactionList(scope = getUserScope()) {
	return scope.status === "ready"
		? serverQueryClient().getQueryData<TransactionList>([
				...userResourceKey("transactions", scope),
				"",
			])
		: undefined;
}
