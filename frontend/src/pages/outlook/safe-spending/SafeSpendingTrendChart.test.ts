import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SafeSpendingTrend } from "@/domain/safeSpendingTrend.ts";
import {
	incomeRuleLine,
	lineAmountLabels,
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
		billMarkers: [],
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
	it("keeps crossing identities without showing cleared cash or reserve warnings", () => {
		expect(paceLabel(cleared)).toEqual({ text: null, tone: "normal" });
	});
	it("warns about a genuine future crossing after an earlier cleared crossing", () => {
		const trend = {
			...cleared,
			projected: [
				{ date: "2026-11-09", spent: 10, projected: true },
				{ date: "2026-11-19", spent: 60, projected: true },
			],
		};
		expect(paceLabel(trend)).toEqual({
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
		billMarkers: [],
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

	it("hides the income rule without a coordinate", () => {
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
			recurringIncreaseDots([], projected, [
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
			recurringIncreaseDots([], projected, [
				{ date: "2026-11-10", amount: 60, name: "Sub" },
			]),
		).toEqual([{ date: "2026-11-10", amount: 210 }]);
	});

	it("falls back to the actual curve for a bill already in the cycle", () => {
		const actual: SafeSpendingTrend["actual"] = [
			{ date: "2026-11-08", spent: 40, projected: false },
			{ date: "2026-11-09", spent: 100, projected: false },
		];
		const projected: SafeSpendingTrend["projected"] = [
			{ date: "2026-11-09", spent: 100, projected: true },
			{ date: "2026-11-10", spent: 210, projected: true },
		];
		expect(
			recurringIncreaseDots(actual, projected, [
				{ date: "2026-11-08", amount: 25, name: "Paid sub" },
			]),
		).toEqual([{ date: "2026-11-08", amount: 40 }]);
	});

	it("prefers the projected post-increase point when both curves have the date", () => {
		const actual: SafeSpendingTrend["actual"] = [
			{ date: "2026-11-09", spent: 100, projected: false },
		];
		const projected: SafeSpendingTrend["projected"] = [
			{ date: "2026-11-09", spent: 100, projected: true },
			{ date: "2026-11-09", spent: 160, projected: true },
		];
		expect(
			recurringIncreaseDots(actual, projected, [
				{ date: "2026-11-09", amount: 60, name: "Due today" },
			]),
		).toEqual([{ date: "2026-11-09", amount: 160 }]);
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
			billMarkers: [],
		};
		const [, high] = spendingChartDomain(trend);
		expect(high).toBeCloseTo(75.6);
	});

	it("renders recurring legend and increase description from bill markers", () => {
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
			scheduledIncreases: [],
			billMarkers: [{ date: "2026-11-10", amount: 55, name: "Sub" }],
		};
		const html = renderToStaticMarkup(
			createElement(SafeSpendingTrendChart, { trend }),
		);
		expect(html).toContain("Recurring bills");
		expect(html).toContain("Includes $55.00 Sub bill on Nov 10, 2026.");
		const without = renderToStaticMarkup(
			createElement(SafeSpendingTrendChart, {
				trend: { ...trend, billMarkers: [] },
			}),
		);
		expect(without).not.toContain("Recurring bills");
	});
});

describe("horizontal rule amount labels", () => {
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
		billMarkers: [],
		monthlyIncome: {
			amount: 90,
			spent: 20,
			coordinate: 90,
			start: "2026-11-01",
			end: "2026-11-30",
			hit: null,
		},
	};

	const domain = spendingChartDomain(base);
	const renderedLabelY = (html: string, text: string) => {
		const match = [
			...html.matchAll(/<text[^>]*y="([\d.]+)"[^>]*>([^<]*)<\/text>/g),
		].find((item) => item[2] === text);
		if (!match) throw new Error(`Missing rendered label: ${text}`);
		return Number(match[1]);
	};
	const labelYs = (html: string) =>
		["Cash limit $100.00", "Income limit $90.00", "Reserve $80.00"]
			.map((text) => renderedLabelY(html, text))
			.sort((left, right) => left - right);

	it("labels each drawn rule with its amount", () => {
		const labels = lineAmountLabels(base, domain);
		expect(labels.map((label) => [label.label, label.fill])).toEqual([
			["Income limit $90.00", "var(--chart-2)"],
			["Reserve $80.00", "var(--warning-text)"],
			["Cash limit $100.00", "var(--danger-solid)"],
		]);
		expect(labels.map((label) => label.amount)).toEqual([90, 80, 100]);
	});

	it("omits labels for rules that are not drawn", () => {
		expect(
			lineAmountLabels(
				{
					...base,
					monthlyIncome: { ...base.monthlyIncome!, coordinate: null },
					limit: null,
					safetyNet: null,
				},
				domain,
			),
		).toEqual([]);
		expect(
			lineAmountLabels({ ...base, limit: 0, safetyNet: 0 }, domain).map(
				(label) => label.label,
			),
		).toEqual(["Income limit $90.00"]);
	});

	it("keeps close rule amounts readable in server-rendered markup", () => {
		const html = renderToStaticMarkup(
			createElement(SafeSpendingTrendChart, { trend: base }),
		);
		expect(html).toContain("Income limit $90.00");
		expect(html).toContain("Reserve $80.00");
		expect(html).toContain("Cash limit $100.00");
		const ys = labelYs(html);
		expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(12);
		expect(ys[2]! - ys[1]!).toBeGreaterThanOrEqual(12);
	});

	it("separates labels when the rules themselves nearly coincide", () => {
		const close = {
			...base,
			limit: 100,
			safetyNet: 99,
			monthlyIncome: { ...base.monthlyIncome!, amount: 98, coordinate: 98 },
		};
		const html = renderToStaticMarkup(
			createElement(SafeSpendingTrendChart, {
				trend: close,
			}),
		);
		const closeYs = [
			"Cash limit $100.00",
			"Income limit $98.00",
			"Reserve $99.00",
		]
			.map((text) => renderedLabelY(html, text))
			.sort((left, right) => left - right);
		expect(closeYs[1]! - closeYs[0]!).toBeGreaterThanOrEqual(12);
		expect(closeYs[2]! - closeYs[1]!).toBeGreaterThanOrEqual(12);
	});
});
