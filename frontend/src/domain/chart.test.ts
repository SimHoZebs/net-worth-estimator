import { describe, expect, it } from "vitest";
import { projectionFixture } from "../mocks/projection.ts";
import { compactMoney } from "./format.ts";
import type { FundingGap } from "./fundingGaps.ts";
import {
	accountTrendRows,
	assignAccountDashes,
	fundingGapChartModel,
	lineChartModel,
	netWorthDomain,
	trailingDailyPoints,
	TRAILING_NET_WORTH_DAYS,
} from "./chart.ts";

const projection = projectionFixture();

describe("chart presentation data", () => {
	describe("shared line geometry", () => {
		const gap: FundingGap = {
			id: "rent",
			date: "2030-09-25",
			name: "Rent",
			fundingAccount: { id: "checking", name: "Checking" },
			openingBalance: 1000,
			requiredAmount: 9000,
			availableAmount: 2500,
			unfulfilledAmount: 6500,
			windowStartDate: "2030-09-01",
			transactions: [
				{
					id: "pay",
					date: "2030-09-10",
					name: "Payroll",
					amount: 2000,
					kind: "income",
				},
				{
					id: "bill",
					date: "2030-09-20",
					name: "Bill",
					amount: -500,
					kind: "utilities",
				},
			],
		};
		it("builds the funding path on the same scales as the projection", () => {
			const model = fundingGapChartModel({ gap, narrow: false });
			expect(model.width).toBe(680);
			expect(model.grid).toHaveLength(5);
			for (const path of [
				model.balancePath,
				model.areaPath,
				model.refusalPath,
			]) {
				expect(path).toMatch(/^M/);
				expect(path).not.toMatch(/NaN|Infinity/);
			}
			// Refusal vector lands past the last executed transaction, below it.
			expect(model.failX).toBeGreaterThan(model.endX);
			expect(model.failY).toBeGreaterThan(model.endY);
			expect(model.summary.shortfall).toBe(9000 - 2500);
		});
		it("keeps lookup and geometry in bounds for a single transaction", () => {
			const geometry = lineChartModel({
				xMax: 1,
				low: -100,
				high: 100,
				width: 440,
				height: 260,
				left: 63,
				right: 24,
				top: 15,
				bottom: 35,
			});
			expect(geometry.indexAt(-1)).toBe(0);
			expect(geometry.indexAt(2)).toBe(1);
			expect(geometry.line([10])).toMatch(/^M/);
			expect(geometry.line([10])).not.toMatch(/NaN|Infinity/);
		});
	});
	describe("trailingDailyPoints", () => {
		// Fixture rows: 2026-01-01 $1,000, 2026-07-01 $1,400, 2027-01-01
		// $1,800. The 30-day window ending 2026-07-01 runs 2026-06-02 to
		// 2026-07-01.
		const today = "2026-07-01";
		it("expands sparse rows into one daily point per day", () => {
			const daily = trailingDailyPoints(projection.points, today);
			expect(daily).toHaveLength(TRAILING_NET_WORTH_DAYS);
			expect(daily[0]?.date).toBe("2026-06-02");
			expect(daily.at(-1)?.date).toBe("2026-07-01");
			expect(daily.at(-1)?.total).toBe(1400);
			for (const point of daily.slice(0, -1)) {
				expect(point.total).toBe(1000);
			}
		});
		it("sorts its input and ignores future rows", () => {
			const shuffled = [...projection.points].reverse();
			const daily = trailingDailyPoints(shuffled, today);
			expect(daily).toHaveLength(TRAILING_NET_WORTH_DAYS);
			expect(daily.at(-1)?.total).toBe(1400);
		});
		it("backfills days before the first row with the earliest total", () => {
			const daily = trailingDailyPoints(
				[{ date: "2027-01-01", total: 1800, balances: {} }],
				today,
			);
			expect(daily).toHaveLength(TRAILING_NET_WORTH_DAYS);
			for (const point of daily) {
				expect(point.total).toBe(1800);
			}
		});
		it("returns no points for empty input", () => {
			expect(trailingDailyPoints([], today)).toEqual([]);
		});
		it("forward-fills the latest known balance per account", () => {
			const daily = trailingDailyPoints(
				[
					{
						date: "2026-06-02",
						total: 1000,
						balances: { checking: 600, savings: 400 },
					},
					{
						date: "2026-06-20",
						total: 1400,
						balances: { checking: 800, savings: 600 },
					},
					{ date: "2026-07-01", total: 1400, balances: {} },
				],
				today,
			);
			expect(daily).toHaveLength(TRAILING_NET_WORTH_DAYS);
			// Days before the first row backfill the earliest balances.
			expect(daily[0]?.balances).toEqual({ checking: 600, savings: 400 });
			// Sparse rows hold the latest known balances through the window.
			expect(daily.at(-1)?.balances).toEqual({
				checking: 800,
				savings: 600,
			});
		});
	});
	describe("accountTrendRows", () => {
		const today = "2026-07-01";
		const accounts = [
			{ id: "checking", name: "Everyday checking" },
			{ id: "savings", name: "Emergency fund" },
			{ id: "archived", name: "Old account" },
		];
		it("expands daily points into one row per account", () => {
			const daily = trailingDailyPoints(
				[
					{
						date: "2026-06-02",
						total: 1000,
						balances: { checking: 600, savings: 400 },
					},
					{ date: "2026-07-01", total: 1400, balances: {} },
				],
				today,
			);
			const { rows, series } = accountTrendRows({ points: daily, accounts });
			expect(rows).toHaveLength(daily.length * 2);
			expect(series.map((entry) => entry.id)).toEqual(["checking", "savings"]);
			expect(series.map((entry) => entry.name)).toEqual([
				"Everyday checking",
				"Emergency fund",
			]);
			expect(series.map((entry) => entry.endBalance)).toEqual([600, 400]);
			for (const row of rows) {
				expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			}
		});
		it("omits accounts with no presence in the window", () => {
			const { series } = accountTrendRows({
				points: trailingDailyPoints(
					[{ date: "2027-01-01", total: 1800, balances: {} }],
					today,
				),
				accounts,
			});
			expect(series).toEqual([]);
		});
		it("keeps debt balances negative so the stack can diverge below zero", () => {
			const daily = trailingDailyPoints(
				[
					{
						date: "2026-06-02",
						total: 600,
						balances: { checking: 1000, mortgage: -400 },
					},
					{ date: "2026-07-01", total: 700, balances: {} },
				],
				today,
			);
			const { rows, series } = accountTrendRows({
				points: daily,
				accounts: [...accounts, { id: "mortgage", name: "Home mortgage" }],
			});
			expect(series.map((entry) => entry.id)).toEqual(["checking", "mortgage"]);
			expect(series.map((entry) => entry.endBalance)).toEqual([1000, -400]);
			expect(
				rows.find(
					(row) => row.account === "Home mortgage" && row.date === "2026-07-01",
				)?.balance,
			).toBe(-400);
		});
		it("assigns colors by full account order across windows", () => {
			const narrow = accountTrendRows({
				points: trailingDailyPoints(
					[
						{
							date: "2026-06-02",
							total: 1000,
							balances: { checking: 600, savings: 400 },
						},
						{ date: "2026-07-01", total: 1000, balances: {} },
					],
					today,
				),
				accounts,
			});
			const wide = accountTrendRows({
				points: trailingDailyPoints(
					[
						{
							date: "2026-06-02",
							total: 1000,
							balances: { checking: 600, archived: 50, savings: 350 },
						},
						{ date: "2026-07-01", total: 1000, balances: {} },
					],
					today,
				),
				accounts,
			});
			const colorOf = (
				series: { id: string; colorIndex: number }[],
				id: string,
			) => series.find((entry) => entry.id === id)?.colorIndex;
			expect(colorOf(narrow.series, "checking")).toBe(0);
			expect(colorOf(narrow.series, "savings")).toBe(1);
			expect(colorOf(wide.series, "checking")).toBe(0);
			expect(colorOf(wide.series, "savings")).toBe(1);
			expect(colorOf(wide.series, "archived")).toBe(2);
		});
	});
	describe("assignAccountDashes", () => {
		it("keeps an account on its global pattern across windows", () => {
			const first = assignAccountDashes([{ colorIndex: 1 }, { colorIndex: 3 }]);
			const second = assignAccountDashes([
				{ colorIndex: 0 },
				{ colorIndex: 1 },
				{ colorIndex: 3 },
			]);
			expect(first).toEqual([second[1], second[2]]);
		});
		it("bumps a sparse-window collision to the next free pattern", () => {
			// Accounts 0 and 6 share a global pattern; with only those two
			// visible the second must not repeat the first.
			const [only, other] = assignAccountDashes([
				{ colorIndex: 0 },
				{ colorIndex: 6 },
			]);
			expect(only).toBeUndefined();
			expect(other).toBeDefined();
			expect(other).not.toBe(only);
		});
		it("keeps every visible dash distinct until patterns run out", () => {
			const dashes = assignAccountDashes(
				[0, 1, 2, 3, 4, 5].map((colorIndex) => ({ colorIndex })),
			);
			expect(new Set(dashes).size).toBe(6);
		});
	});
	describe("netWorthDomain", () => {
		it("keeps the $0 floor and 8% headroom for positive wealth", () => {
			const { low, high } = netWorthDomain([1000, 1400, 1800]);
			expect(low).toBe(0);
			expect(high).toBeCloseTo(1800 * 1.08, 6);
		});
		it("pins an all-debt window near the data instead of the $0 ceiling", () => {
			const { low, high } = netWorthDomain([-66200, -65800]);
			// Span 400, but the 1% minimum zoom sets padding 662.
			expect(high).toBeLessThan(0);
			expect(high).toBeCloseTo(-65138, 6);
			expect(low).toBeCloseTo(-66862, 6);
		});
		it("keeps a flat all-debt window legible", () => {
			const { low, high } = netWorthDomain([-66000, -66000]);
			expect(high).toBeCloseTo(-65340, 6);
			expect(low).toBeCloseTo(-66660, 6);
			expect(high - low).toBeGreaterThanOrEqual(1000);
			const labels = new Set(
				[low, (low + high) / 2, high].map((value) => compactMoney(value)),
			);
			expect(labels.size).toBeGreaterThan(1);
		});
		it("pads below a window that straddles $0", () => {
			const { low, high } = netWorthDomain([-100, 200]);
			expect(high).toBeCloseTo(200 * 1.08, 6);
			expect(low).toBeCloseTo(-124, 6);
		});
	});
});
