import { expect, it } from "vitest";
import { balanceAdjustmentActivity } from "./balanceAdjustmentActivity.ts";
import {
	defaultAccountViewFilters,
	filterTransactions,
} from "./accountActivity.ts";

it("sorts same-day balance adjustments by their exact instant in both date orders", () => {
	const early = Date.UTC(2026, 2, 10, 9) / 1000;
	const late = Date.UTC(2026, 2, 10, 15) / 1000;
	const rows = balanceAdjustmentActivity(
		[late, early].map((observedAt) => ({
			accountId: "checking",
			observedAt,
			balance: 120,
			previousBalance: 100,
			adjustment: 20,
			source: "user",
		})),
	);
	expect(rows.map((row) => row.date)).toEqual(["2026-03-10", "2026-03-10"]);
	for (const order of ["newest", "oldest"] as const) {
		const sorted = filterTransactions({
			transactions: rows,
			filters: { ...defaultAccountViewFilters, order },
			startDate: "2026-03-10",
		});
		expect(sorted.map((row) => row.adjustment?.observedAt)).toEqual(
			order === "newest" ? [late, early] : [early, late],
		);
	}
});
