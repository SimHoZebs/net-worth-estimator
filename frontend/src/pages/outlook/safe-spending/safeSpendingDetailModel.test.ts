import { describe, expect, it } from "vitest";
import {
	activeCycleCaption,
	isSafeSpendingTransactionsTab,
	SAFE_SPENDING_DETAIL_TABS,
} from "./safeSpendingDetailModel.ts";

describe("safe spending detail model", () => {
	it("keeps Transactions first and Configure second without a ledger alias", () => {
		expect(SAFE_SPENDING_DETAIL_TABS).toEqual([
			{ id: "transactions", label: "Transactions", view: "transactions" },
			{ id: "configure", label: "Configure", view: "configure" },
		]);
		expect(isSafeSpendingTransactionsTab("transactions")).toBe(true);
		expect(isSafeSpendingTransactionsTab("configure")).toBe(false);
	});

	it("captions the server-owned active spending cycle", () => {
		expect(
			activeCycleCaption({
				start: "2028-01-31",
				end: "2028-02-29",
			}),
		).toBe("Jan 31, 2028 – Feb 29, 2028");
	});
});
