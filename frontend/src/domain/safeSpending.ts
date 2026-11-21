import type { Account } from "./model.ts";

// Server ownership: every amount summed here originates server-side.
// Only the windows stay client-side; do not add new windowed sums here.

export function checkingAccountId(accounts: Account[]): string | null {
	const visible = accounts.filter((account) => !account.archived);
	const byId = visible.find((account) => account.id === "checking");
	if (byId) return byId.id;
	const cash = visible.find(
		(account) => account.kind === "cash" && account.enabled,
	);
	if (cash) return cash.id;
	const anyCash = visible.find((account) => account.kind === "cash");
	return anyCash?.id ?? null;
}

/**
 * Automatic Safe Spending card set. The declared kind is authoritative: a
 * card is never inferred from an account name or an id suffix. An explicit
 * owner selection still overrides this through the settings resolver, so the
 * automatic set only decides what `null` means.
 */
export function safeSpendingCards(accounts: Account[]): Account[] {
	return accounts.filter(
		(account) =>
			account.enabled && !account.archived && account.kind === "credit_card",
	);
}

export function selectedCardIds(
	stored: string[] | null,
	available: readonly string[],
): string[] {
	return stored === null
		? [...available]
		: stored.filter((id) => available.includes(id));
}
