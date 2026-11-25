import type { SafeSpendingSettings } from "@/api/contracts.ts";

export const SAFE_SPENDING_NUMERIC_FIELDS = [
	{ key: "cycleStartDay", label: "Cycle start day", min: 1, max: 31, step: 1 },
	{ key: "paydayDay", label: "Payday of month", min: 1, max: 31, step: 1 },
	{
		key: "savingsTarget",
		label: "Monthly savings goal ($)",
		min: 0,
		step: 0.01,
	},
] as const;

export type SafeSpendingNumericKey =
	(typeof SAFE_SPENDING_NUMERIC_FIELDS)[number]["key"];
export type SafeSpendingNumericInputs = Record<SafeSpendingNumericKey, string>;

export function safeSpendingNumericInputs(
	settings: SafeSpendingSettings,
): SafeSpendingNumericInputs {
	return {
		cycleStartDay: String(settings.cycleStartDay),
		paydayDay: String(settings.paydayDay),
		savingsTarget: String(settings.savingsTarget),
	};
}

function draftNumber(value: string): number {
	return value.trim() === "" ? Number.NaN : Number(value);
}

export function dirtySafeSpendingNumericFields(
	baseline: SafeSpendingSettings,
	inputs: SafeSpendingNumericInputs,
): Record<SafeSpendingNumericKey, boolean> {
	return {
		cycleStartDay: draftNumber(inputs.cycleStartDay) !== baseline.cycleStartDay,
		paydayDay: draftNumber(inputs.paydayDay) !== baseline.paydayDay,
		savingsTarget: draftNumber(inputs.savingsTarget) !== baseline.savingsTarget,
	};
}

export function applySafeSpendingNumericInputs(
	settings: SafeSpendingSettings,
	inputs: SafeSpendingNumericInputs,
): SafeSpendingSettings {
	return {
		...settings,
		cycleStartDay: Number(inputs.cycleStartDay),
		paydayDay: Number(inputs.paydayDay),
		savingsTarget: Number(inputs.savingsTarget),
	};
}

export function sameIds(
	left: readonly string[],
	right: readonly string[],
): boolean {
	const ids = new Set(left);
	return ids.size === new Set(right).size && right.every((id) => ids.has(id));
}

function sameIdSelection(
	left: readonly string[] | null,
	right: readonly string[] | null,
): boolean {
	return sameIds(left ?? [], right ?? []);
}

function sameAccountIds(
	left: readonly string[] | null,
	right: readonly string[] | null,
): boolean {
	if (left === null || right === null) return left === right;
	return sameIds(left, right);
}

export function sameSafeSpendingSettings(
	left: SafeSpendingSettings,
	right: SafeSpendingSettings,
): boolean {
	return (
		left.cycleStartDay === right.cycleStartDay &&
		left.paydayDay === right.paydayDay &&
		left.savingsTarget === right.savingsTarget &&
		sameAccountIds(left.accountIds, right.accountIds) &&
		sameIdSelection(left.spendingAccountIds, right.spendingAccountIds) &&
		sameIds(left.incomeScheduleIds, right.incomeScheduleIds) &&
		sameIdSelection(left.transactionIds, right.transactionIds)
	);
}

export function changedIds(
	baseline: readonly string[],
	draft: readonly string[],
): Set<string> {
	const baselineIds = new Set(baseline);
	const draftIds = new Set(draft);
	return new Set([
		...baseline.filter((id) => !draftIds.has(id)),
		...draft.filter((id) => !baselineIds.has(id)),
	]);
}
