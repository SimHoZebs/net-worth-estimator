import { useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
	deletePaymentTerms,
	listAccountBalances,
	savePaymentTerms,
	updateAccount,
} from "@/api/generated/endpoints.ts";
import type { Account } from "../../domain/model.ts";
import type { BalanceAdjustment } from "@/api/generated/model/balanceAdjustment.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { useEditDraft } from "../editors/useEditDraft.ts";
import { parseDisplayNumber } from "../editors/formValues.ts";
import { accountUpdateBody } from "../editors/accountFields.ts";
import {
	getAccountBalances,
	getPaymentTermsForAccount,
	refreshPaymentTerms,
	usePaymentTerms,
} from "../../state/workspaceResources.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import { refreshAccountAdjustments } from "../../state/accountAdjustments.ts";
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

export function useAccountEdit(
	account: Account,
	readOnly: boolean,
	adjustments: BalanceAdjustment[],
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
	const previous = useQuery({
		queryKey: ["balance-adjustment-preview", scope.key, account.id, observedAt],
		enabled: observedAt !== null && Number.isFinite(instant),
		retry: false,
		queryFn: async ({ signal }) => {
			const result = await listAccountBalances(
				{ asOf: new Date(instant).toISOString() },
				{ signal },
			);
			if (scope !== getUserScope()) throw new Error("The active user changed.");
			const row = result.data.accounts?.find((row) => row.id === account.id);
			if (!row) throw new Error("The account is no longer available.");
			return row.balance;
		},
	});
	const existing = adjustments.find(
		(row) => row.observedAt === Math.floor(instant / 1000),
	);
	const previousBalance = existing?.previousBalance ?? previous.data;
	useBeforeUnload(edit.dirty || saving);
	const update = (patch: Partial<typeof source>, field: AccountEditField) => {
		// The kind selector stays available on synced accounts: kind is a
		// user-configured label, and changing it is the supported way to
		// update the type there. The display basis is owner config too,
		// so it stays editable wherever kind does.
		if (saving || (readOnly && field !== "kind" && field !== "display")) return;
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
		if (ok)
			edit.update({ minimumFixed: "", minimumPercent: "", dueDay: "" });
	};
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (saving) return;
		// Synced accounts lock every field except kind and display basis. A
		// kind change writes only the kind plus the current bounds verbatim;
		// a basis change rides along as owner config.
		if (readOnly) {
			const kindChanged = edit.value.kind !== account.kind;
			const basisChanged =
				(edit.value.displayBasis ?? "available") !==
				(account.displayBasis ?? "available");
			if (!kindChanged && !basisChanged) {
				reset();
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
					name: account.name,
					enabled: account.enabled,
					color: account.color,
				},
				edit.value.kind,
				basisChanged ? edit.value.displayBasis : undefined,
			);
			setSaving(false);
			if (ok) {
				setActiveField(null);
				setConfirmCancel(false);
			} else {
				setError(
					"The account type could not be saved. Review the workspace notice and try again.",
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
			edit.value.kind === "debt" &&
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
				previousBalance === undefined ||
				previous.isFetching ||
				previous.isError)
		) {
			setError("Load the balance at the adjustment time before saving.");
			return;
		}
		const moved =
			observedAt !== null && balance !== (existing?.balance ?? previousBalance);
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
									kind: row.kind as "cash" | "investment" | "debt" | "property",
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
				await refreshAccountAdjustments();
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
		previousBalance,
		previous,
		saveBlocked:
			saving ||
			(observedAt !== null &&
				(!Number.isFinite(instant) ||
					previous.isFetching ||
					previous.isPending ||
					previous.isError)),
	};
}

export type AccountEdit = ReturnType<typeof useAccountEdit>;
