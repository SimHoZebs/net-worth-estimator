import type { Account, Goal, Movement, Plan } from "./model.ts";

export type EditorTarget =
	| { kind: "account"; item: Account | null }
	| { kind: "movement"; item: Movement | null }
	| { kind: "goal"; item: Goal | null }
	| { kind: "assumptions" };
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
			plan.goals.some((goal) => goal.accountId === target.id)
		)
			return new Error(
				"This account is used by a movement or goal. Update those references before removing it.",
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

export function toggleMovement({ plan, id }: { plan: Plan; id: string }): Plan {
	return {
		...plan,
		movements: plan.movements.map((item) =>
			item.id === id ? { ...item, enabled: !item.enabled } : item,
		),
	};
}
export function setGoalEnabled({
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
		goals: plan.goals.map((item) =>
			item.id === id ? { ...item, enabled } : item,
		),
	};
}
export function removeGoal({ plan, id }: { plan: Plan; id: string }): Plan {
	return { ...plan, goals: plan.goals.filter((item) => item.id !== id) };
}
