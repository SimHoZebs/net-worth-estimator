import { describe, expect, it } from "vitest";
import { testAccount } from "../mocks/account.ts";
import { movementFixture, projectionFixture } from "../mocks/projection.ts";
import { deriveFundingGaps, summarizeFundingGap } from "./fundingGaps.ts";

describe("derive funding gaps", () => {
	it("keeps evidence within the configured transaction selection", () => {
		const projection = projectionFixture({
			movements: [movementFixture(), movementFixture({ movementId: "other" })],
		});
		expect(
			deriveFundingGaps({ plan: testAccount, projection, postingIds: [] }),
		).toEqual([]);
		const gaps = deriveFundingGaps({
			plan: testAccount,
			projection,
			postingIds: ["other"],
		});
		expect(gaps.map((gap) => gap.id)).toEqual(["other-2026-03-06"]);
		expect(
			deriveFundingGaps({ plan: testAccount, projection, postingIds: null }),
		).toHaveLength(2);
	});

	it("opens the window before the failure month without double-counting", () => {
		const plan = {
			...testAccount,
			startDate: "2026-01-31",
			accounts: testAccount.accounts.map((account) =>
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

	it("uses fulfillment amounts instead of the reconstructed account balance", () => {
		const projection = projectionFixture({ movements: [movementFixture()] });
		const [gap] = deriveFundingGaps({ plan: testAccount, projection });
		expect(gap).toBeDefined();
		const summary = summarizeFundingGap(gap!);
		expect(summary.available).toBe(6350);
		expect(summary.shortfall).toBe(2650);
		expect(summary.coveredAmount).toBe(6350);
		// The explanatory ledger has a different balance; it cannot hide or
		// change the backend's funding assessment (for example, a source floor).
		expect(gap!.openingBalance).not.toBe(summary.available);
	});

	it.each([
		{
			name: "destination ceiling",
			fulfillment: { unfulfilledAmount: 0, destinationLimitedAmount: 2650 },
		},
		{
			name: "nonreportable residual",
			fulfillment: { unfulfilledAmount: 0, destinationLimitedAmount: 0 },
		},
		{ name: "missing assessment", fulfillment: undefined },
	])("does not invent a funding gap for $name", ({ fulfillment }) => {
		const projection = projectionFixture({
			movements: [movementFixture({ fulfillment })],
		});
		expect(deriveFundingGaps({ plan: testAccount, projection })).toEqual([]);
	});

	it("retains a reportable gap when requested and realized public amounts match", () => {
		const projection = projectionFixture({
			movements: [
				movementFixture({
					requested: 100,
					realized: 100,
					available: 100,
					fulfillment: { unfulfilledAmount: 1, destinationLimitedAmount: 0 },
				}),
			],
		});
		const gaps = deriveFundingGaps({ plan: testAccount, projection });
		expect(gaps).toHaveLength(1);
		expect(summarizeFundingGap(gaps[0]!).shortfall).toBe(1);
	});

	it("does not hide annual-limit shortfalls when the account has enough cash", () => {
		const projection = projectionFixture({
			movements: [
				movementFixture({
					constraintTypes: ["action-limit"],
					available: 500,
					requested: 1000,
					realized: 500,
				}),
			],
		});
		const gaps = deriveFundingGaps({ plan: testAccount, projection });
		expect(gaps).toHaveLength(1);
		expect(summarizeFundingGap(gaps[0]!).shortfall).toBe(500);
	});

	it("excludes later same-day deposits from the explanatory ledger", () => {
		const date = "2026-03-06";
		const projection = projectionFixture({
			movements: [
				movementFixture({
					date,
					movementId: "prior-income",
					fromId: null,
					toId: "checking",
					requested: 500,
					realized: 500,
					accountDeltas: [{ accountId: "checking", delta: 500 }],
				}),
				movementFixture({ date }),
				movementFixture({
					date,
					movementId: "later-income",
					fromId: null,
					toId: "checking",
					requested: 10000,
					realized: 10000,
					accountDeltas: [{ accountId: "checking", delta: 10000 }],
				}),
			],
		});
		const gaps = deriveFundingGaps({
			plan: { ...testAccount, startDate: "2026-01-31" },
			projection,
		});
		expect(gaps).toHaveLength(1);
		expect(gaps[0]?.movements.map((movement) => movement.amount)).toEqual([
			500,
		]);
		expect(summarizeFundingGap(gaps[0]!).shortfall).toBe(2650);
	});
});
