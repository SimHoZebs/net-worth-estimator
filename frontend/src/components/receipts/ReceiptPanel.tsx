import { Camera, ImageUp, Paperclip, ReceiptText } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { receiptReviewLabel } from "@/domain/receipt.ts";
import type { Transaction } from "@/domain/model.ts";
import { useServerStatus } from "@/state/workspaceResources.ts";
import { useReceiptActions, useReceipts } from "@/state/receipts.ts";
import { useUserScope } from "@/state/useUserScope.ts";
import { Badge } from "../Badge.tsx";
import { Button } from "../Button.tsx";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { ReceiptReviewDialog } from "./ReceiptReviewDialog.tsx";

export function ReceiptPanel({
	transactionId,
	transaction,
	readOnly,
}: {
	transactionId: string;
	transaction: Transaction;
	readOnly: boolean;
}) {
	const scope = useUserScope();
	const status = useServerStatus({ enabled: false });
	const collection = useReceipts(transactionId, true);
	const actions = useReceiptActions(transactionId);
	const camera = useRef<HTMLInputElement>(null);
	const upload = useRef<HTMLInputElement>(null);
	const [selection, setSelection] = useState<{
		scope: string;
		id: string;
	} | null>(null);
	const locked = readOnly || status.data?.readOnly !== false;
	const eligible = Boolean(
		(transaction.fromId || transaction.toId) &&
		!transaction.pending &&
		!transaction.void,
	);
	const attach = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file || locked) return;
		void actions.attach
			.mutateAsync(file)
			.then((result) => {
				if (result) setSelection({ scope: scope.key, id: result.receipt.id });
			})
			.catch(() => {});
	};
	const receipts = collection.data?.receipts ?? [];
	return (
		<section className="mt-4 flex flex-col gap-4" aria-label="Receipt evidence">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<ReceiptText size={17} aria-hidden="true" />
					<h3 className="text-sm font-semibold">Receipts</h3>
					{receipts.length > 0 && (
						<Badge tone="neutral">{receipts.length}</Badge>
					)}
				</div>
				{!locked && eligible && (
					<div className="flex items-center gap-2">
						<Button
							variant="secondary"
							size="sm"
							disabled={actions.attach.isPending}
							onClick={() => upload.current?.click()}
						>
							<ImageUp size={14} aria-hidden="true" />
							Upload receipt
						</Button>
						<input
							ref={upload}
							type="file"
							accept="image/jpeg,image/png"
							className="sr-only"
							tabIndex={-1}
							aria-label="Upload receipt image"
							aria-describedby="receipt-size-hint"
							onChange={attach}
						/>
						<Button
							variant="secondary"
							size="sm"
							disabled={actions.attach.isPending}
							onClick={() => camera.current?.click()}
						>
							<Camera size={14} aria-hidden="true" />
							Take photo
						</Button>
						<input
							ref={camera}
							type="file"
							accept="image/jpeg,image/png"
							capture="environment"
							className="sr-only"
							tabIndex={-1}
							aria-label="Take receipt photo"
							aria-describedby="receipt-size-hint"
							onChange={attach}
						/>
					</div>
				)}
			</div>
			<>
				{collection.isPending && (
					<p role="status" className="text-sm text-muted">
						Loading receipts…
					</p>
				)}
				<ErrorNotice
					message={collection.error?.message ?? actions.attach.error?.message}
					action={collection.error ? "Retry receipts" : undefined}
					onAction={() => void collection.refetch()}
				/>
				{receipts.map((receipt) => (
					<button
						key={receipt.id}
						type="button"
						className="flex w-full items-start gap-3 rounded-surface border border-line bg-surface-2 p-4 text-left hover:border-line-strong"
						onClick={() => setSelection({ scope: scope.key, id: receipt.id })}
					>
						<Paperclip
							size={16}
							aria-hidden="true"
							className="mt-1 flex-none text-muted"
						/>
						<span className="flex min-w-0 flex-1 flex-col gap-1">
							<span className="text-sm font-semibold break-words">
								{receipt.draft?.merchant ||
									receipt.confirmed?.merchant ||
									receipt.extraction?.details.merchant ||
									receipt.filename}
							</span>
							<span className="text-xs text-muted">
								{receiptReviewLabel(receipt)}
								{receipt.stale ? " · Transaction changed" : ""}
							</span>
						</span>
					</button>
				))}
				{!locked && eligible && (
					<p id="receipt-size-hint" className="text-xs text-muted">
						JPEG or PNG, up to 10 MiB. Large images must fit within 3 MiB after
						normalization.
					</p>
				)}
				{actions.attach.isPending && (
					<p role="status" className="text-sm text-muted">
						Saving private receipt…
					</p>
				)}
				{!eligible && receipts.length === 0 && (
					<p className="text-sm text-muted">
						Receipts attach to saved owner transactions, not pending or void
						bank rows.
					</p>
				)}
			</>
			{selection?.scope === scope.key && (
				<ReceiptReviewDialog
					key={`${scope.key}:${selection.id}`}
					id={selection.id}
					readOnly={locked}
					extractionAvailable={collection.data?.extractionAvailable ?? false}
					onClose={() => setSelection(null)}
				/>
			)}
		</section>
	);
}
