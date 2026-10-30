import type { Transaction, Plan } from "./model.ts";
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
		frequency: Transaction["frequency"];
		amount: number;
		nextPayment: IncomePayment | null;
	}[];
	selectedRuleIds: string[];
	paycheck: (IncomePayment & { endDate: string }) | null;
}

/**
 * Income sources are explicit positive recurring inflows into the selected
 * income accounts. Transfers within those accounts do not add income. Each
 * source contributes its next server-projected requested payment, once per
 * rule.
 */
export function safeSpendingIncome({
	plan,
	transactions,
	incomeAccountIds,
	incomeRuleIds,
	todayIso,
}: {
	plan: Plan;
	transactions: TransactionResult[];
	incomeAccountIds: string[];
	incomeRuleIds: string[];
	todayIso: string;
}): SafeSpendingIncome {
	const today = todayIso.slice(0, 10);
	const availableAccounts = new Set(
		plan.accounts
			.filter((account) => account.enabled && !account.archived)
			.map((account) => account.id),
	);
	const destinations = new Set(
		incomeAccountIds.filter((id) => availableAccounts.has(id)),
	);
	const rules = plan.transactions.filter(
		(rule) =>
			rule.enabled &&
			rule.frequency !== "once" &&
			rule.startDate <= today &&
			(rule.endDate === null || rule.endDate >= today) &&
			rule.toId !== null &&
			destinations.has(rule.toId) &&
			(rule.fromId === null ||
				(availableAccounts.has(rule.fromId) && !destinations.has(rule.fromId))),
	);
	const nextPayments = nextProjectedPayments({
		transactions,
		rules,
		todayIso,
	});
	const selected = new Set(incomeRuleIds);
	const selectedRuleIds = rules
		.filter((rule) => selected.has(rule.id))
		.map((rule) => rule.id);
	const payments = selectedRuleIds.flatMap((id) => nextPayments.get(id) ?? []);
	const dates = payments.map((payment) => payment.date).sort();
	return {
		candidates: rules.map((rule) => ({
			id: rule.id,
			name: rule.name,
			frequency: rule.frequency,
			amount: rule.amount,
			nextPayment: nextPayments.get(rule.id) ?? null,
		})),
		selectedRuleIds,
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
