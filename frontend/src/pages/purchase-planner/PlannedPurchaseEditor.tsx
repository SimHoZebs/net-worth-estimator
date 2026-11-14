import { useId, useState, type FormEvent } from "react";
import type { Account, PlannedPurchase } from "../../domain/model.ts";
import { visibleAccounts } from "../../domain/model.ts";
import { plannedPurchaseSchema } from "../../domain/modelSchemas.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import {
	saveNewPurchase,
	savePurchaseEdit,
} from "../../state/purchaseWrites.ts";
import { Field } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { AccountOptions } from "../../components/editors/AccountOptions.tsx";
import { parseDisplayNumber } from "../../components/editors/formValues.ts";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";

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
	const nameId = useId();
	const costId = useId();
	const accountId = useId();
	const earliestId = useId();
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
		// A failure reaches the toast from the purchase write; the form stays
		// open with its values for retry. Only validation stays inline.
		if (ok) onSaved();
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<DialogContent
				className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl")}
			>
				<DialogHeader>
					<DialogTitle>{item ? "Edit purchase" : "Add purchase"}</DialogTitle>
					<DialogDescription className="sr-only">
						Planned purchase details
					</DialogDescription>
				</DialogHeader>
				{readOnly && (
					<Alert variant="default" role="note">
						<AlertDescription>
							These planned purchases are read-only.
						</AlertDescription>
					</Alert>
				)}
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => void submit(event)}
				>
					<fieldset
						disabled={readOnly || saving}
						className="grid grid-cols-2 gap-5 max-sm:gap-x-3 max-sm:gap-y-4 max-sm:grid-cols-1"
					>
						<Field className={cn("flex min-w-0 flex-col gap-2 col-span-full")}>
							<Label
								htmlFor={nameId}
								className="text-sm leading-normal font-semibold text-muted"
							>
								Purchase name
							</Label>
							<Input
								id={nameId}
								required
								maxLength={100}
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
						</Field>
						<Field className={cn("flex min-w-0 flex-col gap-2")}>
							<Label
								htmlFor={costId}
								className="text-sm leading-normal font-semibold text-muted"
							>
								Cost (USD)
							</Label>
							<Input
								id={costId}
								type="number"
								inputMode="decimal"
								min="0.01"
								max="10000000000"
								step="0.01"
								required
								value={amount}
								onChange={(event) => setAmount(event.target.value)}
							/>
						</Field>
						<Field className={cn("flex min-w-0 flex-col gap-2")}>
							<Label
								htmlFor={accountId}
								className="text-sm leading-normal font-semibold text-muted"
							>
								Funding account
							</Label>
							<select
								id={accountId}
								required
								value={fromId}
								onChange={(event) => setFromId(event.target.value)}
								className={cn(
									"h-11 w-full rounded-control border border-solid border-line-strong bg-input-bg px-3 py-2 text-base font-normal text-ink placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60",
								)}
							>
								<option value="" disabled>
									Choose an account
								</option>
								<AccountOptions accounts={fundable} />
							</select>
						</Field>
						<Field className={cn("flex min-w-0 flex-col gap-2 col-span-full")}>
							<Label
								htmlFor={earliestId}
								className="text-sm leading-normal font-semibold text-muted"
							>
								Earliest purchase date
							</Label>
							<Input
								id={earliestId}
								type="date"
								required
								value={earliest}
								onChange={(event) => setEarliest(event.target.value)}
							/>
						</Field>
						<p className="col-span-full text-xs text-muted">
							The forecast defers this item until its full cost fits, after all
							established payments. It never buys anything for you.
						</p>
						<Label
							className="col-span-full flex cursor-pointer items-center gap-2 text-sm text-muted"
							htmlFor={includeId}
						>
							<Checkbox
								id={includeId}
								checked={enabled}
								disabled={readOnly || saving}
								onCheckedChange={(checked) => setEnabled(checked === true)}
							/>{" "}
							Include in purchase queue
						</Label>
					</fieldset>
					{error && (
						<p
							role="alert"
							className="m-0 text-sm leading-relaxed text-danger-text"
						>
							{error}
						</p>
					)}
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
								<Button type="button" variant="destructive" onClick={onClose}>
									Discard changes
								</Button>
							</div>
						</div>
					) : (
						<div
							className={cn(
								"mt-6 flex flex-wrap items-center justify-end gap-3 border-0 border-t border-solid border-line pt-5",
							)}
						>
							<Button type="button" variant="secondary" onClick={close}>
								Cancel
							</Button>
							<Button
								type="submit"
								variant="default"
								disabled={readOnly || saving || !dirty}
							>
								{saving ? "Saving…" : item ? "Save purchase" : "Add purchase"}
							</Button>
						</div>
					)}
				</form>
			</DialogContent>
		</Dialog>
	);
}
