import { describe, expect, it } from "vitest";
import { transactionCycleLabel } from "./safeSpendingLabels.ts";

describe("safe spending transaction count label", () => {
	it("keeps the action available without inventing a count", () => {
		expect(transactionCycleLabel()).toBe("Transactions this cycle");
	});

	it.each([
		[0, "0 transactions this cycle"],
		[1, "1 transaction this cycle"],
		[2, "2 transactions this cycle"],
	])("labels %i visible rows exactly", (count, label) => {
		expect(transactionCycleLabel(count)).toBe(label);
	});
});
