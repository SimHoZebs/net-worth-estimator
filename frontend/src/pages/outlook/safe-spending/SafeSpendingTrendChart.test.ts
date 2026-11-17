import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SafeSpendingTrend } from "@/domain/safeSpendingTrend.ts";
import {
	incomeRuleLine,
	paceLabel,
	recurringIncreaseDots,
	SafeSpendingTrendChart,
	spendingChartDomain,
} from "./SafeSpendingTrendChart.tsx";

describe("current spending pace after refunds", () => {
	const cleared: SafeSpendingTrend = {
		actual: [
			{ date: "2026-11-08", spent: 60, projected: false },
			{ date: "2026-11-09", spent: 10, projected: false },
		],
		projected: [],
		limit: 50,
		safetyNet: 30,
		averageDaily: 5,
		limitHit: {
			date: "2026-11-08",
			amount: 60,
			projected: false,
			transactionId: "purchase",
		},
		safetyNetHit: {
			date: "2026-11-08",
			amount: 60,
			projected: false,
			transactionId: "purchase",
		},
		scheduledIncreases: [],
	};
	it("pads negative net spending from a refund without clipping the recorded curve", () => {
		const refundOnly = {
			...cleared,
			actual: [{ date: "2026-11-09", spent: -100, projected: false }],
			limitHit: null,
			safetyNetHit: null,
		};
		expect(spendingChartDomain(refundOnly)).toEqual([-108, 54]);
		const [low] = spendingChartDomain({
			...refundOnly,
			projected: [{ date: "2026-11-10", spent: -120, projected: true }],
			limit: -200,
		});
		expect(low).toBe(-216);
	});
	it("keeps the baseline at zero for positive-only spending", () => {
		const [low, high] = spendingChartDomain(cleared);
		expect(low).toBe(0);
		expect(high).toBeCloseTo(64.8);
	});
	it("keeps historical crossing identities without showing cleared cash or reserve warnings", () => {
		expect(paceLabel(cleared, false)).toEqual({ text: null, tone: "normal" });
		expect(cleared.limitHit?.transactionId).toBe("purchase");
	});
	it("warns about a genuine future crossing after an earlier cleared crossing", () => {
		const trend = {
			...cleared,
			projected: [
				{ date: "2026-11-09", spent: 10, projected: true },
				{ date: "2026-11-19", spent: 60, projected: true },
			],
		};
		expect(paceLabel(trend, false)).toEqual({
			text: "Cash limit ~ Nov 19",
			tone: "danger",
		});
	});
});

describe("income rule extent", () => {
	const base: SafeSpendingTrend = {
		actual: [
			{ date: "2026-11-09", spent: 10, projected: false },
			{ date: "2026-11-10", spent: 20, projected: false },
		],
		projected: [
			{ date: "2026-11-10", spent: 20, projected: true },
			{ date: "2026-11-12", spent: 40, projected: true },
		],
		limit: 100,
		safetyNet: 80,
		averageDaily: 10,
		limitHit: null,
		safetyNetHit: null,
		scheduledIncreases: [],
		monthlyIncome: {
			amount: 90,
			spent: 20,
			coordinate: 90,
			start: "2026-11-01",
			end: "2026-11-30",
			hit: null,
		},
	};

	it("covers the full chart range at the earned coordinate", () => {
		const line = incomeRuleLine(base);
		expect(line.map((point) => point.date)).toEqual([
			"2026-11-09",
			"2026-11-10",
			"2026-11-11",
			"2026-11-12",
		]);
		expect(line.every((point) => point.amount === 90)).toBe(true);
		expect(line.every((point) => point.income)).toBe(true);
	});

	it("falls back to recorded days when no projection remains", () => {
		const line = incomeRuleLine({ ...base, projected: [] });
		expect(line.map((point) => point.date)).toEqual([
			"2026-11-09",
			"2026-11-10",
		]);
	});

	it("hides the income rule for historical views without a coordinate", () => {
		expect(incomeRuleLine(base, true)).toEqual([]);
		expect(
			incomeRuleLine({
				...base,
				monthlyIncome: { ...base.monthlyIncome!, coordinate: null },
			}),
		).toEqual([]);
	});
});

describe("recurring increase dots on shared dates", () => {
	it("places the dot on the dated total after same-day increases", () => {
		const projected: SafeSpendingTrend["projected"] = [
			{ date: "2026-11-09", spent: 100, projected: true },
			{ date: "2026-11-09", spent: 160, projected: true },
			{ date: "2026-11-10", spent: 210, projected: true },
		];
		expect(
			recurringIncreaseDots(projected, [
				{ date: "2026-11-09", amount: 60, name: "Sub" },
			]),
		).toEqual([{ date: "2026-11-09", amount: 160 }]);
	});

	it("keeps future dated totals for later recurring bills", () => {
		const projected: SafeSpendingTrend["projected"] = [
			{ date: "2026-11-09", spent: 100, projected: true },
			{ date: "2026-11-10", spent: 210, projected: true },
		];
		expect(
			recurringIncreaseDots(projected, [
				{ date: "2026-11-10", amount: 60, name: "Sub" },
			]),
		).toEqual([{ date: "2026-11-10", amount: 210 }]);
	});
});
describe("scheduled recurring increases", () => {
	it("covers bumped projection values in the chart domain", () => {
		const trend: SafeSpendingTrend = {
			actual: [{ date: "2026-11-09", spent: 10, projected: false }],
			projected: [
				{ date: "2026-11-09", spent: 10, projected: true },
				{ date: "2026-11-10", spent: 70, projected: true },
			],
			limit: 50,
			safetyNet: 30,
			averageDaily: 5,
			limitHit: { date: "2026-11-10", amount: 70, projected: true },
			safetyNetHit: null,
			scheduledIncreases: [{ date: "2026-11-10", amount: 55, name: "Sub" }],
		};
		const [, high] = spendingChartDomain(trend);
		expect(high).toBeCloseTo(75.6);
	});

	it("renders recurring legend and increase description", () => {
		const trend: SafeSpendingTrend = {
			actual: [{ date: "2026-11-09", spent: 10, projected: false }],
			projected: [
				{ date: "2026-11-09", spent: 10, projected: true },
				{ date: "2026-11-10", spent: 70, projected: true },
			],
			limit: 100,
			safetyNet: 80,
			averageDaily: 5,
			limitHit: null,
			safetyNetHit: null,
			scheduledIncreases: [{ date: "2026-11-10", amount: 55, name: "Sub" }],
		};
		const html = renderToStaticMarkup(
			createElement(SafeSpendingTrendChart, { trend }),
		);
		expect(html).toContain("Recurring bills");
		expect(html).toContain("Includes $55.00 Sub bill on Nov 10, 2026.");
		const without = renderToStaticMarkup(
			createElement(SafeSpendingTrendChart, {
				trend: { ...trend, scheduledIncreases: [] },
			}),
		);
		expect(without).not.toContain("Recurring bills");
	});
});
