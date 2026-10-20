import { describe, expect, it } from "vitest";
import { testPlan } from "../test/plan.ts";
import { movementFixture, projectionFixture } from "../test/projection.ts";
import { deriveFundingGaps, summarizeFundingGap } from "./fundingGaps.ts";

describe("derive funding gaps", () => {
	it("opens the window before the failure month without double-counting", () => {
		const plan = {
			...testPlan,
			startDate: "2026-01-31",
			accounts: testPlan.accounts.map((account) =>
				account.id === "checking" ? { ...account, balance: 4200 } : account,
			),
		};
		const projection = projectionFixture({
			points: [
				{ date: "2026-02-20", total: 0, balances: { checking: 4550 } },
				{ date: "2026-03-01", total: 0, balances: { checking: 10150 } },
				{ date: "2026-03-05", total: 0, balances: { checking: 6350 } },
				{ date: "2026-03-06", total: 0, balances: { checking: 6350 } },
			],
			movements: [
				movementFixture({
					date: "2026-03-01",
					movementId: "salary",
					name: "Salary",
					requested: 5600,
					realized: 5600,
					fromId: null,
					toId: "checking",
					available: 10150,
					constraint: null,
					accountDeltas: [{ accountId: "checking", delta: 5600 }],
				}),
				movementFixture({
					date: "2026-03-05",
					movementId: "spend",
					name: "Housing and living",
					requested: 3800,
					realized: 3800,
					fromId: "checking",
					toId: null,
					available: 6350,
					constraint: null,
					accountDeltas: [{ accountId: "checking", delta: -3800 }],
				}),
				movementFixture({
					date: "2026-03-06",
					movementId: "renovation",
					name: "Home renovation",
					requested: 9000,
					realized: 6350,
					fromId: "checking",
					toId: null,
					available: 6350,
					constraint: "Protected account balance",
					accountDeltas: [{ accountId: "checking", delta: -6350 }],
				}),
			],
		});
		const gaps = deriveFundingGaps({ plan, projection });
		expect(gaps).toHaveLength(1);
		expect(gaps[0]?.openingBalance).toBe(4550);
		// The card filters on the recomputed summary: it must agree with the
		// simulation instead of replaying the window's salary twice.
		const summary = summarizeFundingGap(gaps[0]!);
		expect(summary.available).toBe(6350);
		expect(summary.shortfall).toBe(2650);
	});
});
