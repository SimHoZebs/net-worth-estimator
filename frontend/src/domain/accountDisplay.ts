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
 * The owner-facing current balance for one display account. Posted basis
 * shows the posted (observed) total, falling back to the modeled balance
 * when unobserved. Available basis (the default) shows the bank-reported
 * figure; manual accounts without bank evidence keep their saved balance,
 * while synced or grouped accounts without evidence show unavailable
 * rather than borrowing the modeled balance.
 */
export function displayCurrentBalance(account: Account): number | null {
	if ((account.displayBasis ?? "available") === "posted") {
		return account.observedBalance ?? account.balance;
	}
	const available = account.availableBalance ?? null;
	if (available !== null) return available;
	if (!account.readOnly && !isGroupedDisplay(account)) return account.balance;
	return null;
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
