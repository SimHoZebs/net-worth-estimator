import { shiftDate } from "./format.ts";
import {
	isHistoricalTransaction,
	isPendingTransaction,
	type Account,
	type Transaction,
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
	accounts,
	transactions,
	startDate,
	projection,
}: {
	accountId: string;
	accounts: Account[];
	transactions: Transaction[];
	startDate: string;
	projection?: Projection | null;
}): AccountTransaction[] {
	if (
		!accounts.some((account) => account.id === accountId && !account.archived)
	)
		return [];
	const names = new Map(accounts.map((account) => [account.id, account.name]));
	const connection = (transaction: ConnectionTransaction) => {
		const deltas =
			transaction.accountDeltas.length > 0
				? transaction.accountDeltas
				: [
						...(transaction.fromId
							? [
									{
										accountId: transaction.fromId,
										delta: -transaction.requested,
									},
								]
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
	// Pending and void charges are bank evidence even after the latest
	// checkpoint. They stay disabled for projections, so no projected event supplies them.
	// Deliberate exclusion is owner-only, except that pending and void bank
	// rows are lifecycle states, never exclusions: a settled bank row
	// participates like a manual actual unless the owner disables it.
	const recorded: AccountTransaction[] = transactions
		.filter(
			(transaction) =>
				(isHistoricalTransaction(transaction, startDate) ||
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
			excluded:
				!transaction.enabled &&
				(transaction.syncOwned !== true ||
					(!isPendingTransaction(transaction) && transaction.void !== true)),
			pending: isPendingTransaction(transaction),
			void: transaction.void === true,
		}));
	const pendingIds = new Set(
		transactions
			.filter(isPendingTransaction)
			.map((transaction) => transaction.id),
	);
	const voidIds = new Set(
		transactions
			.filter((transaction) => transaction.void === true)
			.map((transaction) => transaction.id),
	);
	const startDateHasCheckpoint = projection?.startDateHasCheckpoint ?? true;
	const projected: AccountTransaction[] = !projection
		? []
		: projection.transactions
				.filter(
					(transaction) =>
						(transaction.date > startDate ||
							(transaction.date === startDate && !startDateHasCheckpoint)) &&
						(transaction.accountDeltas.length > 0
							? transaction.accountDeltas.some(
									(delta) => delta.accountId === accountId,
								)
							: transaction.fromId === accountId ||
								transaction.toId === accountId) &&
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
 * Single rule-to-transaction adapter for rule detail views.
 * TransactionsPanel and RecurringRules list rules, not occurrences, but the
 * detail modal is the shared occurrence view (TransactionDetail). This
 * synthesizes the representative occurrence so every entry point renders
 * the identical modal instead of maintaining a second implementation.
 */
export function ruleTransaction({
	transaction,
	accounts,
	startDate,
	resolved,
}: {
	transaction: Transaction;
	accounts: Account[];
	startDate: string;
	resolved?: { amount: number; requested: number; date: string };
}): AccountTransaction {
	const names = new Map(accounts.map((account) => [account.id, account.name]));
	const pending = isPendingTransaction(transaction);
	const historical = isHistoricalTransaction(transaction, startDate) || pending;
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
		excluded:
			!transaction.enabled &&
			(transaction.syncOwned !== true ||
				(!pending && transaction.void !== true)),
		pending,
		void: transaction.void === true,
	};
}

// Tip-bounded join shared with the backend pending matcher: it bounds how
// far a posted total may move from its authorization.
const TIP_RATE = 0.25;
const TIP_FLOOR_CENTS = 300;
const TIP_CAP_CENTS = 5000;
const TIP_WINDOW_DAYS = 7;

function mirrorAccountOf(transaction: Pick<Transaction, "fromId" | "toId">) {
	return transaction.fromId ?? transaction.toId ?? null;
}

/**
 * Settled bank rows that could be the posted version of a void hold:
 * same mirror account and direction, overlapping names, posted within a
 * week of the hold, amount within the tip band. Ambiguity is the caller's
 * call: the live path holds out on several matches, while a person
 * reviewing the list picks the right one.
 */
export function voidSettleCandidates({
	voidRow,
	transactions,
}: {
	voidRow: Transaction;
	transactions: Transaction[];
}): Transaction[] {
	if (!voidRow.void || voidRow.pending) return [];
	if (!voidRow.amountKnown || !(voidRow.amount > 0)) return [];
	const mirror = mirrorAccountOf(voidRow);
	if (!mirror) return [];
	const voidCents = Math.round(voidRow.amount * 100);
	let tolerance = Math.floor(voidCents * TIP_RATE);
	if (tolerance < TIP_FLOOR_CENTS) tolerance = TIP_FLOOR_CENTS;
	if (tolerance > TIP_CAP_CENTS) tolerance = TIP_CAP_CENTS;
	const voidName = voidRow.name.trim().toLocaleUpperCase();
	const voidDay = Date.parse(`${voidRow.startDate}T00:00:00Z`);
	if (!Number.isFinite(voidDay)) return [];
	return transactions.filter((candidate) => {
		if (candidate.id === voidRow.id) return false;
		if (candidate.syncOwned !== true || candidate.pending === true)
			return false;
		if (candidate.void) return false;
		if (!candidate.amountKnown || !(candidate.amount > 0)) return false;
		if (mirrorAccountOf(candidate) !== mirror) return false;
		if ((candidate.fromId != null) !== (voidRow.fromId != null)) return false;
		const name = candidate.name.trim().toLocaleUpperCase();
		if (!name.includes(voidName) && !voidName.includes(name)) return false;
		const day = Date.parse(`${candidate.startDate}T00:00:00Z`);
		if (!Number.isFinite(day)) return false;
		if (Math.abs(day - voidDay) > TIP_WINDOW_DAYS * 86400000) return false;
		const cents = Math.round(candidate.amount * 100);
		return cents >= voidCents - tolerance && cents <= voidCents + tolerance;
	});
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
