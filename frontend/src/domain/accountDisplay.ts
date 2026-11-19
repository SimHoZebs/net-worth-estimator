import type { BalanceDisplayData } from "../pages/accounts/balanceDisplay.ts";
import type { Account, Transaction } from "./model.ts";

type DisplayIdentity = { id: string; display?: Account["display"] };

/**
 * A display counts as grouped when it owns more than one component
 * (equivalently both rule IDs are non-empty). Passthrough rows carry a
 * 1:1 stored display, so display presence alone never means grouped.
 */
export function isGroupedDisplay(
	account:
		| {
				display?: { components?: readonly unknown[] | null } | null;
		  }
		| null
		| undefined,
): boolean {
	return (account?.display?.components?.length ?? 0) > 1;
}

export function componentIds(account: DisplayIdentity): string[] {
	return account.display?.components.map((c) => c.accountId) ?? [account.id];
}

/**
 * The owner-facing basis that can actually be shown. When the bank-reported
 * available figure is missing, posted is the only real figure and becomes the
 * effective basis. The persisted draft is left untouched.
 */
export function effectiveDisplayBasis(
	account: Account,
): NonNullable<Account["displayBasis"]> {
	if (account.availableBalance == null) return "posted";
	return account.displayBasis ?? "available";
}

/**
 * Both figures are needed for the basis choice to mean anything. Posted is
 * always present as the observed total or the modeled balance, so only the
 * bank-reported available figure can make the choice unavailable.
 */
export function canChooseDisplayBasis(account: Account): boolean {
	const posted = account.observedBalance ?? account.balance;
	const available = account.availableBalance ?? null;
	return posted != null && available != null;
}

/**
 * Internal shape that keeps the account domain in this module. The tag is
 * stripped before the generic display contract leaves the translation layer.
 */
type TaggedBalanceEntry = BalanceDisplayData["entries"][number] & {
	basis: NonNullable<Account["displayBasis"]>;
};

/** Builds one entry for every figure the account actually records. */
function balanceEntries(account: Account): TaggedBalanceEntry[] {
	const effective = effectiveDisplayBasis(account);
	const posted = account.observedBalance ?? account.balance;
	const available = account.availableBalance ?? null;
	const entries: TaggedBalanceEntry[] = [
		{
			label: "Posted balance",
			value: posted,
			emphasized: effective === "posted",
			basis: "posted",
		},
	];
	if (available !== null)
		entries.push({
			label: "Available balance",
			value: available,
			emphasized: effective === "available",
			basis: "available",
		});
	return entries;
}

/** Projects tagged entries onto the domain-free display contract. */
function toDisplayData(
	entries: TaggedBalanceEntry[],
	synced: string | null,
): BalanceDisplayData {
	return {
		entries: entries.map(({ label, value, emphasized }) => ({
			label,
			value,
			emphasized,
		})),
		synced,
	};
}

/**
 * A sync date belongs only to bank-owned accounts. The adapter derives the
 * account source from the row's ownership flag, so "Synced balance check"
 * marks a bank-owned account while manual sources do not. The read-only flag
 * cannot serve as this signal because the backend also derives it from
 * deployment-level config, which would make a manual account in a read-only
 * deployment look synced.
 */
function observedSyncDate(account: Account): string | null {
	return account.source === "Synced balance check"
		? account.observedOn || null
		: null;
}

/**
 * Display data for every recorded figure. Posted is always recorded as the
 * observed total or the modeled balance; available appears only when the bank
 * reported one, with a reported zero kept. Emphasis follows the effective
 * basis and the sync date comes only from bank-owned observations.
 */
export function accountBalanceDisplayData(
	account: Account,
): BalanceDisplayData {
	return toDisplayData(balanceEntries(account), observedSyncDate(account));
}

/**
 * Display data for the account detail header. Both recorded figures appear
 * side by side with the bank-reported available figure first, followed by
 * posted. When no available figure was reported, only posted is shown.
 * Emphasis follows the effective basis and the sync date comes only from
 * bank-owned observations, exactly as in the full display data.
 */
export function accountBalanceHeaderData(account: Account): BalanceDisplayData {
	const entries = balanceEntries(account);
	return toDisplayData(
		[
			...entries.filter((entry) => entry.basis === "available"),
			...entries.filter((entry) => entry.basis === "posted"),
		],
		observedSyncDate(account),
	);
}

/**
 * Display data for a single figure. The accounts list shows only the figure
 * chosen by the effective basis, so the domain decision stays here while the
 * shared component renders exactly what it is handed. The list carries no sync
 * date; it is reserved for the detail header and detail tabs.
 */
export function accountBalanceSelectedData(
	account: Account,
): BalanceDisplayData {
	const effective = effectiveDisplayBasis(account);
	return toDisplayData(
		balanceEntries(account).filter((entry) => entry.basis === effective),
		null,
	);
}

export function displayBalance(
	account: DisplayIdentity,
	balances: Record<string, number>,
): number {
	return componentIds(account).reduce(
		(sum, id) => sum + (balances[id] ?? 0),
		0,
	);
}

export function displayAccountId(accounts: Account[], id: string): string {
	return accounts.find((a) => componentIds(a).includes(id))?.id ?? id;
}

export function toDisplayTransaction(
	transaction: Transaction,
	accounts: Account[],
): Transaction {
	return {
		...transaction,
		readOnly:
			transaction.readOnly ||
			accounts.some(
				(a) =>
					isGroupedDisplay(a) &&
					[
						a.display!.interestScheduleId,
						a.display!.paymentScheduleId,
					].includes(transaction.id),
			),
		fromId: transaction.fromId
			? displayAccountId(accounts, transaction.fromId)
			: null,
		toId: transaction.toId
			? displayAccountId(accounts, transaction.toId)
			: null,
	};
}

/** Group only saved relationships. Never infer membership from names. */
export function toDisplayAccounts(accounts: Account[]): Account[] {
	const byId = new Map(accounts.map((a) => [a.id, a]));
	const hidden = new Set(
		accounts.flatMap((a) => componentIds(a).filter((id) => id !== a.id)),
	);
	return accounts
		.filter((a) => !hidden.has(a.id))
		.map((a) => {
			if (!isGroupedDisplay(a)) return a;
			const display = a.display!;
			const members = display.components.map((c) => ({
				...c,
				account: byId.get(c.accountId),
			}));
			if (members.some((c) => !c.account))
				throw new Error("A visible account has a missing component.");
			const components = members.map((c) => ({
				accountId: c.accountId,
				role: c.role,
				balance: c.account!.balance,
				observedBalance: c.account!.observedBalance ?? null,
				observedAt: c.account!.observedAt ?? null,
			}));
			const sameObservation = components.every(
				(c) =>
					c.observedAt !== null &&
					c.observedAt === components[0]?.observedAt &&
					c.observedBalance !== null,
			);
			// A grouped current figure exists only when every component has its
			// own bank-reported available observation. A reported zero counts;
			// any missing component leaves the group unavailable rather than
			// borrowing the modeled balance.
			const availableBalances = members.map((c) => c.account!.availableBalance);
			const availableBalance = availableBalances.every(
				(value): value is number => value != null,
			)
				? availableBalances.reduce((sum, value) => sum + value, 0)
				: null;
			return {
				...a,
				name: display.name,
				maxBalance: null,
				components,
				balance: components.reduce((sum, c) => sum + c.balance, 0),
				archived: members.every((c) => c.account!.archived),
				readOnly: members.some((c) => c.account!.readOnly),
				// Different observation times do not form one recorded total.
				observedBalance: sameObservation
					? components.reduce((sum, c) => sum + c.observedBalance!, 0)
					: null,
				observedAt: sameObservation ? components[0]!.observedAt : null,
				balanceCheck: sameObservation,
				availableBalance,
			};
		});
}
