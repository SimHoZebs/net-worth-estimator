import type { Movement, Plan } from "./model.ts";
import type { MovementResult } from "./result.ts";

export interface IncomePayment {
	date: string;
	amount: number;
}

export interface SafeSpendingIncome {
	candidates: {
		id: string;
		name: string;
		frequency: Movement["frequency"];
		nextPayment: IncomePayment | null;
	}[];
	selectedRuleIds: string[];
	paycheck: (IncomePayment & { endDate: string }) | null;
}

/**
 * Income sources are explicit active recurrence rules into selected cash
 * accounts. Transfers between those accounts do not add income. Each source
 * contributes its next server-projected requested payment, once per rule.
 */
export function safeSpendingIncome({
	plan,
	movements,
	spendingAccountIds,
	incomeRuleIds,
	todayIso,
}: {
	plan: Plan;
	movements: MovementResult[];
	spendingAccountIds: string[];
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
		spendingAccountIds.filter((id) => availableAccounts.has(id)),
	);
	const rules = plan.movements.filter(
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
	const known = new Map(rules.map((rule) => [rule.id, rule]));
	const nextPayments = new Map<string, IncomePayment>();
	for (const movement of movements) {
		const rule = known.get(movement.movementId);
		if (!rule || movement.date <= today || movement.requested <= 0) continue;
		if (rule.endDate !== null && movement.date > rule.endDate) continue;
		const previous = nextPayments.get(rule.id);
		if (!previous || movement.date < previous.date) {
			nextPayments.set(rule.id, {
				date: movement.date,
				amount: movement.requested,
			});
		} else if (movement.date === previous.date) {
			previous.amount += movement.requested;
		}
	}
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
