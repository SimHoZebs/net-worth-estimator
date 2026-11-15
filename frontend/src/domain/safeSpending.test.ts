import { describe, expect, it } from "vitest";
import { transactionFixture } from "../mocks/projection.ts";
import {
	cycleAllowance,
	groupMandatorySpending,
	monthEndIso,
	nextMonthObligations,
	nextMonthRange,
} from "./safeSpending.ts";

describe("month helpers", () => {
	it("finds the end of the current month", () => {
		expect(monthEndIso("2026-10-08")).toBe("2026-10-31");
		expect(monthEndIso("2026-02-10")).toBe("2026-02-28");
	});

	it("finds next month range", () => {
		expect(nextMonthRange("2026-10-08")).toEqual({
			start: "2026-11-01",
			end: "2026-11-30",
		});
		expect(nextMonthRange("2026-12-15")).toEqual({
			start: "2027-01-01",
			end: "2027-01-31",
		});
	});
});

describe("cycleAllowance", () => {
	it("subtracts fixed obligations, spent, and reserve from paycheck", () => {
		expect(
			cycleAllowance({
				paycheck: 7579,
				fixedObligations: 5000,
				spent: 1200,
				reserve: 725,
			}),
		).toBe(654);
	});

	it("matches allowance plus spent", () => {
		expect(
			cycleAllowance({
				paycheck: 7579,
				fixedObligations: 5000,
				spent: 1200,
				reserve: 725,
			}),
		).toBe(7579 - 5000 - 1200 - 725);
	});
});

describe("projection-derived safe spending", () => {
	const transactions = [
		transactionFixture({
			date: "2026-10-10",
			transactionId: "housing",
			name: "Housing",
			fromId: "checking",
			toId: null,
			requested: 3200,
			realized: 3200,
		}),
		transactionFixture({
			date: "2026-10-20",
			transactionId: "living",
			name: "Living",
			fromId: "checking",
			toId: null,
			requested: 1000,
			realized: 1000,
		}),
		transactionFixture({
			date: "2026-11-01",
			transactionId: "housing",
			name: "Housing",
			fromId: "checking",
			toId: null,
			requested: 3200,
			realized: 3200,
		}),
		transactionFixture({
			date: "2026-10-15",
			transactionId: "pay",
			name: "Pay",
			fromId: null,
			toId: "checking",
			requested: 7579,
			realized: 7579,
		}),
	];

	it("sums next month obligations", () => {
		expect(
			nextMonthObligations({
				transactions,
				checkingIds: ["checking"],
				todayIso: "2026-10-08",
			}),
		).toEqual({ total: 3200, start: "2026-11-01", end: "2026-11-30" });
	});
});

describe("groupMandatorySpending", () => {
	const transactions = [
		transactionFixture({
			date: "2026-10-10",
			transactionId: "housing",
			name: "Housing",
			fromId: "checking",
			toId: null,
			requested: 3200,
			realized: 3200,
		}),
		transactionFixture({
			date: "2026-10-20",
			transactionId: "living",
			name: "Living",
			fromId: "checking",
			toId: null,
			requested: 1000,
			realized: 1000,
		}),
		transactionFixture({
			date: "2026-10-25",
			transactionId: "living",
			name: "Living",
			fromId: "checking",
			toId: null,
			requested: 500,
			realized: 500,
		}),
		transactionFixture({
			date: "2026-11-01",
			transactionId: "housing",
			name: "Housing",
			fromId: "checking",
			toId: null,
			requested: 3200,
			realized: 3200,
		}),
	];

	it("groups a window by transaction with totals and dates", () => {
		const groups = groupMandatorySpending({
			transactions,
			checkingIds: ["checking"],
			start: "2026-10-09",
			end: "2026-10-31",
		});
		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({
			transactionId: "housing",
			total: 3200,
			count: 1,
		});
		expect(groups[1]).toMatchObject({
			transactionId: "living",
			total: 1500,
			count: 2,
			dates: ["2026-10-20", "2026-10-25"],
		});
	});

	it("excludes transactions outside the window", () => {
		const groups = groupMandatorySpending({
			transactions,
			checkingIds: ["checking"],
			start: "2026-11-01",
			end: "2026-11-30",
		});
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ transactionId: "housing", total: 3200 });
	});

	it("combines outflows from every selected account", () => {
		const groups = groupMandatorySpending({
			transactions: [
				...transactions,
				transactionFixture({
					date: "2026-10-12",
					transactionId: "savings-transfer",
					name: "Savings transfer",
					fromId: "savings",
					toId: null,
					requested: 400,
					realized: 400,
				}),
			],
			checkingIds: ["checking", "savings"],
			start: "2026-10-09",
			end: "2026-10-31",
		});
		expect(groups).toHaveLength(3);
		expect(groups.map((group) => group.transactionId).sort()).toEqual([
			"housing",
			"living",
			"savings-transfer",
		]);
	});
});
