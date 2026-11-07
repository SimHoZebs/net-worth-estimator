import type { Account, Transaction } from "./model.ts";

type DisplayIdentity = { id: string; display?: Account["display"] };

export function componentIds(account: DisplayIdentity): string[] {
	return account.display?.components.map((c) => c.accountId) ?? [account.id];
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
					a.display &&
					[a.display.interestScheduleId, a.display.paymentScheduleId].includes(
						transaction.id,
					),
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
			if (!a.display) return a;
			const members = a.display.components.map((c) => ({
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
			return {
				...a,
				name: a.display.name,
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
				availableBalance: null,
			};
		});
}
