import type { Account, Evaluation, Plan, Transaction } from "./model.ts";

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

/** Alias for removePlanItem; row-record removal pending — still operates on the Plan draft layer. */
export function removeAccountItem({
	plan,
	target,
}: {
	plan: Plan;
	target: RemovalTarget;
}): Plan | Error {
	return removePlanItem({ plan, target });
}

export function removePlanItem({
	plan,
	target,
}: {
	plan: Plan;
	target: RemovalTarget;
}): Plan | Error {
	if (target.kind === "accounts") {
		if (plan.accounts.length === 1)
			return new Error(
				"Keep at least one account. Add a replacement before removing this one.",
			);
		if (
			plan.transactions.some(
				(transaction) =>
					transaction.fromId === target.id || transaction.toId === target.id,
			) ||
			plan.evaluations.some((evaluation) => evaluation.accountId === target.id)
		)
			return new Error(
				"This account is used by a transaction or evaluation. Update those references before removing it.",
			);
		return {
			...plan,
			accounts: plan.accounts.filter((account) => account.id !== target.id),
		};
	}
	return {
		...plan,
		transactions: plan.transactions.filter(
			(transaction) => transaction.id !== target.id,
		),
	};
}

export function removeEvaluation({
	plan,
	id,
}: {
	plan: Plan;
	id: string;
}): Plan {
	return {
		...plan,
		evaluations: plan.evaluations.filter((item) => item.id !== id),
	};
}
