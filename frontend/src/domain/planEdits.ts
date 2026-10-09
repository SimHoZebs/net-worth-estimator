import type { Account, Evaluation, Movement, Plan } from "./model.ts";

export type EditorTarget =
	| { kind: "account"; item: Account | null }
	| { kind: "movement"; item: Movement | null }
	| { kind: "evaluation"; item: Evaluation | null };
export type RemovalTarget = {
	kind: "accounts" | "movements";
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
				"Keep at least one account in the plan. Add a replacement before removing this one.",
			);
		if (
			plan.movements.some(
				(movement) =>
					movement.fromId === target.id || movement.toId === target.id,
			) ||
			plan.evaluations.some((evaluation) => evaluation.accountId === target.id)
		)
			return new Error(
				"This account is used by a movement or evaluation. Update those references before removing it.",
			);
		return {
			...plan,
			accounts: plan.accounts.filter((account) => account.id !== target.id),
		};
	}
	return {
		...plan,
		movements: plan.movements.filter((movement) => movement.id !== target.id),
	};
}

export function setEvaluationEnabled({
	plan,
	id,
	enabled,
}: {
	plan: Plan;
	id: string;
	enabled: boolean;
}): Plan {
	return {
		...plan,
		evaluations: plan.evaluations.map((item) =>
			item.id === id ? { ...item, enabled } : item,
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
