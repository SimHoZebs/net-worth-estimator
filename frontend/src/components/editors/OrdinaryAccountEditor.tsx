import { LockKeyhole } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { createAccount, updateAccount } from "@/api/generated/endpoints.ts";
import type { Account } from "../../domain/model.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import { refreshAccounts } from "../../state/workspaceResources.ts";
import { parseDisplayNumber } from "./formValues.ts";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Field, FieldError, FieldTitle } from "@/components/ui/field.tsx";
import { DialogFooter } from "@/components/ui/dialog.tsx";
import { DiscardConfirm, useDiscardGuard } from "./EditorDialog.tsx";
import { MoneyField } from "./editorFields.tsx";

/** Row-first account editor. Saves straight to the server; no draft involved. */
export function OrdinaryAccountEditor({
	item,
	onSaved,
	onClose,
	formId,
	name,
	kind,
	enabled,
	dirtyOutside = false,
	onDirtyChange,
	onSavingChange,
}: {
	item: Account | null;
	onSaved: () => void;
	onClose: () => void;
	formId: string;
	name: string;
	kind: Account["kind"];
	enabled: boolean;
	dirtyOutside?: boolean;
	onDirtyChange?: (dirty: boolean) => void;
	onSavingChange: (saving: boolean) => void;
}) {
	const [balance, setBalance] = useState(String(item?.balance ?? 0));
	const [minBalance, setMinBalance] = useState(String(item?.minBalance ?? 0));
	const [maxBalance, setMaxBalance] = useState(
		item?.maxBalance === null || item?.maxBalance === undefined
			? ""
			: String(item.maxBalance),
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const balanceId = useId();
	const minBalanceId = useId();
	const maxBalanceId = useId();

	const ownDirty =
		name !== (item?.name ?? "") ||
		kind !== (item?.kind ?? "cash") ||
		enabled !== (item?.enabled ?? true) ||
		balance !== String(item?.balance ?? 0) ||
		minBalance !== String(item?.minBalance ?? 0) ||
		maxBalance !==
			(item?.maxBalance === null || item?.maxBalance === undefined
				? ""
				: String(item.maxBalance));
	const dirty = ownDirty || dirtyOutside;
	const guard = useDiscardGuard({ dirty, busy: saving });
	useEffect(() => {
		onDirtyChange?.(ownDirty);
	}, [ownDirty, onDirtyChange]);

	const readOnly = item?.readOnly ?? false;
	const locked = readOnly || saving;

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (readOnly || saving) return;
		const trimmedName = name.trim();
		if (!trimmedName) {
			setError("Give the account a name.");
			return;
		}
		setSaving(true);
		onSavingChange(true);
		setError(null);
		const parsedBalance = parseDisplayNumber(balance) ?? 0;
		const body = {
			name: trimmedName,
			kind,
			enabled,
			minBalance: parseDisplayNumber(minBalance) ?? 0,
			...(maxBalance.trim() && parseDisplayNumber(maxBalance) !== null
				? { maxBalance: parseDisplayNumber(maxBalance) as number }
				: {}),
			...(item?.color ? { color: item.color } : {}),
		};
		const nowInstant = Math.floor(Date.now() / 1000);
		const moved =
			!item ||
			parsedBalance !== item.balance ||
			item.observedAt == null ||
			!item.balanceCheck;
		const ok = item
			? await performSave({
					call: () =>
						updateAccount(item.id, {
							...body,
							...(moved
								? {
										balance: parsedBalance,
										observedAt: nowInstant,
									}
								: {}),
						}),
					refresh: refreshAccounts,
					failureMessage: "The account could not be saved.",
				})
			: await performSave({
					call: () =>
						createAccount({
							...body,
							balance: parsedBalance,
							observedAt: nowInstant,
						}),
					refresh: refreshAccounts,
					failureMessage: "The account could not be saved.",
				});
		setSaving(false);
		onSavingChange(false);
		if (ok) onSaved();
		else
			setError(
				"The account could not be saved. Review the workspace notice and try again.",
			);
	};

	return (
		<>
			{readOnly && (
				<Alert>
					<LockKeyhole aria-hidden="true" />
					<AlertDescription>
						This account is synced from your bank and cannot be edited here.
					</AlertDescription>
				</Alert>
			)}
			<form
				id={formId}
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
			>
				<fieldset
					disabled={locked}
					className="m-0 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1"
				>
					<MoneyField
						id={balanceId}
						label="Balance"
						required
						min="-10000000000"
						max="10000000000"
						step="0.01"
						value={balance}
						onChange={(event) => setBalance(event.target.value)}
						disabled={locked}
					/>
					<MoneyField
						id={minBalanceId}
						label="Protected balance"
						required
						min="0"
						max="10000000000"
						step="0.01"
						value={minBalance}
						onChange={(event) => setMinBalance(event.target.value)}
						disabled={locked}
					/>
					<MoneyField
						id={maxBalanceId}
						label="Maximum balance"
						min="0"
						max="10000000000"
						step="0.01"
						value={maxBalance}
						onChange={(event) => setMaxBalance(event.target.value)}
						placeholder="No ceiling"
						disabled={locked}
					/>
					<Field className="col-span-full">
						<FieldTitle>Source</FieldTitle>
						<Badge variant="outline">{item?.source ?? "Manual entry"}</Badge>
					</Field>
				</fieldset>
				{error ? <FieldError>{error}</FieldError> : null}
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => guard.requestClose(onClose)}
					>
						Cancel
					</Button>
					<Button type="submit" disabled={saving || readOnly || !dirty}>
						{saving ? "Saving…" : item ? "Save account" : "Add account"}
					</Button>
				</DialogFooter>
			</form>
			<DiscardConfirm
				open={guard.confirming}
				onContinue={guard.dismissConfirm}
				onDiscard={onClose}
			/>
		</>
	);
}
