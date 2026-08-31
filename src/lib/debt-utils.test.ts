import { describe, expect, it } from "vitest";
import { createBaseDocument, makePosting } from "@/lib/projection/__fixtures__";
import { indexPaymentPostingsByAccountId } from "./debt-utils";

describe("indexPaymentPostingsByAccountId", () => {
	it("indexes the first enabled payment posting for each destination", () => {
		const first = makePosting({
			id: "first-payment",
			label: "Loan payment",
			destinations: ["loan", "interest"],
		});
		const later = makePosting({
			id: "later-payment",
			label: "Extra pay",
			destinations: ["loan"],
		});
		const disabled = makePosting({
			id: "disabled-payment",
			label: "Disabled payment",
			destinations: ["other"],
			enabled: false,
		});
		const document = createBaseDocument({
			postings: [first, later, disabled],
		});

		const index = indexPaymentPostingsByAccountId(document);

		expect(index.get("loan")).toBe(first);
		expect(index.get("interest")).toBe(first);
		expect(index.has("other")).toBe(false);
	});
});
