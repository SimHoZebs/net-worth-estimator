import { describe, expect, it } from "vitest";
import { testPlan } from "../test/plan.ts";
import { movementFixture } from "../test/projection.ts";
import {
	cashCushion,
	checkingAccountId,
	cycleAllowance,
	cycleBudget,
	monthEndIso,
	nextMonthObligations,
	nextMonthRange,
	nextPaycheck,
	remainingMonthlyObligations,
} from "./householdTiming.ts";

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

describe("checking", () => {
	it("prefers the checking account id", () => {
		expect(checkingAccountId(testPlan)).toBe("checking");
	});
});

describe("cashCushion", () => {
	it("subtracts remaining obligations from checking", () => {
		expect(cashCushion({ checking: 5000, remainingObligations: 3200 })).toBe(
			1800,
		);
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

	it("matches budget minus spent", () => {
		const budget = cycleBudget({
			paycheck: 7579,
			fixedObligations: 5000,
			reserve: 725,
		});
		expect(budget - 1200).toBe(
			cycleAllowance({
				paycheck: 7579,
				fixedObligations: 5000,
				spent: 1200,
				reserve: 725,
			}),
		);
	});
});

describe("projection-derived timing", () => {
	const movements = [
		movementFixture({
			date: "2026-10-10",
			movementId: "housing",
			name: "Housing",
			fromId: "checking",
			toId: null,
			requested: 3200,
			realized: 3200,
		}),
		movementFixture({
			date: "2026-10-20",
			movementId: "living",
			name: "Living",
			fromId: "checking",
			toId: null,
			requested: 1000,
			realized: 1000,
		}),
		movementFixture({
			date: "2026-11-01",
			movementId: "housing",
			name: "Housing",
			fromId: "checking",
			toId: null,
			requested: 3200,
			realized: 3200,
		}),
		movementFixture({
			date: "2026-10-15",
			movementId: "pay",
			name: "Pay",
			fromId: null,
			toId: "checking",
			requested: 7579,
			realized: 7579,
		}),
	];

	it("sums remaining obligations through month end", () => {
		expect(
			remainingMonthlyObligations({
				movements,
				checkingId: "checking",
				todayIso: "2026-10-08",
			}),
		).toEqual({ total: 4200, monthEnd: "2026-10-31" });
	});

	it("sums next month obligations", () => {
		expect(
			nextMonthObligations({
				movements,
				checkingId: "checking",
				todayIso: "2026-10-08",
			}),
		).toEqual({ total: 3200, start: "2026-11-01", end: "2026-11-30" });
	});

	it("finds the next paycheck after today", () => {
		expect(
			nextPaycheck({
				movements,
				checkingId: "checking",
				todayIso: "2026-10-08",
			}),
		).toEqual({ date: "2026-10-15", amount: 7579 });
	});

	it("returns null when no paycheck is projected", () => {
		expect(
			nextPaycheck({
				movements: movements.filter((item) => item.fromId === "checking"),
				checkingId: "checking",
				todayIso: "2026-10-08",
			}),
		).toBeNull();
	});
});
