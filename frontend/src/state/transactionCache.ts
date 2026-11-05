import { getUserScope } from "@/auth/resourceScope.ts";
import { serverQueryClient } from "./serverQuery.ts";
import {
	type TransactionCatalog,
	type TransactionList,
	getServerModel,
	userResourceKey,
} from "./workspaceResources.ts";
import { isRecord } from "../domain/guards.ts";

/**
 * Removing a posting usually leaves projections untouched. Several read
 * paths still consume a posting directly: fulfillment, financial
 * independence, and what-if configurations can name it, and the projection
 * start can fall back to the first posting when no checkpoint or rule
 * supplies a date.
 */
export function transactionRemovalNeedsProjectionRefresh(id: string): boolean {
	const model = getServerModel()?.model;
	if (!model) return true;
	for (const evaluation of model.evaluations.postingFulfillment) {
		if (!isRecord(evaluation.config)) continue;
		const postingIds = evaluation.config.postingIds;
		if (Array.isArray(postingIds) && postingIds.includes(id)) return true;
	}
	for (const evaluation of model.evaluations.financialIndependence) {
		if (!isRecord(evaluation.config)) continue;
		const sources = evaluation.config.sources;
		if (
			Array.isArray(sources) &&
			sources.some((source) => isRecord(source) && source.postingId === id)
		)
			return true;
		const continuing = evaluation.config.continuingPostingIds;
		if (Array.isArray(continuing) && continuing.includes(id)) return true;
	}
	for (const evaluation of model.evaluations.whatIf ?? []) {
		if (!isRecord(evaluation.config)) continue;
		const disabled = evaluation.config.disabledPostingIds;
		if (Array.isArray(disabled) && disabled.includes(id)) return true;
		const added = evaluation.config.addedPostings;
		if (
			Array.isArray(added) &&
			added.some((posting) => isRecord(posting) && posting.id === id)
		)
			return true;
	}
	if (model.checkpoints.length > 0 || (model.schedules ?? []).length > 0)
		return false;
	return model.postings[0]?.id === id;
}

/**
 * Drop one deleted transaction from every cached transaction list and from
 * the catalog without refetching the financial model. Use this only after
 * `transactionRemovalNeedsProjectionRefresh` returns false: the removed row
 * then feeds no balance, evaluation, or projection input. The model cache can
 * keep the inert row until its next authoritative refresh.
 */
export async function removeDeletedTransactionFromCache(
	id: string,
): Promise<void> {
	const scope = getUserScope();
	if (scope.status !== "ready") return;
	const cache = serverQueryClient();
	// A list fetch that started before the delete would put the row back.
	await cache.cancelQueries({
		queryKey: userResourceKey("transactions", scope),
	});
	await cache.cancelQueries({
		queryKey: userResourceKey("catalog", scope),
	});
	if (scope !== getUserScope() || scope.status !== "ready") return;
	cache.setQueriesData<TransactionList>(
		{ queryKey: userResourceKey("transactions", scope) },
		(current) =>
			current
				? {
						...current,
						transactions: current.transactions.filter(
							(transaction) => transaction.id !== id,
						),
					}
				: current,
	);
	cache.setQueryData<TransactionCatalog>(
		userResourceKey("catalog", scope),
		(current) =>
			current
				? {
						...current,
						items: current.items.filter((item) => item.id !== id),
					}
				: current,
	);
}
