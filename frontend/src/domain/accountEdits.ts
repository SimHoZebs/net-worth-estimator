import type { Account, Evaluation, Transaction } from "./model.ts";

export type EditorTarget =
	| { kind: "account"; item: Account | null }
	| { kind: "transaction"; item: Transaction | null }
	| { kind: "evaluation"; item: Evaluation | null };
export type RemovalTarget = {
	kind: "accounts" | "transactions";
	id: string;
	name: string;
};

export function upsertItem<T extends { id: string }>({
	items,
	item,
}: {
	items: T[];
	item: T;
}): T[] {
	return items.some((existing) => existing.id === item.id)
		? items.map((existing) => (existing.id === item.id ? item : existing))
		: [...items, item];
}

/**
 * Row-level delete guards. The writers live in the components (direct
 * performSave calls); the domain only answers whether a delete is allowed
 * so every entry point shares one message.
 */
export function accountDeleteError({
	accounts,
	transactions,
	evaluations,
	targetId,
}: {
	accounts: Account[];
	transactions: Transaction[];
	evaluations: Evaluation[];
	targetId: string;
}): Error | null {
	if (accounts.length === 1)
		return new Error(
			"Keep at least one account. Add a replacement before removing this one.",
		);
	if (
		transactions.some(
			(transaction) =>
				transaction.fromId === targetId || transaction.toId === targetId,
		) ||
		evaluations.some((evaluation) => evaluation.accountId === targetId)
	)
		return new Error(
			"This account is used by a transaction or evaluation. Update those references before removing it.",
		);
	return null;
}
