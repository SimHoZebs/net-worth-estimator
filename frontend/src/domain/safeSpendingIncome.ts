import type { Account, Transaction } from "./model.ts";
import { nextProjectedPayments } from "./nextProjectedPayment.ts";
import type { TransactionResult } from "./result.ts";

export interface IncomePayment {
	date: string;
	amount: number;
}

export interface IncomeBundle {
	/** Bundle start and end: the first selected payment after the boundary, per source. */
	date: string;
	endDate: string;
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
	paycheck: IncomeBundle | null;
}

interface IncomeSelection {
	eligible: Transaction[];
	selectedScheduleIds: string[];
}

/**
 * Income sources are explicit positive recurring inflows into the selected
 * income accounts. Transfers within those accounts do not add income. Each
 * source contributes its next server-projected requested payment, once per
 * rule. Rules remain selectable before their start date so a workspace can
 * be configured ahead of the first payday; the projection decides whether
 * an occurrence follows.
 */
function selectIncome({
	accounts,
	rules,
	incomeAccountIds,
	incomeScheduleIds,
	todayIso,
}: {
	accounts: Account[];
	rules: Transaction[];
	incomeAccountIds: string[];
	incomeScheduleIds: string[];
	todayIso: string;
}): IncomeSelection {
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
			(rule.endDate === null || rule.endDate >= today) &&
			rule.toId !== null &&
			destinations.has(rule.toId) &&
			(rule.fromId === null ||
				(availableAccounts.has(rule.fromId) && !destinations.has(rule.fromId))),
	);
	const selected = new Set(incomeScheduleIds);
	const selectedScheduleIds = eligible
		.filter((rule) => selected.has(rule.id))
		.map((rule) => rule.id);
	return { eligible, selectedScheduleIds };
}

/**
 * The first bundle of selected income after `afterIso`: the earliest
 * occurrence per selected source, summed. Mirrors the "next paycheck"
 * bundle, re-anchored per statement so each statement can name the payday
 * that settles it.
 */
function bundleAfter({
	selectedScheduleIds,
	nextPayments,
}: {
	selectedScheduleIds: string[];
	nextPayments: Map<string, IncomePayment>;
}): IncomeBundle | null {
	const payments = selectedScheduleIds.flatMap(
		(id) => nextPayments.get(id) ?? [],
	);
	const dates = payments.map((payment) => payment.date).sort();
	return dates.length
		? {
				date: dates[0]!,
				endDate: dates.at(-1)!,
				amount: payments.reduce((total, payment) => total + payment.amount, 0),
			}
		: null;
}

export function safeSpendingIncome(input: {
	accounts: Account[];
	rules: Transaction[];
	transactions: TransactionResult[];
	incomeAccountIds: string[];
	incomeScheduleIds: string[];
	todayIso: string;
}): SafeSpendingIncome {
	const { eligible, selectedScheduleIds } = selectIncome(input);
	const today = input.todayIso.slice(0, 10);
	const nextPayments = nextProjectedPayments({
		transactions: input.transactions,
		rules: eligible,
		todayIso: today,
	});
	return {
		candidates: eligible.map((rule) => ({
			id: rule.id,
			name: rule.name,
			amount: rule.amount,
			nextPayment: nextPayments.get(rule.id) ?? null,
		})),
		selectedScheduleIds,
		paycheck: bundleAfter({ selectedScheduleIds, nextPayments }),
	};
}

/**
 * The statement-settlement bundle: the earliest payment per selected source
 * arriving after `afterIso`. Ended rules stay excluded; otherwise the
 * occurrence window moves, so each statement names the payday that settles
 * it.
 */
export function incomeBundleAfter(input: {
	accounts: Account[];
	rules: Transaction[];
	transactions: TransactionResult[];
	incomeAccountIds: string[];
	incomeScheduleIds: string[];
	/** Statement anchor: the bundle starts strictly after this date. */
	afterIso: string;
	todayIso: string;
}): IncomeBundle | null {
	const { eligible, selectedScheduleIds } = selectIncome(input);
	const nextPayments = nextProjectedPayments({
		transactions: input.transactions,
		rules: eligible,
		todayIso: input.afterIso.slice(0, 10),
	});
	return bundleAfter({ selectedScheduleIds, nextPayments });
}
