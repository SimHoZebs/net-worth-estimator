import { updateAccount } from "@/api/generated/endpoints.ts";
import { NO_CEILING_SENTINEL, NO_FLOOR_SENTINEL } from "@/api/contracts.ts";
import { getAccountBalances } from "./workspaceResources.ts";
import { performSave } from "./workspaceWrites.ts";
import { refreshAccounts } from "./workspaceResources.ts";
import type { AccountKind } from "@/api/contracts.ts";

/**
 * Refusal reason when a synced kind change contradicts the bank balance,
 * or null when the kind may be saved. Kind is a user label, but it must
 * not contradict the owned facts: debt holds no positive balance and
 * assets hold no negative one. Both synced-kind writers share this so
 * the modal and the detail pane refuse identically.
 */
export function syncedKindError(
	balance: number | null,
	kind: AccountKind,
): string | null {
	if (balance === null) return "Enter a balance in USD.";
	if (kind === "debt" ? balance > 0 : balance < 0) {
		return kind === "debt"
			? "A debt account cannot hold a positive bank balance."
			: "A non-debt account cannot hold a negative bank balance.";
	}
	return null;
}

/**
 * Applies an account kind to a synced (read-only) account. Kind is a
 * user-configured label the backend stores but never interprets, so the
 * write carries only the kind plus the account's current bounds verbatim:
 * open bounds ride as omitted, never invented. Fails closed when the
 * current bounds cannot be read instead of clearing them.
 */
export async function persistSyncedAccountKind(
	account: {
		id: string;
		name: string;
		enabled: boolean;
		color: string | null;
	},
	kind: AccountKind,
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
				...(minBalance === undefined ? {} : { minBalance }),
				...(maxBalance === undefined ? {} : { maxBalance }),
				...(color === undefined ? {} : { color }),
			}),
		refresh: refreshAccounts,
		failureMessage: "The account type could not be saved.",
	});
}
