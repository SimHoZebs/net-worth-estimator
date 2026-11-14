import { useId, useState, type FormEvent } from "react";
import type { Account, PlannedPurchase } from "../../domain/model.ts";
import { visibleAccounts } from "../../domain/model.ts";
import { plannedPurchaseSchema } from "../../domain/modelSchemas.ts";
import {
	DiscardConfirm,
	useDiscardGuard,
} from "../../components/editors/EditorDialog.tsx";
import {
	saveNewPurchase,
	savePurchaseEdit,
} from "../../state/purchaseWrites.ts";
import { Field, FieldContent } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { parseDisplayNumber } from "../../components/editors/formValues.ts";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";

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

	const readOnly = item?.readOnly ?? false;
	const dirty =
		name !== (item?.name ?? "") ||
		amount !== (item ? String(item.amount) : "") ||
		fromId !== (item?.fromId ?? "") ||
		earliest !== (item?.startDate ?? startDate) ||
		enabled !== (item?.enabled ?? true);
	const guard = useDiscardGuard({ dirty, busy: saving });
	const close = () => guard.requestClose(onClose);

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
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
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
						<Field className="col-span-full">
							<Label htmlFor={nameId}>Purchase name</Label>
							<Input
								id={nameId}
								required
								maxLength={100}
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
						</Field>
						<Field>
							<Label htmlFor={costId}>Cost (USD)</Label>
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
						<Field>
							<Label htmlFor={accountId}>Funding account</Label>
							<Select
								value={fromId}
								items={Object.fromEntries(
									fundable.map((account) => [account.id, account.name]),
								)}
								onValueChange={(value) => setFromId(value ?? "")}
							>
								<SelectTrigger id={accountId}>
									<SelectValue placeholder="Choose an account" />
								</SelectTrigger>
								<SelectContent>
									{fundable.map((account) => (
										<SelectItem key={account.id} value={account.id}>
											{account.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
						<Field className="col-span-full">
							<Label htmlFor={earliestId}>Earliest purchase date</Label>
							<Input
								id={earliestId}
								type="date"
								required
								value={earliest}
								onChange={(event) => setEarliest(event.target.value)}
							/>
						</Field>
						<p className="col-span-full text-xs text-muted-foreground">
							The forecast defers this item until its full cost fits, after all
							established payments. It never buys anything for you.
						</p>
						<Field orientation="horizontal" className="col-span-full">
							<Checkbox
								id={includeId}
								checked={enabled}
								disabled={readOnly || saving}
								onCheckedChange={(checked) => setEnabled(checked === true)}
							/>
							<FieldContent>
								<Label htmlFor={includeId}>Include in purchase queue</Label>
							</FieldContent>
						</Field>
					</fieldset>
					{error && (
						<p
							role="alert"
							className="m-0 text-sm leading-relaxed text-danger-text"
						>
							{error}
						</p>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="secondary"
							disabled={saving}
							onClick={close}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="default"
							disabled={readOnly || saving || !dirty}
						>
							{saving ? "Saving…" : item ? "Save purchase" : "Add purchase"}
						</Button>
					</DialogFooter>
				</form>
				<DiscardConfirm
					open={guard.confirming}
					onContinue={guard.dismissConfirm}
					onDiscard={onClose}
				/>
			</DialogContent>
		</Dialog>
	);
}
