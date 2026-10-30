import { z } from "zod";

export const accountKindSchema = z.enum([
	"cash",
	"investment",
	"debt",
	"property",
]);
const date = z.iso.date();
const money = z.number().finite().min(0).max(1e10);
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(100);

export const accountSchema = z.object({
	id,
	name,
	kind: accountKindSchema,
	enabled: z.boolean().default(true),
	archived: z.boolean().default(false),
	balance: z.number().finite().min(-1e10).max(1e10),
	minBalance: money,
	maxBalance: money.nullable(),
	color: z.string().max(100).nullable().default(null),
	observedOn: date,
	balanceCheck: z.boolean(),
	source: name,
	readOnly: z.boolean(),
});

export const plannedPurchaseSchema = z.object({
	id,
	name,
	amount: z.number().finite().positive().max(1e10),
	fromId: id.nullable(),
	startDate: date,
	enabled: z.boolean(),
	readOnly: z.boolean(),
});

export const transactionSchema = z.object({
	id,
	name,
	amount: money,
	amountKnown: z.boolean().default(true),
	fromId: id.nullable(),
	toId: id.nullable(),
	frequency: z.enum(["monthly", "yearly", "once"]),
	startDate: date,
	endDate: date.nullable(),
	annualIncrease: z.number().min(-50).max(50),
	enabled: z.boolean(),
	readOnly: z.boolean(),
	// Manual link to a recurrence rule occurrence. Only meaningful for
	// one-time transactions; the server validates the named occurrence.
	claimRuleId: id.nullable().default(null),
	claimOccurrenceDate: date.nullable().default(null),
	// Display-only day the one-time posting settled, when it differs from
	// the transaction day (startDate). Recurring rules never carry one.
	// Editors preserve exact timestamps from the canonical raw posting.
	postedDate: date.nullable().default(null),
	// Server-owned bank lifecycle metadata. Missing means not pending.
	pending: z.boolean().optional(),
	// Void marks a bank hold that vanished without posting. The UI shows
	// it as "Did not post". Every transaction carries it explicitly.
	void: z.boolean(),
});

/**
 * A transaction is historical when it is a one-time dated record at or before the
 * projection start. Recurring rules and later-dated transactions are projected.
 * Planned purchases live in their own slice and never count as history.
 */
export function isHistoricalTransaction(
	transaction: Transaction,
	projectionStartDate: string,
): boolean {
	return (
		transaction.frequency === "once" &&
		transaction.startDate <= projectionStartDate
	);
}

/** Pending state comes from bank metadata, never the posting ID. */
export function isPendingTransaction(
	transaction: Pick<Transaction, "pending">,
): boolean {
	return transaction.pending === true;
}

export const evaluationSchema = z.object({
	id,
	name,
	kind: z.enum(["net-worth", "reserve"]),
	target: money.positive(),
	accountId: id.nullable(),
	enabled: z.boolean(),
});

export type Account = z.infer<typeof accountSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type PlannedPurchase = z.infer<typeof plannedPurchaseSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;

export function isArchivedAccount(account: Pick<Account, "archived">): boolean {
	return account.archived === true;
}

export function visibleAccounts(accounts: Account[]): Account[] {
	return accounts.filter((account) => !account.archived);
}

export function visibleTransactions({
	transactions,
	accounts,
}: {
	transactions: Transaction[];
	accounts: Account[];
}): Transaction[] {
	const archivedIds = new Set(
		accounts.filter((account) => account.archived).map((account) => account.id),
	);
	if (!archivedIds.size) return transactions;
	return transactions.filter(
		(transaction) =>
			!(transaction.fromId && archivedIds.has(transaction.fromId)) &&
			!(transaction.toId && archivedIds.has(transaction.toId)),
	);
}

export function visiblePlannedPurchases({
	plannedPurchases,
	accounts,
}: {
	plannedPurchases: PlannedPurchase[];
	accounts: Account[];
}): PlannedPurchase[] {
	const archivedIds = new Set(
		accounts.filter((account) => account.archived).map((account) => account.id),
	);
	if (!archivedIds.size) return plannedPurchases;
	return plannedPurchases.filter(
		(purchase) => !(purchase.fromId && archivedIds.has(purchase.fromId)),
	);
}
