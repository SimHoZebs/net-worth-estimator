import type { AccountBalanceRow } from "../api/generated/model/accountBalanceRow.ts";
import type { Account } from "../domain/model.ts";

/** Map an explicit display-account fixture to the balance response shape. */
export function accountBalanceFixtureRow(account: Account): AccountBalanceRow {
	const observedAt =
		account.observedAt ??
		(account.balanceCheck
			? Math.floor(Date.parse(`${account.observedOn}T23:59:59Z`) / 1000)
			: undefined);
	return {
		id: account.id,
		name: account.name,
		kind: account.kind,
		enabled: account.enabled,
		archived: account.archived,
		balance: account.balance,
		minBalance: account.minBalance,
		maxBalance: account.maxBalance,
		color: account.color ?? undefined,
		display: account.display,
		observedOn: account.observedOn,
		hasCheckpoint: account.balanceCheck,
		observedAt,
		observedBalance: account.balanceCheck
			? (account.observedBalance ?? account.balance)
			: undefined,
		availableBalance: account.availableBalance ?? undefined,
		displayBasis: account.displayBasis,
		statementClosingDay: account.statementClosingDay ?? 19,
		readOnly: account.readOnly,
		syncOwned: account.syncOwned ?? account.readOnly,
		...(account.institution ? { institution: account.institution } : {}),
		...(account.syncedName ? { syncedName: account.syncedName } : {}),
		...(account.currency ? { currency: account.currency } : {}),
		...(account.recognizedBusinessKey
			? { recognizedBusinessKey: account.recognizedBusinessKey }
			: {}),
	};
}
