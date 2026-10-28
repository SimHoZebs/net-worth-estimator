import type { ReceiptExtraction } from "@/api/generated/model/index.ts";
import { receiptMoney } from "@/domain/receipt.ts";

export function ReceiptExtractionEvidence({
	extraction,
}: {
	extraction: ReceiptExtraction;
}) {
	const { details, confidence } = extraction;
	return (
		<details className="rounded-surface border border-line p-4">
			<summary className="cursor-pointer text-sm font-semibold">
				Original extracted values
			</summary>
			<div className="mt-3 flex flex-col gap-3 text-sm">
				{confidence !== null && (
					<p className="text-xs text-muted">
						Source confidence: {Math.round(confidence * 100)}%. This is not
						independent bank verification.
					</p>
				)}
				<dl className="grid grid-cols-2 gap-2">
					<dt className="text-muted">Merchant</dt>
					<dd className="break-words">{details.merchant || "Unknown"}</dd>
					<dt className="text-muted">Date</dt>
					<dd>{details.date || "Unknown"}</dd>
					<dt className="text-muted">Total</dt>
					<dd>
						{details.totalCents === null
							? "Unknown"
							: `${details.currency || "Unknown currency"} ${receiptMoney(details.totalCents)}`}
					</dd>
				</dl>
				{(details.items?.length ?? 0) > 0 && (
					<ul className="list-disc space-y-1 pl-4">
						{details.items?.map((item, index) => (
							<li key={index}>
								{item.description}
								{item.totalCents !== null
									? ` — USD ${receiptMoney(item.totalCents)}`
									: " — amount unknown"}
							</li>
						))}
					</ul>
				)}
			</div>
		</details>
	);
}
