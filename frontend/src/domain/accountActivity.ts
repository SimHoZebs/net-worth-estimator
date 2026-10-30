import { shiftDate } from "./format.ts";
import {
	isHistoricalTransaction,
	isPendingTransaction,
	type Transaction,
	type Plan,
} from "./model.ts";
import type { Projection } from "./result.ts";
import { horizonDate } from "./result.ts";
import {
	compareTransactionDates,
	DEFAULT_TRANSACTION_ORDER,
	type TransactionOrder,
} from "./transactionSort.ts";

export interface AccountTransaction {
	id: string;
	transactionId: string;
	date: string;
	name: string;
	source: "historical" | "projected";
	direction: "in" | "out";
	category: "income" | "expense" | "transfer";
	counterparty: string;
	from: string;
	to: string;
	amount: number;
	requested: number;
	shortfall: number;
	constraint: string | null;
	excluded: boolean;
	pending: boolean;
	void: boolean;
}

export interface ActivityFilters {
	query: string;
	source: "all" | "historical" | "projected";
	direction: "all" | "in" | "out" | "transfer";
	period: "all" | "30-days" | "12-months";
	order: TransactionOrder;
}

export const defaultActivityFilters: ActivityFilters = {
	query: "",
	source: "all",
	direction: "all",
	period: "all",
	order: DEFAULT_TRANSACTION_ORDER,
};

// Account dialog default: recorded facts only. Projected occurrences stay
// accessible via the Activity filter but no longer mix into the first view.
export const defaultAccountViewFilters: ActivityFilters = {
	...defaultActivityFilters,
	source: "historical",
};

type ConnectionTransaction = Pick<
	Projection["transactions"][number],
	"fromId" | "toId" | "accountDeltas" | "requested" | "realized"
>;

// External counterparty names. A null endpoint means the external
// counterparty sits on that side. This is the single definition; call sites
// name endpoints through it instead of re-deriving null semantics.
export function externalCounterpartyName(direction: "in" | "out"): string {
	return direction === "in" ? "External income" : "External spending";
}

export function accountTransactions({
	accountId,
	plan,
	projection,
}: {
	accountId: string;
	plan: Plan;
	projection: Projection;
}): AccountTransaction[] {
	if (
		!plan.accounts.some(
			(account) => account.id === accountId && !account.archived,
		)
	)
		return [];
	const names = new Map(
		plan.accounts.map((account) => [account.id, account.name]),
	);
	const connection = (transaction: ConnectionTransaction) => {
		const deltas =
			transaction.accountDeltas.length > 0
				? transaction.accountDeltas
				: [
						...(transaction.fromId
							? [{ accountId: transaction.fromId, delta: -transaction.requested }]
							: []),
						...(transaction.toId
							? [{ accountId: transaction.toId, delta: transaction.realized }]
							: []),
					];
		const delta = deltas.find((item) => item.accountId === accountId);
		const destinationIds = deltas
			.filter((item) => item.delta > 0)
			.map((item) => item.accountId);
		const direction =
			(delta?.delta ?? 0) < 0 ? ("out" as const) : ("in" as const);
		const category =
			transaction.fromId && destinationIds.length > 0
				? ("transfer" as const)
				: transaction.fromId
					? ("expense" as const)
					: ("income" as const);
		const from = transaction.fromId
			? (names.get(transaction.fromId) ?? "Unknown account")
			: externalCounterpartyName("in");
		const selectedIsSource = transaction.fromId === accountId;
		const otherDestination = destinationIds.find((id) => id !== accountId);
		const to = selectedIsSource
			? otherDestination
				? (names.get(otherDestination) ?? "Unknown account")
				: externalCounterpartyName("out")
			: (names.get(accountId) ?? "Unknown account");
		return {
			direction,
			category,
			from,
			to,
			counterparty: direction === "in" ? from : to,
		};
	};
	// Pending charges are bank evidence even after the latest checkpoint.
	// They stay disabled for projections, so no projected event supplies them.
	const recorded: AccountTransaction[] = plan.transactions
		.filter(
			(transaction) =>
				(isHistoricalTransaction(transaction, plan.startDate) ||
					isPendingTransaction(transaction)) &&
				(transaction.fromId === accountId || transaction.toId === accountId),
		)
		.map((transaction) => ({
			id: `recorded-${transaction.id}`,
			transactionId: transaction.id,
			date: transaction.startDate,
			name: transaction.name,
			source: "historical",
			...connection({
				fromId: transaction.fromId,
				toId: transaction.toId,
				accountDeltas: [],
				requested: transaction.amount,
				realized: transaction.amount,
			}),
			amount: transaction.amount,
			requested: transaction.amount,
			shortfall: 0,
			constraint: null,
			excluded: !transaction.enabled,
			pending: isPendingTransaction(transaction),
			void: transaction.void === true,
		}));
	const pendingIds = new Set(
		plan.transactions
			.filter(isPendingTransaction)
			.map((transaction) => transaction.id),
	);
	const voidIds = new Set(
		plan.transactions
			.filter((transaction) => transaction.void === true)
			.map((transaction) => transaction.id),
	);
	const startDateHasCheckpoint = projection.startDateHasCheckpoint ?? true;
	const projected: AccountTransaction[] = projection.transactions
		.filter(
			(transaction) =>
				(transaction.date > plan.startDate ||
					(transaction.date === plan.startDate && !startDateHasCheckpoint)) &&
				(transaction.accountDeltas.length > 0
					? transaction.accountDeltas.some(
							(delta) => delta.accountId === accountId,
						)
					: transaction.fromId === accountId || transaction.toId === accountId) &&
				transaction.requested > 0,
		)
		.map((transaction, index) => {
			const selectedDelta = transaction.accountDeltas.find(
				(delta) => delta.accountId === accountId,
			);
			const destinationCount = transaction.accountDeltas.filter(
				(delta) => delta.delta > 0,
			).length;
			const accountAmount = selectedDelta
				? Math.abs(selectedDelta.delta)
				: transaction.realized;
			const accountRequested =
				selectedDelta && selectedDelta.delta < 0
					? transaction.requested
					: destinationCount > 1
						? accountAmount
						: transaction.requested;
			return {
				id: `projected-${transaction.transactionId}-${transaction.date}-${index}`,
				transactionId: transaction.transactionId,
				date: transaction.date,
				name: transaction.name,
				source: "projected",
				...connection(transaction),
				amount: accountAmount,
				requested: accountRequested,
				shortfall: Math.max(0, accountRequested - accountAmount),
				constraint: transaction.constraint,
				excluded: false,
				pending: pendingIds.has(transaction.transactionId),
				void: voidIds.has(transaction.transactionId),
			};
		});
	return [...recorded, ...projected];
}

/**
 * Single rule-to-transaction adapter for plan-level detail views.
 * TransactionsPanel and RecurringRules list rules, not occurrences, but the
 * detail modal is the shared occurrence view (TransactionDetail). This
 * synthesizes the representative occurrence so every entry point renders
 * the identical modal instead of maintaining a second implementation.
 */
export function ruleTransaction({
	transaction,
	plan,
	resolved,
}: {
	transaction: Transaction;
	plan: Plan;
	resolved?: { amount: number; requested: number; date: string };
}): AccountTransaction {
	const names = new Map(
		plan.accounts.map((account) => [account.id, account.name]),
	);
	const pending = isPendingTransaction(transaction);
	const historical =
		isHistoricalTransaction(transaction, plan.startDate) || pending;
	const direction = transaction.fromId ? ("out" as const) : ("in" as const);
	const category =
		transaction.fromId && transaction.toId
			? ("transfer" as const)
			: transaction.fromId
				? ("expense" as const)
				: ("income" as const);
	const from = transaction.fromId
		? (names.get(transaction.fromId) ?? "Unknown account")
		: externalCounterpartyName("in");
	const to = transaction.toId
		? (names.get(transaction.toId) ?? "Unknown account")
		: externalCounterpartyName("out");
	const amount = transaction.amountKnown
		? transaction.amount
		: (resolved?.amount ?? 0);
	const requested = transaction.amountKnown
		? transaction.amount
		: (resolved?.requested ?? amount);
	return {
		id: `rule-${transaction.id}`,
		transactionId: transaction.id,
		date: resolved?.date ?? transaction.startDate,
		name: transaction.name,
		source: historical ? "historical" : "projected",
		direction,
		category,
		counterparty: direction === "in" ? from : to,
		from,
		to,
		amount,
		requested,
		shortfall: Math.max(0, requested - amount),
		constraint: null,
		excluded: !transaction.enabled,
		pending,
		void: transaction.void === true,
	};
}

export function filterTransactions({
	transactions,
	filters,
	startDate,
}: {
	transactions: AccountTransaction[];
	filters: ActivityFilters;
	startDate: string;
}) {
	const query = filters.query.trim().toLocaleLowerCase();
	const end =
		filters.period === "30-days"
			? shiftDate({ date: startDate, days: 30 })
			: horizonDate({ start: startDate, years: 1 });
	return transactions
		.filter((transaction) => {
			if (filters.source !== "all" && transaction.source !== filters.source)
				return false;
			if (
				filters.direction === "transfer" &&
				transaction.category !== "transfer"
			)
				return false;
			if (filters.direction === "in" && transaction.direction !== "in")
				return false;
			if (filters.direction === "out" && transaction.direction !== "out")
				return false;
			if (
				filters.period !== "all" &&
				(transaction.date <= startDate || transaction.date > end)
			)
				return false;
			return (
				!query ||
				`${transaction.name} ${transaction.counterparty} ${transaction.date}`
					.toLocaleLowerCase()
					.includes(query)
			);
		})
		.sort((a, b) =>
			compareTransactionDates({
				aDate: a.date,
				bDate: b.date,
				aId: a.id,
				bId: b.id,
				order: filters.order,
			}),
		);
}
