import { useState } from "react";
import type { EmailReceipt } from "../../api/generated/model/index.ts";
import { Badge } from "../../components/Badge.tsx";
import { Button, TextButton } from "../../components/Button.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { InputField } from "../../components/Field.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
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
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);

	async function handleScan() {
		if (readOnly || busy) return;
		setBusy(true);
		setError(null);
		const summary = await scanGmailReceiptsNow();
		setBusy(false);
		if (!summary) {
			setError("The scan could not start. Try again.");
			return;
		}
		const parts = [`${summary.triaged} new`];
		if (summary.receipts + summary.refunds > 0)
			parts.push(
				`${summary.receipts + summary.refunds} ${summary.receipts + summary.refunds === 1 ? "receipt" : "receipts"}`,
			);
		if (summary.needsReview > 0)
			parts.push(`${summary.needsReview} need review`);
		if (summary.failed > 0) parts.push(`${summary.failed} could not be read`);
		if (summary.truncated) parts.push("more mail remains for the next scan");
		setMessage(`Scan complete: ${parts.join(", ")}.`);
	}

	const items = receipts.data ?? [];
	const pending = items.filter((item) => item.status === "needs-review");

	return (
		<section
			aria-label="Extracted receipts"
			className="mt-6 overflow-hidden rounded-surface border border-line bg-surface"
		>
			<div className="p-5 sm:p-6">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h3 className="m-0 text-lg">
						Extracted receipts{" "}
						{!receipts.isPending && (
							<span className="text-sm font-normal text-muted">
								{items.length === 0
									? "none yet"
									: `${items.length} found${pending.length > 0 ? `, ${pending.length} need review` : ""}`}
							</span>
						)}
					</h3>
					<Button
						variant="secondary"
						disabled={readOnly || busy || receipts.isPending}
						onClick={() => void handleScan()}
					>
						{busy ? "Scanning…" : "Scan now"}
					</Button>
				</div>
				<p
					role="status"
					className={
						message ? "mt-3 mb-0 text-sm text-success-text" : "sr-only"
					}
				>
					{message}
				</p>
				{error && (
					<div className="mt-3">
						<ErrorNotice message={error} />
					</div>
				)}
				{receipts.isPending ? (
					<div aria-busy="true" className="mt-4">
						<Skeleton className="h-16 w-full" />
					</div>
				) : receipts.isError ? (
					<div className="mt-4">
						<ErrorNotice
							message="The extracted receipts could not be loaded."
							action="Retry"
							onAction={() => void receipts.refetch()}
						/>
					</div>
				) : items.length === 0 ? (
					<p className="mt-4 mb-0 text-sm leading-relaxed text-muted">
						Run a scan to find purchase and refund receipts in Gmail. Shipping
						updates and ordinary mail are left out.
					</p>
				) : (
					<ul className="mt-4 grid list-none gap-3 p-0">
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
					</ul>
				)}
			</div>
		</section>
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
		<li className="rounded-control border border-line bg-surface-2 p-4">
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-medium">{shown.merchant}</span>
				<Badge tone="neutral">
					{item.verdict === "refund" ? "Refund" : "Receipt"}
				</Badge>
				{needsReview ? (
					<Badge tone="warning">Needs review</Badge>
				) : (
					<Badge tone="success">Reviewed</Badge>
				)}
			</div>
			<p className="mt-2 mb-0 text-sm leading-relaxed text-muted">
				{shown.date} · {shown.amount}
				{shown.reference ? ` · Order ${shown.reference}` : ""}
			</p>
			{needsReview && !readOnly && (
				<div className="mt-3 flex flex-wrap gap-4">
					<TextButton
						className="min-h-6"
						disabled={busy}
						onClick={() => void handleConfirm()}
					>
						{busy ? "Confirming…" : "Confirm"}
					</TextButton>
					<TextButton className="min-h-6" disabled={busy} onClick={onEdit}>
						{editing ? "Close correction" : "Correct"}
					</TextButton>
				</div>
			)}
			{editing && needsReview && (
				<CorrectionForm
					item={item}
					disabled={readOnly || busy}
					onDone={onDone}
				/>
			)}
		</li>
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
		else setError("Could not save the correction. Try again.");
	}

	return (
		<form
			method="post"
			aria-label="Correct extraction"
			onSubmit={handleSave}
			className="mt-3 grid gap-3"
		>
			<InputField
				name="merchant"
				label="Merchant"
				disabled={disabled || busy}
				value={merchant}
				onChange={(event) => setMerchant(event.target.value)}
			/>
			<InputField
				name="receiptDate"
				label="Receipt date (YYYY-MM-DD)"
				disabled={disabled || busy}
				value={date}
				onChange={(event) => setDate(event.target.value)}
			/>
			<InputField
				name="amount"
				label="Amount"
				disabled={disabled || busy}
				value={amount}
				onChange={(event) => setAmount(event.target.value)}
			/>
			<InputField
				name="currency"
				label="Currency"
				disabled={disabled || busy}
				value={currency}
				onChange={(event) => setCurrency(event.target.value)}
			/>
			<InputField
				name="reference"
				label="Order reference"
				disabled={disabled || busy}
				value={reference}
				onChange={(event) => setReference(event.target.value)}
			/>
			{error && <ErrorNotice message={error} />}
			<div>
				<Button variant="secondary" type="submit" disabled={disabled || busy}>
					{busy ? "Saving…" : "Save correction"}
				</Button>
			</div>
		</form>
	);
}
