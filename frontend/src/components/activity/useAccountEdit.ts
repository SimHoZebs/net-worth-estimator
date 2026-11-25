import { useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
	deletePaymentTerms,
	savePaymentTerms,
	updateAccount,
} from "@/api/generated/endpoints.ts";
import type { Account } from "../../domain/model.ts";
import type { AccountKind } from "../../api/contracts.ts";
import { isLiability } from "../../domain/accountKinds.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { useEditDraft } from "../editors/useEditDraft.ts";
import { parseDisplayNumber } from "../editors/formValues.ts";
import { accountUpdateBody } from "../editors/accountFields.ts";
import {
	balancesOptions,
	getAccountBalances,
	getPaymentTermsForAccount,
	refreshAccounts,
	refreshPaymentTerms,
	usePaymentTerms,
} from "../../state/workspaceResources.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	persistSyncedAccountKind,
	syncedKindError,
} from "../../state/accountKind.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";

export type AccountEditField =
	| "name"
	| "balance"
	| "kind"
	| "enabled"
	| "protected"
	| "ceiling"
	| "display"
	| "minimum"
	| "minimumPercent"
	| "dueDay"
	| "closingDay"
	| "time";

// Optional minimum/due terms are separate from the authoritative closing day.
// Their empty inputs only prefill the form; terms are written only when a terms
// field is edited, and can be removed without touching the closing day.
const DEFAULT_STATEMENT_CLOSING_DAY = 19;

function parseDay(raw: string): number | null {
	const value = parseDisplayNumber(raw);
	return value !== null && Number.isInteger(value) ? value : null;
}

/**
 * Fields a synced account keeps locked. Kind, display basis and a tracked
 * card's closing day are owner config. The name joins them only where the
 * owner may rename the account, never for grouped loans or shared workspaces.
 */
export function isSyncedFieldLocked(
	field: AccountEditField,
	nameEditable: boolean,
): boolean {
	if (field === "kind" || field === "display" || field === "closingDay")
		return false;
	return !(nameEditable && field === "name");
}

/**
 * The name a synced save writes and whether it differs from the stored name.
 * A blank edit reports as changed so submit rejects it with a validation
 * message instead of silently discarding it.
 */
export function syncedNameDraft(
	nameEditable: boolean,
	draftName: string,
	storedName: string,
): { name: string; changed: boolean } {
	if (!nameEditable) return { name: storedName, changed: false };
	const name = draftName.trim();
	return { name, changed: name !== storedName };
}

export function useAccountEdit(
	account: Account,
	readOnly: boolean,
	nameEditable = false,
) {
	// Own the terms read so the card rows prefill from the authoritative row.
	usePaymentTerms();
	const terms = getPaymentTermsForAccount(account.id);
	const source = {
		name: account.name,
		balance: String(account.balance),
		kind: account.kind,
		enabled: account.enabled,
		displayBasis: (account.displayBasis ??
			"available") as Account["displayBasis"],
		minBalance: String(account.minBalance),
		maxBalance: account.maxBalance === null ? "" : String(account.maxBalance),
		noCeiling: account.maxBalance === null,
		minimumFixed: terms ? String(terms.minimumFixed) : "",
		minimumPercent:
			terms?.minimumPercent === undefined || terms.minimumPercent === null
				? ""
				: String(terms.minimumPercent * 100),
		dueDay: terms ? String(terms.dueDay) : "",
		statementClosingDay: String(
			account.statementClosingDay || DEFAULT_STATEMENT_CLOSING_DAY,
		),
	};
	const edit = useEditDraft(account.id, source);
	const [activeField, setActiveField] = useState<AccountEditField | null>(null);
	const [observedAt, setObservedAt] = useState<string | null>(null);
	const [confirmCancel, setConfirmCancel] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const formId = useId();
	const scope = getUserScope();
	const instant = observedAt === null ? NaN : Date.parse(`${observedAt}Z`);
	const balanceTime =
		observedAt !== null && Number.isFinite(instant)
			? new Date(instant).toISOString()
			: null;
	const balanceAtTimeQuery = useQuery({
		...balancesOptions(scope, balanceTime ?? undefined),
		enabled: balanceTime !== null,
		select: (result) => {
			const row = result.accounts.find((row) => row.id === account.id);
			if (!row) throw new Error("The account is no longer available.");
			return row.balance;
		},
	});
	const balanceAtTime = balanceAtTimeQuery.data;
	useBeforeUnload(edit.dirty || saving);
	const update = (patch: Partial<typeof source>, field: AccountEditField) => {
		// The kind selector stays available on synced accounts: kind is a
		// user-configured label, and changing it is the supported way to
		// update the type there. Display basis and a tracked card's closing
		// day are owner config too, so they stay editable wherever kind does.
		// The name joins them only on accounts the owner may rename.
		if (saving || (readOnly && isSyncedFieldLocked(field, nameEditable)))
			return;
		edit.update(patch);
		setActiveField(field);
		if (field === "balance" && observedAt === null)
			setObservedAt(new Date().toISOString().slice(0, 19));
		setError(null);
		setConfirmCancel(false);
	};
	const reset = () => {
		edit.reset();
		setActiveField(null);
		setObservedAt(null);
		setError(null);
		setConfirmCancel(false);
	};
	const clearTerms = async () => {
		if (saving || readOnly || getPaymentTermsForAccount(account.id) === null)
			return;
		setSaving(true);
		setError(null);
		const ok = await performSave({
			call: () => deletePaymentTerms(account.id),
			refresh: refreshPaymentTerms,
			failureMessage: "The payment terms could not be removed.",
			onRejected: setError,
		});
		setSaving(false);
		if (ok) edit.update({ minimumFixed: "", minimumPercent: "", dueDay: "" });
	};
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (saving) return;
		// Synced accounts lock bank-owned facts. Kind, display basis, a
		// tracked card's closing day and an owner-editable name are owner
		// config and ride along on save; the current bounds stay verbatim.
		if (readOnly) {
			const syncedName = syncedNameDraft(
				nameEditable,
				edit.value.name,
				account.name,
			);
			const kindChanged = edit.value.kind !== account.kind;
			const basisChanged =
				(edit.value.displayBasis ?? "available") !==
				(account.displayBasis ?? "available");
			const closingChanged =
				(edit.value.statementClosingDay ?? "") !==
				String(account.statementClosingDay || DEFAULT_STATEMENT_CLOSING_DAY);
			if (
				!kindChanged &&
				!basisChanged &&
				!closingChanged &&
				!syncedName.changed
			) {
				reset();
				return;
			}
			if (syncedName.changed && !syncedName.name) {
				setError("Give the account a name.");
				return;
			}
			const closingDay = closingChanged
				? parseDay(edit.value.statementClosingDay)
				: null;
			if (
				closingChanged &&
				(closingDay === null || closingDay < 1 || closingDay > 31)
			) {
				setError("Enter a statement closing day between 1 and 31.");
				return;
			}
			if (edit.conflict) {
				setError(
					"This account changed during your edit. Discard your edits before applying new changes.",
				);
				return;
			}
			// The bank owns the balance, so a kind that contradicts it is
			// reported plainly instead of written. Shared with the modal
			// synced-kind path so both refuse identically.
			const contradiction = syncedKindError(
				parseDisplayNumber(edit.value.balance),
				edit.value.kind,
			);
			if (contradiction) {
				setError(contradiction);
				return;
			}
			setSaving(true);
			setError(null);
			const ok = await persistSyncedAccountKind(
				{
					id: account.id,
					name: syncedName.name,
					enabled: account.enabled,
					color: account.color,
				},
				edit.value.kind,
				basisChanged ? edit.value.displayBasis : undefined,
				closingDay ?? undefined,
			);
			setSaving(false);
			if (ok) {
				setActiveField(null);
				setConfirmCancel(false);
			} else {
				setError(
					"The account could not be saved. Review the workspace notice and try again.",
				);
			}
			return;
		}
		if (edit.conflict) {
			setError(
				"This account changed during your edit. Discard your edits before applying new changes.",
			);
			return;
		}
		const name = edit.value.name.trim();
		const balance = parseDisplayNumber(edit.value.balance);
		const minBalance = parseDisplayNumber(edit.value.minBalance);
		const maxBalance = edit.value.noCeiling
			? null
			: parseDisplayNumber(edit.value.maxBalance);
		if (!name) {
			setError("Give the account a name.");
			return;
		}
		if (balance === null) {
			setError("Enter a balance in USD.");
			return;
		}
		if (minBalance === null || minBalance < 0) {
			setError("Enter a protected balance in USD.");
			return;
		}
		if (!edit.value.noCeiling && maxBalance === null) {
			setError("Enter a maximum balance in USD or select No ceiling.");
			return;
		}
		if (maxBalance !== null && maxBalance < minBalance) {
			setError("The ceiling must be at least the protected balance.");
			return;
		}
		if (edit.value.kind === "debt" && balance > 0) {
			setError("Enter debt as a negative balance.");
			return;
		}
		const statementClosingDay = parseDay(edit.value.statementClosingDay);
		if (
			statementClosingDay === null ||
			statementClosingDay < 1 ||
			statementClosingDay > 31
		) {
			setError("Enter a statement closing day between 1 and 31.");
			return;
		}
		const termFields = ["minimumFixed", "minimumPercent", "dueDay"] as const;
		const termsDirty =
			isLiability(edit.value) &&
			termFields.some((field) => edit.value[field] !== source[field]);
		let cardTerms: {
			accountId: string;
			minimumFixed: number;
			minimumPercent?: number;
			dueDay: number;
		} | null = null;
		if (termsDirty) {
			const minimumFixed = parseDisplayNumber(edit.value.minimumFixed);
			const percent = edit.value.minimumPercent.trim()
				? parseDisplayNumber(edit.value.minimumPercent)
				: null;
			const dueDay = parseDay(edit.value.dueDay);
			if (minimumFixed === null || minimumFixed < 0) {
				setError("Enter a minimum payment in USD.");
				return;
			}
			if (
				edit.value.minimumPercent.trim() &&
				(percent === null || percent < 0 || percent > 100)
			) {
				setError("Enter the minimum percent as a number between 0 and 100.");
				return;
			}
			if (dueDay === null || dueDay < 1 || dueDay > 28) {
				setError("Enter a due day between 1 and 28.");
				return;
			}
			cardTerms = {
				accountId: account.id,
				minimumFixed,
				...(percent === null ? {} : { minimumPercent: percent / 100 }),
				dueDay,
			};
		}
		if (
			observedAt !== null &&
			(!Number.isFinite(instant) ||
				balanceAtTime === undefined ||
				balanceAtTimeQuery.isFetching ||
				balanceAtTimeQuery.isError)
		) {
			setError("Load the balance at the selected time before saving.");
			return;
		}
		const moved = observedAt !== null && balance !== balanceAtTime;
		if (!edit.dirty && !moved) {
			reset();
			return;
		}
		setSaving(true);
		setError(null);
		const ok = await performSave({
			call: async () => {
				if (cardTerms) await savePaymentTerms(cardTerms);
				const row = getAccountBalances()?.accounts.find(
					(row) => row.id === account.id,
				);
				return updateAccount(account.id, {
					...accountUpdateBody({
						baseline: account,
						raw: row
							? ({
									id: row.id,
									name: row.name || row.id,
									kind: row.kind as AccountKind,
									minBalance: row.minBalance,
									maxBalance: row.maxBalance,
									color: row.color ?? null,
									enabled: row.enabled,
								} as Parameters<typeof accountUpdateBody>[0]["raw"])
							: undefined,
						values: {
							name,
							balance,
							kind: edit.value.kind,
							enabled: edit.value.enabled,
							displayBasis: edit.value.displayBasis,
							minBalance,
							maxBalance,
							noCeiling: edit.value.noCeiling,
							statementClosingDay,
						},
					}),
					...(moved ? { balance, observedAt: Math.floor(instant / 1000) } : {}),
				});
			},
			refresh: async () => {
				await refreshAccounts();
				if (cardTerms) await refreshPaymentTerms();
			},
			failureMessage: "The account could not be saved.",
			onRejected: setError,
		});
		setSaving(false);
		if (ok) reset();
	};
	return {
		draft: edit.value,
		activeField,
		formId,
		update,
		submit,
		reset,
		clearTerms,
		error,
		saving,
		dirty: edit.dirty,
		confirmCancel,
		setConfirmCancel,
		observedAt,
		setObservedAt: (value: string) => {
			if (!readOnly && !saving) {
				setObservedAt(value);
				setActiveField("time");
				setError(null);
				setConfirmCancel(false);
			}
		},
		balanceAtTime,
		balanceAtTimeQuery,
		saveBlocked:
			saving ||
			(observedAt !== null &&
				(!Number.isFinite(instant) ||
					balanceAtTime === undefined ||
					balanceAtTimeQuery.isFetching ||
					balanceAtTimeQuery.isPending ||
					balanceAtTimeQuery.isError)),
	};
}

export type AccountEdit = ReturnType<typeof useAccountEdit>;
