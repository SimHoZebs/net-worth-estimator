import { describe, expect, it } from "vitest";
import type { AccountTransaction } from "./accountActivity.ts";
import { safeSpendingTrend } from "./safeSpendingTrend.ts";

function charge(
	date: string,
	amount: number,
	overrides: Partial<AccountTransaction> = {},
): AccountTransaction {
	return {
		id: `charge-${date}-${amount}`,
		transactionId: `charge-${date}-${amount}`,
		date,
		name: "Card purchase",
		source: "historical",
		direction: "out",
		flow: "expense",
		counterparty: "External spending",
		from: "Household card",
		to: "External spending",
		amount,
		requested: amount,
		shortfall: 0,
		constraint: null,
		excluded: false,
		pending: false,
		void: false,
		...overrides,
	};
}

describe("safeSpendingTrend", () => {
	it("builds daily cumulative rows and marks actual threshold crossings", () => {
		const trend = safeSpendingTrend({
			transactions: [
				charge("2026-01-21", 100),
				charge("2026-01-23", 250),
				charge("2026-01-25", 400),
			],
			cycleStart: "2026-01-20",
			cycleEnd: "2026-02-19",
			todayIso: "2026-01-25",
			limit: 500,
			safetyNet: 300,
		});
		expect(trend.actual.map((point) => [point.date, point.spent])).toEqual([
			["2026-01-20", 0],
			["2026-01-21", 100],
			["2026-01-22", 100],
			["2026-01-23", 350],
			["2026-01-24", 350],
			["2026-01-25", 750],
		]);
		expect(trend.safetyNetHit).toEqual({
			date: "2026-01-23",
			amount: 350,
			projected: false,
		});
		expect(trend.limitHit).toEqual({
			date: "2026-01-25",
			amount: 750,
			projected: false,
		});
		expect(trend.averageDaily).toBe(125);
		expect(trend.projected[0]).toEqual({
			date: "2026-01-25",
			spent: 750,
			projected: true,
		});
		expect(trend.projected.at(-1)?.date).toBe("2026-02-19");
	});

	it("projects the first limit hit from the average daily rate", () => {
		const trend = safeSpendingTrend({
			transactions: [charge("2026-01-21", 100)],
			cycleStart: "2026-01-20",
			cycleEnd: "2026-02-19",
			todayIso: "2026-01-21",
			limit: 400,
			safetyNet: 300,
		});
		expect(trend.limitHit).toEqual({
			date: "2026-01-28",
			amount: 450,
			projected: true,
		});
		expect(trend.safetyNetHit).toEqual({
			date: "2026-01-26",
			amount: 350,
			projected: true,
		});
	});

	it("does not project without a positive average rate", () => {
		const trend = safeSpendingTrend({
			transactions: [],
			cycleStart: "2026-01-20",
			cycleEnd: "2026-02-19",
			todayIso: "2026-01-25",
			limit: 400,
			safetyNet: 300,
		});
		expect(trend.actual).toHaveLength(6);
		expect(trend.actual.every((point) => point.spent === 0)).toBe(true);
		expect(trend.projected).toEqual([]);
		expect(trend.averageDaily).toBe(0);
		expect(trend.limitHit).toBeNull();
		expect(trend.safetyNetHit).toBeNull();
	});

	it("ignores excluded, void, and out-of-window rows", () => {
		const trend = safeSpendingTrend({
			transactions: [
				charge("2026-01-19", 999),
				charge("2026-01-21", 100, { excluded: true }),
				charge("2026-01-22", 999, { void: true }),
				charge("2026-01-23", 50),
				charge("2026-01-26", 999),
				charge("2026-01-24", 100, { direction: "in" }),
			],
			cycleStart: "2026-01-20",
			cycleEnd: "2026-02-19",
			todayIso: "2026-01-25",
			limit: 400,
			safetyNet: 300,
		});
		expect(trend.actual.at(-1)?.spent).toBe(50);
	});

	it("counts pending charges but not future rows", () => {
		const trend = safeSpendingTrend({
			transactions: [
				charge("2026-01-21", 100, { pending: true, excluded: true }),
				charge("2026-02-01", 999),
			],
			cycleStart: "2026-01-20",
			cycleEnd: "2026-02-19",
			todayIso: "2026-01-25",
			limit: 400,
			safetyNet: 300,
		});
		expect(trend.actual.at(-1)?.spent).toBe(100);
	});

	it("treats same-day charges as one cumulative step", () => {
		const trend = safeSpendingTrend({
			transactions: [
				charge("2026-01-22", 100),
				charge("2026-01-22", 250),
				charge("2026-01-22", 200),
			],
			cycleStart: "2026-01-20",
			cycleEnd: "2026-02-19",
			todayIso: "2026-01-25",
			limit: 10000,
			safetyNet: 300,
		});
		expect(trend.actual.find((point) => point.date === "2026-01-22")).toEqual({
			date: "2026-01-22",
			spent: 550,
			projected: false,
		});
		expect(trend.safetyNetHit?.date).toBe("2026-01-22");
		expect(trend.limitHit).toBeNull();
	});

	it("marks the first real charge when thresholds are already negative", () => {
		const trend = safeSpendingTrend({
			transactions: [charge("2026-01-23", 50)],
			cycleStart: "2026-01-20",
			cycleEnd: "2026-02-19",
			todayIso: "2026-01-25",
			limit: -100,
			safetyNet: -200,
		});
		expect(trend.limitHit).toEqual({
			date: "2026-01-23",
			amount: 50,
			projected: false,
		});
		expect(trend.safetyNetHit).toEqual({
			date: "2026-01-23",
			amount: 50,
			projected: false,
		});
	});

	it("clamps a today outside the cycle to the cycle edge", () => {
		const trend = safeSpendingTrend({
			transactions: [charge("2026-01-22", 50)],
			cycleStart: "2026-01-20",
			cycleEnd: "2026-01-24",
			todayIso: "2026-01-31",
			limit: 400,
			safetyNet: 300,
		});
		expect(trend.actual.at(-1)?.date).toBe("2026-01-24");
		expect(trend.projected).toEqual([]);
	});
});
