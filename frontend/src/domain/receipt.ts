import type {
	Receipt,
	ReceiptDetails,
	ReceiptItem,
} from "@/api/generated/model/index.ts";

export function receiptReviewLabel(
	receipt: Pick<Receipt, "draft" | "confirmed">,
): string {
	if (
		receipt.draft &&
		(!receipt.confirmed ||
			JSON.stringify(receiptDraft(receipt.draft)) !==
				JSON.stringify(receiptDraft(receipt.confirmed)))
	) {
		return "Draft saved";
	}
	return receipt.confirmed ? "Reviewed" : "Needs review";
}

export type ReceiptItemDraft = Record<
	"description" | "quantity" | "unitPrice" | "total" | "category",
	string
>;
export type ReceiptDraft = {
	merchant: string;
	date: string;
	currency: string;
	total: string;
	subtotal: string;
	tax: string;
	tip: string;
	discount: string;
	items: ReceiptItemDraft[];
};

export function receiptMoney(value: number | null | undefined) {
	return value == null ? "" : (value / 100).toFixed(2);
}

/** Parse decimal cents without rounding a binary floating-point dollar value. */
export function parseReceiptMoney(value: string): number | null {
	if (!value.trim()) return null;
	if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim()))
		throw new Error("Enter amounts with at most two decimal places.");
	const [dollars, cents = ""] = value.trim().split(".");
	const result = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
	if (!Number.isSafeInteger(result) || result > 1_000_000_000_000)
		throw new Error("The receipt amount is too large.");
	return result;
}

export const emptyReceiptItem = (): ReceiptItemDraft => ({
	description: "",
	quantity: "",
	unitPrice: "",
	total: "",
	category: "",
});

export function receiptDraft(details?: ReceiptDetails): ReceiptDraft {
	return {
		merchant: details?.merchant ?? "",
		date: details?.date ?? "",
		currency: details?.currency ?? "USD",
		total: receiptMoney(details?.totalCents),
		subtotal: receiptMoney(details?.subtotalCents),
		tax: receiptMoney(details?.taxCents),
		tip: receiptMoney(details?.tipCents),
		discount: receiptMoney(details?.discountCents),
		items: (details?.items ?? []).map((item) => ({
			description: item.description,
			quantity: item.quantity == null ? "" : String(item.quantity),
			unitPrice: receiptMoney(item.unitPriceCents),
			total: receiptMoney(item.totalCents),
			category: item.category,
		})),
	};
}

export function receiptDetails(draft: ReceiptDraft): ReceiptDetails {
	const items: ReceiptItem[] = draft.items.map((item) => {
		const quantity = item.quantity.trim() ? Number(item.quantity) : null;
		if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0))
			throw new Error("Item quantities must be positive numbers.");
		return {
			description: item.description.trim(),
			category: item.category.trim(),
			quantity,
			unitPriceCents: parseReceiptMoney(item.unitPrice),
			totalCents: parseReceiptMoney(item.total),
		};
	});
	return {
		merchant: draft.merchant.trim(),
		date: draft.date,
		currency: draft.currency,
		totalCents: parseReceiptMoney(draft.total),
		subtotalCents: parseReceiptMoney(draft.subtotal),
		taxCents: parseReceiptMoney(draft.tax),
		tipCents: parseReceiptMoney(draft.tip),
		discountCents: parseReceiptMoney(draft.discount),
		items,
	};
}
