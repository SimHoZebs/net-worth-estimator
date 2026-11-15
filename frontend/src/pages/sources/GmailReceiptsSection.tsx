import { useId, useState } from "react";
import { AlertCircle } from "lucide-react";
import type { EmailReceipt } from "../../api/generated/model/index.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card.tsx";
import { Field, FieldError, FieldLabel } from "@/components/ui/field.tsx";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemFooter,
	ItemGroup,
	ItemHeader,
	ItemTitle,
} from "@/components/ui/item.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { notifySuccess } from "../../state/notifications.ts";
import {
	confirmGmailReceipt,
	scanGmailReceiptsNow,
	useGmailReceipts,
} from "../../state/gmail.ts";

// Extracted Gmail receipt evidence for user review. Low-confidence
// extraction carries a needs-review badge with confirm and correct
// actions; corrections overlay the original values while the server
// preserves the original extraction and provenance for matching.
export function GmailReceiptsSection({ readOnly }: { readOnly: boolean }) {
	const receipts = useGmailReceipts();
	const [busy, setBusy] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);

	async function handleScan() {
		if (readOnly || busy) return;
		setBusy(true);
		// Failures reach the toast from the mutation.
		const summary = await scanGmailReceiptsNow();
		setBusy(false);
		if (!summary) return;
		const parts = [`${summary.triaged} new`];
		if (summary.receipts + summary.refunds > 0)
			parts.push(
				`${summary.receipts + summary.refunds} ${summary.receipts + summary.refunds === 1 ? "receipt" : "receipts"}`,
			);
		if (summary.needsReview > 0)
			parts.push(`${summary.needsReview} need review`);
		if (summary.failed > 0) parts.push(`${summary.failed} could not be read`);
		if (summary.truncated) parts.push("more mail remains for the next scan");
		notifySuccess("gmail-scan", `Scan complete: ${parts.join(", ")}.`);
	}

	const items = receipts.data ?? [];
	const pending = items.filter((item) => item.status === "needs-review");

	return (
		<Card role="region" aria-label="Extracted receipts" className="mt-6">
			<CardHeader>
				<CardTitle>
					<h3>Extracted receipts</h3>
				</CardTitle>
				{!receipts.isPending && (
					<CardDescription>
						{items.length === 0
							? "none yet"
							: `${items.length} found${pending.length > 0 ? `, ${pending.length} need review` : ""}`}
					</CardDescription>
				)}
				<CardAction className="max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-2 max-sm:justify-self-start">
					<Button
						variant="secondary"
						disabled={readOnly || busy || receipts.isPending}
						onClick={() => void handleScan()}
					>
						{busy ? "Scanning…" : "Scan now"}
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent>
				{receipts.isPending ? (
					<div aria-busy="true">
						<Skeleton className="h-16 w-full" />
					</div>
				) : receipts.isError ? (
					<Alert variant="destructive">
						<AlertCircle size={16} aria-hidden="true" />
						<AlertDescription>
							The extracted receipts could not be loaded.{" "}
							<Button variant="link" onClick={() => void receipts.refetch()}>
								Retry
							</Button>
						</AlertDescription>
					</Alert>
				) : items.length === 0 ? (
					<p className="m-0 text-sm leading-relaxed text-muted-foreground">
						Scan Gmail for purchase and refund receipts, excluding shipping
						updates and ordinary mail.
					</p>
				) : (
					<ItemGroup role="list">
						{items.map((item) => (
							<ReceiptRow
								key={item.id}
								item={item}
								readOnly={readOnly}
								editing={editingId === item.id}
								onEdit={() =>
									setEditingId(editingId === item.id ? null : item.id)
								}
								onDone={() => setEditingId(null)}
							/>
						))}
					</ItemGroup>
				)}
			</CardContent>
		</Card>
	);
}

function effective(item: EmailReceipt) {
	const cents = item.correction?.amountCents ?? item.amountCents;
	return {
		merchant: item.correction?.merchant || item.merchant || "Unknown merchant",
		date: item.correction?.receiptDate || item.receiptDate || "Unknown date",
		amount:
			cents !== undefined
				? formatCents(
						cents,
						item.correction?.currency || item.currency || "USD",
					)
				: "Unknown amount",
		reference: item.correction?.reference || item.reference,
	};
}

function formatCents(cents: number, currency: string) {
	return `${(cents / 100).toFixed(2)} ${currency}`;
}

function ReceiptRow({
	item,
	readOnly,
	editing,
	onEdit,
	onDone,
}: {
	item: EmailReceipt;
	readOnly: boolean;
	editing: boolean;
	onEdit: () => void;
	onDone: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const shown = effective(item);
	const needsReview = item.status === "needs-review";

	async function handleConfirm() {
		if (readOnly || busy) return;
		setBusy(true);
		const updated = await confirmGmailReceipt(item.id);
		setBusy(false);
		if (updated) onDone();
	}

	return (
		<Item role="listitem" variant="muted">
			<ItemHeader>
				<ItemTitle>{shown.merchant}</ItemTitle>
				<span className="flex flex-wrap gap-2">
					<Badge variant="secondary">
						{item.verdict === "refund" ? "Refund" : "Receipt"}
					</Badge>
					{needsReview ? (
						<Badge
							variant="default"
							className="bg-warning-bg text-warning-text"
						>
							Needs review
						</Badge>
					) : (
						<Badge
							variant="default"
							className="bg-success-bg text-success-text"
						>
							Reviewed
						</Badge>
					)}
				</span>
			</ItemHeader>
			<ItemContent>
				<ItemDescription className="line-clamp-none">
					{shown.date} · {shown.amount}
					{shown.reference ? ` · Order ${shown.reference}` : ""}
				</ItemDescription>
			</ItemContent>
			{needsReview && !readOnly && (
				<ItemFooter className="justify-start">
					<Button
						variant="link"
						className="min-h-6"
						disabled={busy}
						onClick={() => void handleConfirm()}
					>
						{busy ? "Confirming…" : "Confirm"}
					</Button>
					<Button
						variant="link"
						className="min-h-6"
						disabled={busy}
						onClick={onEdit}
					>
						{editing ? "Close correction" : "Correct"}
					</Button>
				</ItemFooter>
			)}
			{editing && needsReview && (
				<div className="basis-full">
					<CorrectionForm
						item={item}
						disabled={readOnly || busy}
						onDone={onDone}
					/>
				</div>
			)}
		</Item>
	);
}

function CorrectionForm({
	item,
	disabled,
	onDone,
}: {
	item: EmailReceipt;
	disabled: boolean;
	onDone: () => void;
}) {
	const merchantId = useId();
	const dateId = useId();
	const amountId = useId();
	const currencyId = useId();
	const referenceId = useId();
	const [merchant, setMerchant] = useState(item.merchant ?? "");
	const [date, setDate] = useState(item.receiptDate ?? "");
	const [amount, setAmount] = useState(
		item.amountCents !== undefined ? (item.amountCents / 100).toFixed(2) : "",
	);
	const [currency, setCurrency] = useState(item.currency ?? "USD");
	const [reference, setReference] = useState(item.reference ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSave(event: React.FormEvent) {
		event.preventDefault();
		if (disabled || busy) return;
		const parsed = Number.parseFloat(amount);
		if (amount.trim() !== "" && !(Number.isFinite(parsed) && parsed >= 0)) {
			setError("Enter the amount as dollars and cents, for example 42.50.");
			return;
		}
		if (date.trim() !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
			setError("Enter the date as YYYY-MM-DD.");
			return;
		}
		setBusy(true);
		setError(null);
		const updated = await confirmGmailReceipt(item.id, {
			merchant: merchant.trim(),
			receiptDate: date.trim(),
			amountCents: amount.trim() === "" ? undefined : Math.round(parsed * 100),
			currency: currency.trim().toUpperCase() || "USD",
			reference: reference.trim(),
		});
		setBusy(false);
		if (updated) onDone();
		// Failures reach the toast from the mutation.
	}

	return (
		<form
			method="post"
			aria-label="Correct extraction"
			onSubmit={handleSave}
			className="mt-3 grid gap-3"
		>
			<Field>
				<FieldLabel htmlFor={merchantId}>Merchant</FieldLabel>
				<Input
					id={merchantId}
					name="merchant"
					disabled={disabled || busy}
					value={merchant}
					onChange={(event) => setMerchant(event.target.value)}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={dateId}>Receipt date (YYYY-MM-DD)</FieldLabel>
				<Input
					id={dateId}
					name="receiptDate"
					disabled={disabled || busy}
					value={date}
					onChange={(event) => setDate(event.target.value)}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={amountId}>Amount</FieldLabel>
				<Input
					id={amountId}
					name="amount"
					disabled={disabled || busy}
					value={amount}
					onChange={(event) => setAmount(event.target.value)}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={currencyId}>Currency</FieldLabel>
				<Input
					id={currencyId}
					name="currency"
					disabled={disabled || busy}
					value={currency}
					onChange={(event) => setCurrency(event.target.value)}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={referenceId}>Order reference</FieldLabel>
				<Input
					id={referenceId}
					name="reference"
					disabled={disabled || busy}
					value={reference}
					onChange={(event) => setReference(event.target.value)}
				/>
			</Field>
			{error ? <FieldError>{error}</FieldError> : null}
			<div>
				<Button variant="secondary" type="submit" disabled={disabled || busy}>
					{busy ? "Saving…" : "Save correction"}
				</Button>
			</div>
		</form>
	);
}
