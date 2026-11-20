import { useId, useState } from "react";
import type { Account, PlannedPurchase } from "../../domain/model.ts";
import { visibleAccounts } from "../../domain/model.ts";
import { isLiability } from "../../domain/accountKinds.ts";
import { plannedPurchaseSchema } from "../../domain/modelSchemas.ts";
import { EditorDialog } from "../../components/editors/EditorDialog.tsx";
import {
	saveNewPurchase,
	savePurchaseEdit,
} from "../../state/purchaseWrites.ts";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
	FieldSet,
} from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { parseDisplayNumber } from "../../components/editors/formValues.ts";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";

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
		(account) => account.enabled && !isLiability(account),
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

	const submit = async () => {
		if (readOnly || saving) return;
		if (!fromId) {
			setError("Choose a funding account.");
			return;
		}
		const parsed = plannedPurchaseSchema.safeParse({
			id: item?.id ?? crypto.randomUUID(),
			name: name.trim(),
			amount: parseDisplayNumber(amount),
			fromId,
			startDate: earliest,
			enabled,
			readOnly: false,
		});
		if (!parsed.success) {
			setError(
				parsed.error.issues.map((issue) => issue.message).join(" ") ||
					"The purchase could not be saved. Review the form and try again.",
			);
			return;
		}
		const purchase: PlannedPurchase = parsed.data;
		setSaving(true);
		setError(null);
		const ok = item
			? await savePurchaseEdit(purchase, priority)
			: await saveNewPurchase(purchase, priority);
		setSaving(false);
		// A failure reaches the toast from the purchase write; the form stays
		// open with its values for retry. Only validation stays inline.
		if (ok) onSaved();
	};

	return (
		<EditorDialog
			title={item ? "Edit purchase" : "Add purchase"}
			onClose={onClose}
			dirty={dirty}
			busy={saving}
			error={error}
			submitLabel={item ? "Save purchase" : "Add purchase"}
			submitDisabled={readOnly || saving || !dirty}
			onSubmit={() => void submit()}
		>
			{readOnly && (
				<Alert variant="default" role="note">
					<AlertDescription>
						These planned purchases are read-only.
					</AlertDescription>
				</Alert>
			)}
			<FieldSet
				disabled={readOnly || saving}
				className="grid grid-cols-2 gap-5 max-sm:gap-x-3 max-sm:gap-y-4 max-sm:grid-cols-1"
			>
				<Field className="col-span-full">
					<FieldLabel htmlFor={nameId}>Purchase name</FieldLabel>
					<Input
						id={nameId}
						required
						maxLength={100}
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor={costId}>Cost (USD)</FieldLabel>
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
					<FieldLabel htmlFor={accountId}>Funding account</FieldLabel>
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
					<FieldLabel htmlFor={earliestId}>Earliest purchase date</FieldLabel>
					<Input
						id={earliestId}
						type="date"
						required
						value={earliest}
						onChange={(event) => setEarliest(event.target.value)}
					/>
					<FieldDescription>
						The forecast defers this item until its full cost fits, after all
						established payments. It never buys anything for you.
					</FieldDescription>
				</Field>
				<Field orientation="horizontal" className="col-span-full">
					<Checkbox
						id={includeId}
						checked={enabled}
						disabled={readOnly || saving}
						onCheckedChange={(checked) => setEnabled(checked === true)}
					/>
					<FieldContent>
						<FieldLabel htmlFor={includeId}>
							Include in purchase queue
						</FieldLabel>
					</FieldContent>
				</Field>
			</FieldSet>
		</EditorDialog>
	);
}
