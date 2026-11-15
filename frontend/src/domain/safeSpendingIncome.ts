import type { Account, Transaction } from "./model.ts";

/** Active external recurring sources plus saved selections. Ending or disabling
 * future recurrence cannot erase receipts already linked to a selected source. */
export function incomeSourceCandidates({
	accounts,
	rules,
	incomeAccountIds,
	incomeScheduleIds = [],
	today,
}: {
	accounts: Account[];
	rules: Transaction[];
	incomeAccountIds: string[];
	incomeScheduleIds?: string[];
	today: string;
}): Transaction[] {
	const available = new Set(
		accounts
			.filter((account) => account.enabled && !account.archived)
			.map((account) => account.id),
	);
	const destinations = new Set(
		incomeAccountIds.filter((id) => available.has(id)),
	);
	const selected = new Set(incomeScheduleIds);
	return rules.filter(
		(rule) =>
			rule.kind === "schedule" &&
			(selected.has(rule.id) ||
				(rule.enabled && (rule.endDate === null || rule.endDate >= today))) &&
			rule.toId !== null &&
			destinations.has(rule.toId) &&
			rule.fromId === null,
	);
}
