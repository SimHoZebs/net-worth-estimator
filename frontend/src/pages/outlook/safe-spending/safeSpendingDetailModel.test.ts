import { describe, expect, it } from "vitest";
import {
	isSafeSpendingTransactionsTab,
	paymentPeriodCaption,
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

	it("captions the server-owned payment window", () => {
		expect(
			paymentPeriodCaption({
				start: "2026-10-31",
				end: "2026-11-30",
			}),
		).toBe("Oct 31, 2026 – Nov 30, 2026");
	});
});
