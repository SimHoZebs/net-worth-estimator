import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { ReceiptOutputBody } from "@/api/generated/model/index.ts";
import {
	receiptDetails,
	receiptDraft,
	type ReceiptDraft,
} from "@/domain/receipt.ts";
import { useBeforeUnload } from "@/state/useBeforeUnload.ts";
import { useReceipt, useReceiptActions } from "@/state/receipts.ts";
import { Button } from "../Button.tsx";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { InputField, SelectField } from "../Field.tsx";
import { Modal } from "../Modal.tsx";
import { Notice } from "../Notice.tsx";
import { ReceiptItems } from "./ReceiptItems.tsx";
import { ReceiptPreview } from "./ReceiptPreview.tsx";
import { ReceiptExtractionEvidence } from "./ReceiptExtractionEvidence.tsx";
import { ReceiptExtractionAction } from "./ReceiptExtractionAction.tsx";
import { ReceiptImageActions } from "./ReceiptImageActions.tsx";

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
			<Modal title="Receipt details" titleSize="plain" wide onClose={onClose}>
				{query.error ? (
					<ErrorNotice
						message={query.error.message}
						action="Retry receipt"
						onAction={() => void query.refetch()}
					/>
				) : (
					<p role="status" className="text-sm text-muted">
						Loading private receipt…
					</p>
				)}
			</Modal>
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
	const actions = useReceiptActions(receipt.postingId);
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
		<Modal
			title="Receipt details"
			titleSize="plain"
			wide
			onClose={onClose}
			onCloseRequest={() => {
				if (busy) return false;
				if (dirty) {
					setAskDiscard(true);
					return false;
				}
				return true;
			}}
		>
			{askDiscard && (
				<Notice tone="warning" className="flex-col gap-3 p-4">
					<p>Discard unsaved receipt edits?</p>
					<div className="flex flex-wrap gap-2">
						<Button variant="secondary" onClick={() => setAskDiscard(false)}>
							Continue editing
						</Button>
						<Button variant="danger" onClick={onClose}>
							Discard edits and close
						</Button>
					</div>
				</Notice>
			)}
			{mutationError && (
				<ErrorNotice
					message={mutationError}
					action="Reload receipt"
					onAction={reload}
				/>
			)}
			{receipt.problem && (
				<Notice tone="warning" className="p-4" role="status">
					<p>{receipt.problem.message}</p>
				</Notice>
			)}
			{readOnly && extracting && (
				<p role="status" className="text-sm text-muted">
					Extraction is in progress. This receipt will update when it finishes.
				</p>
			)}
			{receipt.status === "interrupted" && (
				<Notice tone="warning" className="p-4" role="status">
					<p>
						The previous extraction was interrupted. Retry extraction or enter
						the details manually.
					</p>
				</Notice>
			)}
			{conflict && (
				<ErrorNotice
					message="This receipt changed during your edit. Discard your edits before you use the latest saved details."
					action="Discard edits"
					onAction={() => setEdit(null)}
				/>
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
						<Notice tone="warning" className="p-4">
							<ul className="list-disc space-y-2 pl-4 text-sm">
								{[
									...(payload.diagnostics ?? []),
									...(receipt.extraction?.diagnostics ?? []),
								].map((message, index) => (
									<li key={index}>{message}</li>
								))}
							</ul>
						</Notice>
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
							<InputField
								label="Merchant"
								name="merchant"
								value={draft.merchant}
								maxLength={200}
								required
								containerClassName="sm:col-span-2"
								onChange={(event) => update({ merchant: event.target.value })}
							/>
							<InputField
								label="Receipt date"
								name="date"
								type="date"
								value={draft.date}
								required
								onChange={(event) => update({ date: event.target.value })}
							/>
							<SelectField
								label="Currency"
								name="currency"
								value={draft.currency}
								required
								onChange={(event) => update({ currency: event.target.value })}
							>
								<option value="">Unknown — verify</option>
								<option value="USD">USD</option>
							</SelectField>
							<InputField
								label="Total (USD)"
								name="total"
								inputMode="decimal"
								value={draft.total}
								required
								onChange={(event) => update({ total: event.target.value })}
							/>
							<InputField
								label="Subtotal (USD)"
								name="subtotal"
								inputMode="decimal"
								value={draft.subtotal}
								onChange={(event) => update({ subtotal: event.target.value })}
							/>
							<InputField
								label="Tax (USD)"
								name="tax"
								inputMode="decimal"
								value={draft.tax}
								onChange={(event) => update({ tax: event.target.value })}
							/>
							<InputField
								label="Tip (USD)"
								name="tip"
								inputMode="decimal"
								value={draft.tip}
								onChange={(event) => update({ tip: event.target.value })}
							/>
							<InputField
								label="Discount (USD)"
								name="discount"
								inputMode="decimal"
								value={draft.discount}
								onChange={(event) => update({ discount: event.target.value })}
							/>
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
									disabled={busy || conflict}
								>
									Confirm receipt
								</Button>
								<Button
									type="submit"
									name="action"
									value="draft"
									variant="secondary"
									formNoValidate
									disabled={busy || conflict}
								>
									Save draft
								</Button>
								{dirty && (
									<Button
										variant="secondary"
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
					{actions.review.isSuccess && !dirty && (
						<p className="text-sm text-success-text" role="status">
							Receipt details saved.
						</p>
					)}
				</div>
			</div>
		</Modal>
	);
}
