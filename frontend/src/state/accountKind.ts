import { updateAccount } from "@/api/generated/endpoints.ts";
import { NO_CEILING_SENTINEL, NO_FLOOR_SENTINEL } from "@/api/contracts.ts";
import { getAccountBalances } from "./workspaceResources.ts";
import { performSave } from "./workspaceWrites.ts";
import { refreshAccounts } from "./workspaceResources.ts";
import type { AccountKind } from "@/api/contracts.ts";

/**
 * Refusal reason when a synced kind change contradicts the bank balance,
 * or null when the kind may be saved. Kind is a user label, but debt must
 * not contradict the owned facts: debt holds no positive balance.
 * Non-debt accounts may hold a negative bank balance (for example an
 * overdrawn checking account), so only a positive debt balance refuses.
 */
export function syncedKindError(
	balance: number | null,
	kind: AccountKind,
): string | null {
	if (balance === null) return "Enter a balance in USD.";
	if (kind === "debt" && balance > 0) {
		return "A debt account cannot hold a positive bank balance.";
	}
	return null;
}

/**
 * Applies an account kind to a synced (read-only) account. Kind is a
 * user-configured label the backend stores but never interprets, so the
 * write carries only the kind plus the account's current bounds verbatim:
 * open bounds ride as omitted, never invented. A display-basis change rides
 * along when given: the basis is owner config, not bank evidence. Fails
 * closed when the current bounds cannot be read instead of clearing them.
 */
export async function persistSyncedAccountKind(
	account: {
		id: string;
		name: string;
		enabled: boolean;
		color: string | null;
	},
	kind: AccountKind,
	displayBasis?: "available" | "posted",
): Promise<boolean> {
	const row = getAccountBalances()?.accounts.find(
		(row) => row.id === account.id,
	);
	if (!row) return false;
	const minBalance =
		row?.minBalance == null || row.minBalance === NO_FLOOR_SENTINEL
			? undefined
			: row.minBalance;
	const maxBalance =
		row?.maxBalance == null || row.maxBalance === NO_CEILING_SENTINEL
			? undefined
			: row.maxBalance;
	const color = row?.color ?? account.color ?? undefined;
	return performSave({
		call: () =>
			updateAccount(account.id, {
				name: account.name,
				kind,
				enabled: account.enabled,
				...(displayBasis === undefined ? {} : { displayBasis }),
				...(minBalance === undefined ? {} : { minBalance }),
				...(maxBalance === undefined ? {} : { maxBalance }),
				...(color === undefined ? {} : { color }),
			}),
		refresh: refreshAccounts,
		failureMessage: "The account type could not be saved.",
	});
}

/**
 * Applies a display-basis choice to one account without touching anything
 * else. Grouped loan accounts use this: the visible row owns the choice,
 * and every other field still goes through the loan form. Scalars are
 * omitted; the server preserves stored bounds, color, and display verbatim.
 */
export async function persistAccountDisplayBasis(
	account: {
		id: string;
		name: string;
		kind: AccountKind;
		enabled: boolean;
		color: string | null;
	},
	displayBasis: "available" | "posted",
): Promise<boolean> {
	const row = getAccountBalances()?.accounts.find(
		(row) => row.id === account.id,
	);
	if (!row) return false;
	return performSave({
		call: () =>
			updateAccount(account.id, {
				name: row.name || account.name,
				kind: row.kind as AccountKind,
				enabled: row.enabled,
				displayBasis,
			}),
		refresh: refreshAccounts,
		failureMessage: "The display value could not be saved.",
	});
}
