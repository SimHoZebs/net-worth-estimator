import { describe, expect, it } from "vitest";
import { transactionFixture } from "../mocks/projection.ts";
import {
	groupMandatorySpending,
	monthEndIso,
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
