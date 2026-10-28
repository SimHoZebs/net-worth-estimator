import { expect, it } from "vitest";
import {
	emptyReceiptItem,
	parseReceiptMoney,
	receiptDetails,
	receiptDraft,
	receiptMoney,
	receiptReviewLabel,
} from "./receipt.ts";

it("converts exact decimal USD values without rounding arbitrary input", () => {
	expect(parseReceiptMoney("12.34")).toBe(1234);
	expect(parseReceiptMoney("0.29")).toBe(29);
	expect(parseReceiptMoney("2.5")).toBe(250);
	expect(parseReceiptMoney("  ")).toBeNull();
	for (const input of [
		"-1",
		"NaN",
		"Infinity",
		"1e2",
		"1.234",
		"0.009",
		"10000000000.01",
	]) {
		expect(() => parseReceiptMoney(input)).toThrow(/decimal places|too large/);
	}
	expect(receiptMoney(null)).toBe("");
	expect(receiptMoney(1234)).toBe("12.34");
});

it("labels saved corrections as drafts until those values are confirmed", () => {
	const confirmed = receiptDetails(receiptDraft());
	expect(receiptReviewLabel({})).toBe("Needs review");
	expect(receiptReviewLabel({ draft: confirmed })).toBe("Draft saved");
	expect(receiptReviewLabel({ confirmed })).toBe("Reviewed");
	const { items, ...fields } = confirmed;
	const reordered = { items, ...fields };
	expect(receiptReviewLabel({ confirmed, draft: reordered })).toBe("Reviewed");
	expect(
		receiptReviewLabel({
			confirmed,
			draft: { ...confirmed, merchant: "New draft" },
		}),
	).toBe("Draft saved");
});

it("preserves unknown values and fractional item quantities", () => {
	const draft = receiptDraft();
	draft.merchant = " Sample Market ";
	draft.total = "12.34";
	draft.items = [
		{
			...emptyReceiptItem(),
			description: "Apples",
			quantity: "1.5",
			total: "3.75",
		},
	];
	const details = receiptDetails(draft);
	expect(details.merchant).toBe("Sample Market");
	expect(details.items?.[0]?.quantity).toBe(1.5);
	expect(details.taxCents).toBeNull();
	expect(receiptDraft(details).items[0]?.quantity).toBe("1.5");
	draft.items[0]!.quantity = "zero";
	expect(() => receiptDetails(draft)).toThrow(/quantities/);
});
