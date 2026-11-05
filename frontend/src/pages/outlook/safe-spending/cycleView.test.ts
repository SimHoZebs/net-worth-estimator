import { describe, expect, it } from "vitest";
import { financialModelFixture } from "@/mocks/financialModel.ts";
import { transactionFixture } from "@/mocks/projection.ts";
import { cycleView, historicalBudget } from "./cycleView.ts";

describe("historicalBudget", () => {
	it("uses paychecks received inside the closed cycle", () => {
		const results = [
			transactionFixture({
				date: "2026-09-30",
				transactionId: "salary",
				requested: 7000,
				posted: true,
			}),
			transactionFixture({
				date: "2026-10-15",
				transactionId: "partner",
				requested: 1000,
				posted: true,
			}),
			transactionFixture({
				date: "2026-09-10",
				transactionId: "salary",
				requested: 6500,
				posted: true,
			}),
			transactionFixture({
				date: "2026-11-29",
				transactionId: "salary",
				requested: 9000,
			}),
		];
		expect(
			historicalBudget({
				results,
				incomeScheduleIds: ["salary", "partner"],
				cycle: { start: "2026-09-20", end: "2026-10-19" },
				bills: 4000,
			}),
		).toBe(4000);
	});

	it("subtracts the closed cycle's bills", () => {
		expect(
			historicalBudget({
				results: [
					transactionFixture({
						date: "2026-09-30",
						transactionId: "salary",
						requested: 3000,
						posted: true,
					}),
				],
				incomeScheduleIds: ["salary"],
				cycle: { start: "2026-09-20", end: "2026-10-19" },
				bills: 4455.55,
			}),
		).toBeCloseTo(-1455.55, 2);
	});

	it("uses the historical budget for the closed trend", () => {
		const result = cycleView({
			cycle: { start: "2026-09-20", end: "2026-10-19" },
			referenceDay: "2026-10-19",
			checking: 100,
			spentSince: "2026-09-20",
			spentThrough: "2026-10-19",
			spendingIds: ["checking"],
			results: [
				transactionFixture({
					date: "2026-09-30",
					transactionId: "salary",
					requested: 7000,
					posted: true,
				}),
			],
			obligationResults: [],
			directResults: [],
			billResults: [
				transactionFixture({
					date: "2026-10-01",
					transactionId: "housing",
					name: "Housing",
					fromId: "checking",
					requested: 4000,
					realized: 4000,
				}),
			],
			billWindowStart: "2026-09-20",
			incomeScheduleIds: ["salary"],
			cardTransactions: [],
			cardSpent: 600,
			cardSpentByCard: [],
			funding: {
				paycheck: 0,
				date: null,
				endDate: null,
				fixedBills: 0,
			},
			reserve: 725,
			accounts: financialModelFixture.accounts,
			savedTransactions: financialModelFixture.transactions,
			transactionOrder: "newest",
			closedCycle: {
				start: "2026-08-20",
				end: "2026-09-19",
				total: 600,
				cards: [],
			},
			fullDaysLeft: 30,
			closed: true,
		});
		expect(result.trend.limit).toBe(3000);
		expect(result.trend.safetyNet).toBe(2275);
	});
});
