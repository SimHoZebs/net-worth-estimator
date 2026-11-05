import type { Account, Transaction } from "./model.ts";
import { nextProjectedPayments } from "./nextProjectedPayment.ts";
import type { TransactionResult } from "./result.ts";

export interface IncomePayment {
	date: string;
	amount: number;
}

export interface SafeSpendingIncome {
	candidates: {
		id: string;
		name: string;
		amount: number;
		nextPayment: IncomePayment | null;
	}[];
	selectedScheduleIds: string[];
	paycheck: (IncomePayment & { endDate: string }) | null;
}

/**
 * Income sources are explicit positive recurring inflows into the selected
 * income accounts. Transfers within those accounts do not add income. Each
 * source contributes its next server-projected requested payment, once per
 * rule.
 */
export function safeSpendingIncome({
	accounts,
	rules,
	transactions,
	incomeAccountIds,
	incomeScheduleIds,
	todayIso,
}: {
	accounts: Account[];
	rules: Transaction[];
	transactions: TransactionResult[];
	incomeAccountIds: string[];
	incomeScheduleIds: string[];
	todayIso: string;
}): SafeSpendingIncome {
	const today = todayIso.slice(0, 10);
	const availableAccounts = new Set(
		accounts
			.filter((account) => account.enabled && !account.archived)
			.map((account) => account.id),
	);
	const destinations = new Set(
		incomeAccountIds.filter((id) => availableAccounts.has(id)),
	);
	const eligible = rules.filter(
		(rule) =>
			rule.enabled &&
			rule.kind === "schedule" &&
			rule.startDate <= today &&
			(rule.endDate === null || rule.endDate >= today) &&
			rule.toId !== null &&
			destinations.has(rule.toId) &&
			(rule.fromId === null ||
				(availableAccounts.has(rule.fromId) && !destinations.has(rule.fromId))),
	);
	const nextPayments = nextProjectedPayments({
		transactions,
		rules: eligible,
		todayIso,
	});
	const selected = new Set(incomeScheduleIds);
	const selectedScheduleIds = eligible
		.filter((rule) => selected.has(rule.id))
		.map((rule) => rule.id);
	const payments = selectedScheduleIds.flatMap(
		(id) => nextPayments.get(id) ?? [],
	);
	const dates = payments.map((payment) => payment.date).sort();
	return {
		candidates: eligible.map((rule) => ({
			id: rule.id,
			name: rule.name,
			amount: rule.amount,
			nextPayment: nextPayments.get(rule.id) ?? null,
		})),
		selectedScheduleIds,
		paycheck: dates.length
			? {
					date: dates[0]!,
					endDate: dates.at(-1)!,
					amount: payments.reduce(
						(total, payment) => total + payment.amount,
						0,
					),
				}
			: null,
	};
}
