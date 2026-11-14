import { useId, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ReceiptOutputBody } from "@/api/generated/model/index.ts";
import {
	receiptDetails,
	receiptDraft,
	type ReceiptDraft,
} from "@/domain/receipt.ts";
import { useBeforeUnload } from "@/state/useBeforeUnload.ts";
import { useReceipt, useReceiptActions } from "@/state/receipts.ts";
import { notifySuccess } from "../../state/notifications.ts";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Field } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";
import { ReceiptItems } from "./ReceiptItems.tsx";
import { ReceiptPreview } from "./ReceiptPreview.tsx";
import { ReceiptExtractionEvidence } from "./ReceiptExtractionEvidence.tsx";
import { ReceiptExtractionAction } from "./ReceiptExtractionAction.tsx";
import { ReceiptImageActions } from "./ReceiptImageActions.tsx";

const fieldLabelClassName = "text-sm leading-normal font-semibold text-muted";
const fieldInputClassName =
	"h-11 bg-input-bg px-3 text-base text-ink placeholder:text-subtle disabled:bg-transparent focus-visible:outline-solid focus-visible:ring-0";
const fieldSelectClassName =
	"h-11 w-full rounded-control border border-solid border-line-strong bg-input-bg px-3 py-2 text-base font-normal text-ink placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClassName =
	"min-h-10 border-line-strong bg-surface px-4 py-2 text-sm leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0";

function ReceiptField({
	id,
	label,
	className,
	children,
}: {
	id: string;
	label: string;
	className?: string;
	children: (id: string) => ReactNode;
}) {
	return (
		<Field className={cn("flex min-w-0 flex-col gap-2", className)}>
			<Label htmlFor={id} className={fieldLabelClassName}>
				{label}
			</Label>
			{children(id)}
		</Field>
	);
}

export function ReceiptReviewDialog({
	id,
	readOnly,
	extractionAvailable,
	onClose,
}: {
	id: string;
	readOnly: boolean;
	extractionAvailable: boolean;
	onClose: () => void;
}) {
	const query = useReceipt(id);
	return createPortal(
		query.data ? (
			<ReceiptEditor
				payload={query.data}
				readOnly={readOnly}
				extractionAvailable={extractionAvailable}
				onClose={onClose}
				reload={() => void query.refetch()}
			/>
		) : (
			<Dialog
				open
				onOpenChange={(open) => {
					if (!open) onClose();
				}}
			>
				<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>Receipt details</DialogTitle>
					</DialogHeader>
					{query.error ? (
						<Alert variant="destructive">
							<AlertDescription className="min-w-0 break-words">
								<p className="my-1 whitespace-pre-line">
									{query.error.message}
								</p>
								<Button
									variant="link"
									className="mt-2 px-0 py-0.5 text-xs font-semibold"
									onClick={() => void query.refetch()}
								>
									Retry receipt
								</Button>
							</AlertDescription>
						</Alert>
					) : (
						<p role="status" className="text-sm text-muted">
							Loading private receipt…
						</p>
					)}
				</DialogContent>
			</Dialog>
		),
		document.body,
	);
}

function ReceiptEditor({
	payload,
	readOnly,
	extractionAvailable,
	onClose,
	reload,
}: {
	payload: ReceiptOutputBody;
	readOnly: boolean;
	extractionAvailable: boolean;
	onClose: () => void;
	reload: () => void;
}) {
	const receipt = payload.receipt;
	const actions = useReceiptActions(receipt.transactionId);
	const [edit, setEdit] = useState<{
		revision: number;
		draft: ReceiptDraft;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [askDiscard, setAskDiscard] = useState(false);
	const source = receiptDraft(
		receipt.draft ?? receipt.confirmed ?? receipt.extraction?.details,
	);
	const draft = edit?.draft ?? source;
	const dirty = JSON.stringify(draft) !== JSON.stringify(source);
	const conflict = dirty && edit?.revision !== receipt.revision;
	const busy =
		actions.extract.isPending ||
		actions.review.isPending ||
		actions.remove.isPending ||
		actions.replace.isPending;
	const extracting = receipt.status === "extracting";
	const fieldPrefix = useId();
	useBeforeUnload(dirty);
	const update = (patch: Partial<ReceiptDraft>) => {
		setEdit({
			revision: edit?.revision ?? receipt.revision,
			draft: { ...draft, ...patch },
		});
		setError(null);
	};
	const save = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (conflict || readOnly || busy) return;
		const submitter = (event.nativeEvent as SubmitEvent).submitter;
		const confirm =
			submitter instanceof HTMLButtonElement && submitter.value === "confirm";
		try {
			await actions.review.mutateAsync({
				id: receipt.id,
				revision: receipt.revision,
				details: receiptDetails(draft),
				confirm,
			});
			setEdit(null);
			setError(null);
			setAskDiscard(false);
			notifySuccess("receipt-notice", "Receipt details saved.");
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The receipt could not be saved.",
			);
		}
	};
	const mutationError = error ?? actions.extract.error?.message;
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (open) return;
				if (busy) return;
				if (dirty) {
					setAskDiscard(true);
					return;
				}
				onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Receipt details</DialogTitle>
				</DialogHeader>
				{askDiscard && (
					<Alert
						variant="default"
						className={cn(
							"flex-col gap-3 border-warning-border bg-warning-bg p-4 text-warning-text",
						)}
					>
						<AlertDescription className="text-warning-text">
							<p>Discard unsaved receipt edits?</p>
							<div className="flex flex-wrap gap-2">
								<Button
									variant="secondary"
									className={secondaryButtonClassName}
									onClick={() => setAskDiscard(false)}
								>
									Continue editing
								</Button>
								<Button
									variant="destructive"
									className="min-h-10 bg-danger-solid px-4 py-2 text-sm leading-snug text-on-danger enabled:hover:brightness-90 focus-visible:outline-solid focus-visible:ring-0"
									onClick={onClose}
								>
									Discard edits and close
								</Button>
							</div>
						</AlertDescription>
					</Alert>
				)}
				{receipt.problem && (
					<Alert
						variant="default"
						role="status"
						className={cn(
							"border-warning-border bg-warning-bg p-4 text-warning-text",
						)}
					>
						<AlertDescription className="text-warning-text">
							<p>{receipt.problem.message}</p>
						</AlertDescription>
					</Alert>
				)}
				{readOnly && extracting && (
					<p role="status" className="text-sm text-muted">
						Extraction is in progress. This receipt will update when it
						finishes.
					</p>
				)}
				{receipt.status === "interrupted" && (
					<Alert
						variant="default"
						role="status"
						className={cn(
							"border-warning-border bg-warning-bg p-4 text-warning-text",
						)}
					>
						<AlertDescription className="text-warning-text">
							<p>
								The previous extraction was interrupted. Retry extraction or
								enter the details manually.
							</p>
						</AlertDescription>
					</Alert>
				)}
				{(conflict || mutationError) && (
					<Alert variant="destructive">
						<AlertDescription className="min-w-0 break-words">
							<p className="my-1 whitespace-pre-line">
								{conflict
									? "This receipt changed during your edit."
									: mutationError}
							</p>
							<Button
								variant="link"
								className="mt-2 px-0 py-0.5 text-xs font-semibold"
								onClick={conflict ? () => setEdit(null) : reload}
							>
								{conflict ? "Discard edits" : "Reload receipt"}
							</Button>
						</AlertDescription>
					</Alert>
				)}
				<div className="grid gap-6 md:grid-cols-2">
					<ReceiptPreview
						id={receipt.id}
						digest={receipt.digest}
						filename={receipt.filename}
						actions={
							<ReceiptImageActions
								revision={receipt.revision}
								readOnly={readOnly}
								busy={busy}
								replacing={actions.replace.isPending}
								deleting={actions.remove.isPending}
								onReplace={async (image, revision) => {
									await actions.replace.mutateAsync({
										id: receipt.id,
										revision,
										image,
									});
									setEdit(null);
									setError(null);
									setAskDiscard(false);
									actions.extract.reset();
									actions.review.reset();
								}}
								onDelete={async () => {
									await actions.remove.mutateAsync(receipt.id);
									onClose();
								}}
							/>
						}
					/>
					<div className="flex min-w-0 flex-col gap-5">
						{!readOnly && (
							<ReceiptExtractionAction
								available={extractionAvailable}
								pending={actions.extract.isPending || extracting}
								complete={
									receipt.status === "ready" && Boolean(receipt.extraction)
								}
								disabled={busy || dirty}
								onExtract={() => {
									setError(null);
									actions.extract.mutate(receipt.id);
								}}
							/>
						)}
						{payload.diagnostics?.length ||
						receipt.extraction?.diagnostics?.length ? (
							<Alert
								variant="default"
								className={cn(
									"border-warning-border bg-warning-bg p-4 text-warning-text",
								)}
							>
								<AlertDescription className="text-warning-text">
									<ul className="list-disc space-y-2 pl-4 text-sm">
										{[
											...(payload.diagnostics ?? []),
											...(receipt.extraction?.diagnostics ?? []),
										].map((message, index) => (
											<li key={index}>{message}</li>
										))}
									</ul>
								</AlertDescription>
							</Alert>
						) : null}
						<form
							onSubmit={(event) => void save(event)}
							className="flex flex-col gap-5"
						>
							<fieldset
								disabled={readOnly || busy}
								className="grid min-w-0 gap-3 sm:grid-cols-2"
							>
								<legend className="mb-3 text-sm font-semibold">
									Receipt details
								</legend>
								<ReceiptField
									id={`${fieldPrefix}-merchant`}
									label="Merchant"
									className="sm:col-span-2"
								>
									{(id) => (
										<Input
											id={id}
											name="merchant"
											value={draft.merchant}
											maxLength={200}
											required
											onChange={(event) =>
												update({ merchant: event.target.value })
											}
											className={fieldInputClassName}
										/>
									)}
								</ReceiptField>
								<ReceiptField id={`${fieldPrefix}-date`} label="Receipt date">
									{(id) => (
										<Input
											id={id}
											name="date"
											type="date"
											value={draft.date}
											required
											onChange={(event) => update({ date: event.target.value })}
											className={fieldInputClassName}
										/>
									)}
								</ReceiptField>
								<ReceiptField id={`${fieldPrefix}-currency`} label="Currency">
									{(id) => (
										<select
											id={id}
											name="currency"
											value={draft.currency}
											required
											onChange={(event) =>
												update({ currency: event.target.value })
											}
											className={fieldSelectClassName}
										>
											<option value="">Unknown — verify</option>
											<option value="USD">USD</option>
										</select>
									)}
								</ReceiptField>
								<ReceiptField id={`${fieldPrefix}-total`} label="Total (USD)">
									{(id) => (
										<Input
											id={id}
											name="total"
											inputMode="decimal"
											value={draft.total}
											required
											onChange={(event) =>
												update({ total: event.target.value })
											}
											className={fieldInputClassName}
										/>
									)}
								</ReceiptField>
								<ReceiptField
									id={`${fieldPrefix}-subtotal`}
									label="Subtotal (USD)"
								>
									{(id) => (
										<Input
											id={id}
											name="subtotal"
											inputMode="decimal"
											value={draft.subtotal}
											onChange={(event) =>
												update({ subtotal: event.target.value })
											}
											className={fieldInputClassName}
										/>
									)}
								</ReceiptField>
								<ReceiptField id={`${fieldPrefix}-tax`} label="Tax (USD)">
									{(id) => (
										<Input
											id={id}
											name="tax"
											inputMode="decimal"
											value={draft.tax}
											onChange={(event) => update({ tax: event.target.value })}
											className={fieldInputClassName}
										/>
									)}
								</ReceiptField>
								<ReceiptField id={`${fieldPrefix}-tip`} label="Tip (USD)">
									{(id) => (
										<Input
											id={id}
											name="tip"
											inputMode="decimal"
											value={draft.tip}
											onChange={(event) => update({ tip: event.target.value })}
											className={fieldInputClassName}
										/>
									)}
								</ReceiptField>
								<ReceiptField
									id={`${fieldPrefix}-discount`}
									label="Discount (USD)"
								>
									{(id) => (
										<Input
											id={id}
											name="discount"
											inputMode="decimal"
											value={draft.discount}
											onChange={(event) =>
												update({ discount: event.target.value })
											}
											className={fieldInputClassName}
										/>
									)}
								</ReceiptField>
							</fieldset>
							<ReceiptItems
								items={draft.items}
								disabled={readOnly || busy}
								onChange={(items) => update({ items })}
							/>
							{!readOnly && (
								<div className="flex flex-wrap gap-2 border-t border-line pt-4">
									<Button
										type="submit"
										name="action"
										value="confirm"
										variant="secondary"
										className={secondaryButtonClassName}
										disabled={busy || conflict}
									>
										Confirm receipt
									</Button>
									<Button
										type="submit"
										name="action"
										value="draft"
										variant="secondary"
										className={secondaryButtonClassName}
										formNoValidate
										disabled={busy || conflict}
									>
										Save draft
									</Button>
									{dirty && (
										<Button
											variant="secondary"
											className={secondaryButtonClassName}
											disabled={busy}
											onClick={() => {
												setEdit(null);
												setError(null);
											}}
										>
											Discard edits
										</Button>
									)}
								</div>
							)}
						</form>
						{receipt.extraction && (
							<ReceiptExtractionEvidence extraction={receipt.extraction} />
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
