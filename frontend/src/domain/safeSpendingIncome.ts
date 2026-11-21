import type { Account, Transaction } from "./model.ts";

/** Explicit recurring inflows into the configured cash accounts. Future
 * starts remain selectable; payment eligibility is decided from posted facts. */
export function incomeSourceCandidates({
	accounts,
	rules,
	spendingIds,
	incomeScheduleIds = [],
	today,
}: {
	accounts: Account[];
	rules: Transaction[];
	spendingIds: string[];
	incomeScheduleIds?: string[];
	today: string;
}): Transaction[] {
	const available = new Set(
		accounts
			.filter((account) => account.enabled && !account.archived)
			.map((account) => account.id),
	);
	const destinations = new Set(spendingIds.filter((id) => available.has(id)));
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
