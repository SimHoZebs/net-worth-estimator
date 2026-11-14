import { useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
	listAccountBalances,
	updateAccount,
} from "@/api/generated/endpoints.ts";
import type { Account } from "../../domain/model.ts";
import type { BalanceAdjustment } from "@/api/generated/model/balanceAdjustment.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { useEditDraft } from "../editors/useEditDraft.ts";
import { parseDisplayNumber } from "../editors/formValues.ts";
import { accountUpdateBody } from "../editors/accountFields.ts";
import { getAccountBalances } from "../../state/workspaceResources.ts";
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
	| "time";

export function useAccountEdit(
	account: Account,
	readOnly: boolean,
	adjustments: BalanceAdjustment[],
) {
	const source = {
		name: account.name,
		balance: String(account.balance),
		kind: account.kind,
		enabled: account.enabled,
		minBalance: String(account.minBalance),
		maxBalance: account.maxBalance === null ? "" : String(account.maxBalance),
		noCeiling: account.maxBalance === null,
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
		// update the type there.
		if (saving || (readOnly && field !== "kind")) return;
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
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (saving) return;
		// Synced accounts lock every field except kind. A kind change
		// writes only the kind plus the current bounds verbatim.
		if (readOnly) {
			if (edit.value.kind === account.kind) {
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
		if (edit.value.kind === "debt" ? balance > 0 : balance < 0) {
			setError(
				edit.value.kind === "debt"
					? "Enter debt as a negative balance."
					: "Asset balances cannot be negative.",
			);
			return;
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
			call: () => {
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
							minBalance,
							maxBalance,
							noCeiling: edit.value.noCeiling,
						},
					}),
					...(moved ? { balance, observedAt: Math.floor(instant / 1000) } : {}),
				});
			},
			refresh: refreshAccountAdjustments,
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
