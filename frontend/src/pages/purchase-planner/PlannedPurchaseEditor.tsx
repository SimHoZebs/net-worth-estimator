import { useId, useState, type FormEvent } from "react";
import type { Account, PlannedPurchase } from "../../domain/model.ts";
import { plannedPurchaseSchema, visibleAccounts } from "../../domain/model.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import {
	saveNewPurchase,
	savePurchaseEdit,
} from "../../state/purchaseWrites.ts";
import { Checkbox, InputField, SelectField } from "../../components/Field.tsx";
import { AccountOptions } from "../../components/editors/AccountOptions.tsx";
import { parseDisplayNumber } from "../../components/editors/formValues.ts";
import { Button } from "../../components/Button.tsx";
import { dialogActionsStyles } from "../../components/dialogStyles.ts";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Modal } from "../../components/Modal.tsx";
import { Notice } from "../../components/Notice.tsx";

/**
 * Row-first planned-purchase editor. Saves one planned purchase straight to
 * the server; no draft involved. A planned-purchase row is a hypothetical
 * placeholder for a future buy: it never posts money and never becomes a
 * scheduled transaction, it only asks the forecast for the earliest safe
 * date.
 */
export function PlannedPurchaseEditor({
	accounts,
	startDate,
	item,
	priority,
	onSaved,
	onClose,
}: {
	accounts: Account[];
	startDate: string;
	item: PlannedPurchase | null;
	/** Queue index of the row: the item index for edits, the end for adds. */
	priority: number;
	onSaved: () => void;
	onClose: () => void;
}) {
	const includeId = useId();
	const fundable = visibleAccounts(accounts).filter(
		(account) => account.enabled && account.kind !== "debt",
	);
	const [name, setName] = useState(item?.name ?? "");
	const [amount, setAmount] = useState(item ? String(item.amount) : "");
	const [fromId, setFromId] = useState(item?.fromId ?? "");
	const [earliest, setEarliest] = useState(item?.startDate ?? startDate);
	const [enabled, setEnabled] = useState(item?.enabled ?? true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmCancel, setConfirmCancel] = useState(false);

	const readOnly = item?.readOnly ?? false;
	const dirty =
		name !== (item?.name ?? "") ||
		amount !== (item ? String(item.amount) : "") ||
		fromId !== (item?.fromId ?? "") ||
		earliest !== (item?.startDate ?? startDate) ||
		enabled !== (item?.enabled ?? true);
	useBeforeUnload(dirty && !saving);
	const requestClose = () => {
		if (!dirty) return true;
		setConfirmCancel(true);
		return false;
	};
	const close = () => {
		if (requestClose()) onClose();
	};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (readOnly || saving) return;
		const trimmedName = name.trim();
		if (!trimmedName) {
			setError("Give the purchase a name.");
			return;
		}
		const cost = parseDisplayNumber(amount);
		if (cost === null || !(cost > 0) || cost > 1e10) {
			setError("Enter a cost above zero and no more than 10,000,000,000.");
			return;
		}
		if (!fromId) {
			setError("Choose the funding account for this purchase.");
			return;
		}
		if (!earliest) {
			setError("Choose the earliest purchase date.");
			return;
		}
		const purchase: PlannedPurchase = {
			id: item?.id ?? crypto.randomUUID(),
			name: trimmedName,
			amount: cost,
			fromId,
			startDate: earliest,
			enabled,
			readOnly: false,
		};
		const parsed = plannedPurchaseSchema.safeParse(purchase);
		if (!parsed.success) {
			setError(
				parsed.error.issues.map((issue) => issue.message).join(" ") ||
					"The purchase could not be saved. Review the form and try again.",
			);
			return;
		}
		setSaving(true);
		setError(null);
		const ok = item
			? await savePurchaseEdit(parsed.data, priority)
			: await saveNewPurchase(parsed.data, priority);
		setSaving(false);
		if (ok) onSaved();
		else
			setError(
				"The purchase could not be saved. Review the workspace notice and try again.",
			);
	};

	return (
		<Modal
			title={item ? "Edit purchase" : "Add purchase"}
			onClose={onClose}
			onCloseRequest={requestClose}
		>
			{readOnly && <Notice>These planned purchases are read-only.</Notice>}
			{error && <ErrorNotice message={error} />}
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
			>
				<fieldset
					disabled={readOnly || saving}
					className="grid grid-cols-2 gap-5 max-sm:gap-x-3 max-sm:gap-y-4 max-sm:grid-cols-1"
				>
					<InputField
						label="Purchase name"
						required
						maxLength={100}
						value={name}
						onChange={(event) => setName(event.target.value)}
						wide
					/>
					<InputField
						label="Cost (USD)"
						type="number"
						inputMode="decimal"
						min="0.01"
						max="10000000000"
						step="0.01"
						required
						value={amount}
						onChange={(event) => setAmount(event.target.value)}
					/>
					<SelectField
						label="Funding account"
						required
						value={fromId}
						onChange={(event) => setFromId(event.target.value)}
					>
						<option value="" disabled>
							Choose an account
						</option>
						<AccountOptions accounts={fundable} />
					</SelectField>
					<InputField
						label="Earliest purchase date"
						type="date"
						required
						value={earliest}
						onChange={(event) => setEarliest(event.target.value)}
						wide
					/>
					<p className="col-span-full text-xs text-muted">
						The forecast defers this item until its full cost fits, after all
						established payments. It never buys anything for you.
					</p>
					<label
						className="col-span-full flex cursor-pointer items-center gap-2 text-sm text-muted"
						htmlFor={includeId}
					>
						<Checkbox
							id={includeId}
							checked={enabled}
							onChange={(event) => setEnabled(event.target.checked)}
						/>{" "}
						Include in purchase queue
					</label>
				</fieldset>
				{confirmCancel ? (
					<div
						className="mt-6 rounded-surface border border-solid border-danger-border bg-danger-bg p-4"
						role="alert"
					>
						<p className="mb-3 text-sm text-danger-text">
							Discard the changes in this form?
						</p>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="secondary"
								onClick={() => setConfirmCancel(false)}
							>
								Continue
							</Button>
							<Button type="button" variant="danger" onClick={onClose}>
								Discard changes
							</Button>
						</div>
					</div>
				) : (
					<div className={dialogActionsStyles}>
						<Button type="button" variant="secondary" onClick={close}>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="primary"
							disabled={readOnly || saving || !dirty}
						>
							{saving ? "Saving…" : item ? "Save purchase" : "Add purchase"}
						</Button>
					</div>
				)}
			</form>
		</Modal>
	);
}
