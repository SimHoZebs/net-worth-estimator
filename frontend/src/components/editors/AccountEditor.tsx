import { useId, useState, type FormEvent } from "react";
import { createAccount, updateAccount } from "@/api/generated/endpoints.ts";
import type { Account } from "../../domain/model.ts";
import { todayIso } from "../../domain/format.ts";
import { parseUnion } from "../../domain/guards.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import { refreshAccounts } from "../../state/workspaceResources.ts";
import { parseDisplayNumber } from "./formValues.ts";
import { Checkbox, InputField, SelectField } from "../Field.tsx";
import { Button } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { Notice } from "../Notice.tsx";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { Modal } from "../Modal.tsx";
import { Badge } from "../Badge.tsx";

/** Row-first account editor. Saves straight to the server; no draft involved. */
export function AccountEditor({
	item,
	onSaved,
	onClose,
}: {
	item: Account | null;
	onSaved: () => void;
	onClose: () => void;
}) {
	const [name, setName] = useState(item?.name ?? "");
	const [kind, setKind] = useState<Account["kind"]>(item?.kind ?? "cash");
	const [enabled, setEnabled] = useState(item?.enabled ?? true);
	const [balance, setBalance] = useState(String(item?.balance ?? 0));
	const [minBalance, setMinBalance] = useState(String(item?.minBalance ?? 0));
	const [maxBalance, setMaxBalance] = useState(
		item?.maxBalance === null || item?.maxBalance === undefined
			? ""
			: String(item.maxBalance),
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const enabledId = useId();

	const dirty =
		name !== (item?.name ?? "") ||
		kind !== (item?.kind ?? "cash") ||
		enabled !== (item?.enabled ?? true) ||
		balance !== String(item?.balance ?? 0) ||
		minBalance !== String(item?.minBalance ?? 0) ||
		maxBalance !==
			(item?.maxBalance === null || item?.maxBalance === undefined
				? ""
				: String(item.maxBalance));
	useBeforeUnload(dirty && !saving);

	const readOnly = item?.readOnly ?? false;

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (readOnly || saving) return;
		const trimmedName = name.trim();
		if (!trimmedName) {
			setError("Give the account a name.");
			return;
		}
		setSaving(true);
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
		const moved =
			!item ||
			parsedBalance !== item.balance ||
			item.observedOn === undefined ||
			!item.balanceCheck;
		const ok = item
			? await performSave({
					call: () =>
						updateAccount(item.id, {
							...body,
							...(moved
								? {
										balance: parsedBalance,
										observedOn: item.observedOn || todayIso(),
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
							observedOn: todayIso(),
						}),
					refresh: refreshAccounts,
					failureMessage: "The account could not be saved.",
				});
		setSaving(false);
		if (ok) onSaved();
		else
			setError(
				"The account could not be saved. Review the workspace notice and try again.",
			);
	};

	return (
		<Modal title={`${item ? "Edit" : "Add"} account`} onClose={onClose}>
			{readOnly && (
				<Notice>
					This account is synced from your bank and cannot be edited here.
				</Notice>
			)}
			{error && <ErrorNotice message={error} />}
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
			>
				<fieldset
					disabled={readOnly || saving}
					className="m-0 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1 max-sm:gap-x-3 max-sm:gap-y-4"
				>
					<InputField
						label="Account name"
						wide
						required
						maxLength={100}
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. Savings account"
					/>
					<SelectField
						label="Account type"
						value={kind}
						onChange={(event) =>
							setKind(
								parseUnion(event.target.value, [
									"cash",
									"investment",
									"property",
									"debt",
								] as const) ?? "cash",
							)
						}
					>
						<option value="cash">Cash & savings</option>
						<option value="investment">Investments</option>
						<option value="property">Property</option>
						<option value="debt">Debt</option>
					</SelectField>
					<label
						htmlFor={enabledId}
						className="flex min-h-11 items-center gap-3 text-sm text-muted"
					>
						<Checkbox
							id={enabledId}
							checked={enabled}
							onChange={(event) => setEnabled(event.target.checked)}
						/>
						Include in net worth and projections
					</label>
					<InputField
						label="Balance (USD)"
						type="number"
						required
						step="0.01"
						min="-10000000000"
						max="10000000000"
						value={balance}
						onChange={(event) => setBalance(event.target.value)}
					/>
					<InputField
						label="Protected balance (USD)"
						type="number"
						required
						min="0"
						max="10000000000"
						step="0.01"
						value={minBalance}
						onChange={(event) => setMinBalance(event.target.value)}
					/>
					<InputField
						label="Maximum balance (USD)"
						type="number"
						min="0"
						max="10000000000"
						step="0.01"
						value={maxBalance}
						onChange={(event) => setMaxBalance(event.target.value)}
						placeholder="No ceiling"
					/>
					<div className="col-span-full flex flex-col gap-2">
						<span
							id="account-source-label"
							className="text-sm font-semibold text-muted"
						>
							Source
						</span>
						<div aria-labelledby="account-source-label">
							<Badge tone="outline">{item?.source ?? "Manual entry"}</Badge>
						</div>
					</div>
				</fieldset>
				<div className={dialogActionsStyles}>
					<Button type="button" variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" disabled={readOnly || saving || !dirty}>
						{saving ? "Saving…" : item ? "Save account" : "Add account"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
