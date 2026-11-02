import type { FundingGap } from "./fundingGaps.ts";
import { summarizeFundingGap } from "./fundingGaps.ts";
import { shiftDate } from "./format.ts";
import type { Projection } from "./result.ts";

export interface LineChartGeometry {
	width: number;
	height: number;
	left: number;
	right: number;
	top: number;
	bottom: number;
	low: number;
	high: number;
	x: (index: number) => number;
	y: (value: number) => number;
	line: (series: number[]) => string;
	grid: number[];
	indexAt: (fraction: number) => number;
}

/**
 * Shared geometry for SVG line charts: uniform scales, path builders, five
 * gridlines, and pointer-fraction lookup. Callers own their bounds
 * (projection padding vs. funding window padding) and dimensions; every plot
 * renders through these scales so strokes and dots stay undistorted.
 */
export function lineChartModel({
	xMax,
	low,
	high,
	width,
	height,
	left,
	right,
	top,
	bottom,
}: {
	/** Maximum x index. Use slots - 1, or slots for a trailing marker slot. */
	xMax: number;
	low: number;
	high: number;
	width: number;
	height: number;
	left: number;
	right: number;
	top: number;
	bottom: number;
}): LineChartGeometry {
	const x = (index: number) =>
		left + (index / Math.max(1, xMax)) * (width - left - right);
	const y = (value: number) =>
		height - bottom - ((value - low) / (high - low)) * (height - top - bottom);
	const line = (series: number[]) =>
		series
			.map(
				(value, index) =>
					`${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`,
			)
			.join(" ");
	return {
		width,
		height,
		left,
		right,
		top,
		bottom,
		low,
		high,
		x,
		y,
		line,
		grid: [0, 1, 2, 3, 4].map((index) => low + ((high - low) * index) / 4),
		indexAt: (fraction: number) =>
			Math.max(
				0,
				Math.min(
					xMax,
					Math.round(
						((fraction * width - left) / (width - left - right)) * xMax,
					),
				),
			),
	};
}

/**
 * Balance-path model for one funding gap, built on lineChartModel. The
 * trailing x slot holds the refused payment: an explanatory red vector past
 * the last executed transaction that is never posted.
 */
export function fundingGapChartModel({
	gap,
	narrow,
}: {
	gap: FundingGap;
	narrow: boolean;
}) {
	const summary = summarizeFundingGap(gap);
	const balances = [
		gap.openingBalance,
		...summary.rows.map((row) => row.balanceAfter),
	];
	const hypothetical = summary.projectedBalanceIfExecuted;
	const peak = Math.max(0, ...balances, hypothetical);
	const floor = Math.min(0, ...balances, hypothetical);
	const span = Math.max(1, peak - floor);
	const high = Math.max(1000, peak) + Math.max(450, span * 0.13);
	const low = floor - Math.max(350, span * 0.09);
	const width = narrow ? 440 : 680;
	const height = narrow ? 260 : 280;
	const left = 63,
		right = 24,
		top = 15,
		bottom = 35;
	const count = balances.length;
	const { x, y, line, grid } = lineChartModel({
		xMax: count,
		low,
		high,
		width,
		height,
		left,
		right,
		top,
		bottom,
	});
	const balancePath = line(balances);
	const endX = x(count - 1);
	const failX = x(count);
	const endY = y(balances[count - 1] ?? 0);
	const failY = y(hypothetical);
	return {
		summary,
		balances,
		hypothetical,
		low,
		high,
		width,
		height,
		left,
		right,
		top,
		bottom,
		x,
		y,
		balancePath,
		areaPath: `${balancePath} L${endX.toFixed(1)},${y(low).toFixed(1)} L${x(0).toFixed(1)},${y(low).toFixed(1)} Z`,
		refusalPath: `M${endX.toFixed(1)},${endY.toFixed(1)} L${failX.toFixed(1)},${failY.toFixed(1)}`,
		endX,
		failX,
		endY,
		failY,
		baseline: y(0),
		grid,
	};
}

export type FundingGapChartModel = ReturnType<typeof fundingGapChartModel>;

/**
 * Trailing window for the net-worth graph: the last 30 calendar days ending
 * today, inclusive on both ends.
 */
export const TRAILING_NET_WORTH_DAYS = 30;

/**
 * Expand sparse projection points into one point per day across the trailing
 * window ending `today`. Each day carries the latest known total at or before
 * that day; days before the first known point carry the earliest total. The
 * engine only emits rows on event dates, so forward-filling is what turns
 * those rows into a continuous daily line.
 */
export function trailingDailyPoints(
	points: ReadonlyArray<Projection["points"][number]>,
	today: string,
	days: number = TRAILING_NET_WORTH_DAYS,
): Projection["points"] {
	if (points.length === 0 || days < 1) return [];
	const end = today.slice(0, 10);
	const sorted = [...points].sort((left, right) =>
		left.date < right.date ? -1 : left.date > right.date ? 1 : 0,
	);
	const start = shiftDate({ date: end, days: -(days - 1) });
	const result: Projection["points"] = [];
	// Balances forward-fill alongside totals: each day carries the latest
	// known balance per account, so sparse snapshot rows expand into a
	// continuous per-account series for the accounts trend view.
	const balances: Record<string, number> = {};
	// Both the day sequence and sorted are date-ordered: sweep once with a
	// cursor instead of re-scanning the prefix per day.
	let cursor = 0;
	let current = sorted[0]!;
	for (let offset = 0; offset < days; offset++) {
		const date = shiftDate({ date: start, days: offset });
		while (
			cursor + 1 < sorted.length &&
			sorted[cursor + 1]!.date.slice(0, 10) <= date
		) {
			cursor++;
		}
		if (sorted[cursor]!.date.slice(0, 10) <= date) current = sorted[cursor]!;
		for (const [accountId, balance] of Object.entries(current.balances)) {
			balances[accountId] = balance;
		}
		result.push({ date, total: current.total, balances: { ...balances } });
	}
	return result;
}

/**
 * Y domain for the trailing net-worth line. Positive wealth keeps the $0
 * floor and 8% headroom; all-debt windows pin both bounds near the data
 * instead of wasting the chart on the unreachable $0 ceiling.
 */
export function netWorthDomain(totals: ReadonlyArray<number>): {
	low: number;
	high: number;
} {
	const actualPeak = totals.length ? Math.max(...totals) : 0;
	const actualTrough = totals.length ? Math.min(...totals) : 0;
	const span = Math.max(1, actualPeak - actualTrough);
	// Minimum zoom: a dormant window would otherwise collapse to a pennies
	// domain with identical gridlines.
	const pad = Math.max(
		span * 0.08,
		Math.abs(actualPeak) * 0.01,
		Math.abs(actualTrough) * 0.01,
	);
	const high =
		actualPeak >= 0 ? Math.max(...totals, 1) * 1.08 : actualPeak + pad;
	const low = actualTrough >= 0 ? Math.min(0, ...totals) : actualTrough - pad;
	return { low, high };
}

export interface AccountTrendPoint {
	date: string;
	account: string;
	balance: number;
}

export interface AccountTrendSeries {
	id: string;
	name: string;
	endBalance: number;
	/** Position in the full account order, so colors survive window changes. */
	colorIndex: number;
}

/**
 * Long-form per-account rows for the accounts view, plus one series entry
 * per account with a nonzero presence in the window. Dates stay as ISO
 * days; the chart axis formats and thins them. The rows mirror the total
 * line's window: every account series shares the same daily domain.
 */
export function accountTrendRows({
	points,
	accounts,
}: {
	points: ReadonlyArray<Projection["points"][number]>;
	accounts: ReadonlyArray<{ id: string; name: string }>;
}): { rows: AccountTrendPoint[]; series: AccountTrendSeries[] } {
	const present = new Set<string>();
	for (const point of points) {
		for (const [accountId, balance] of Object.entries(point.balances)) {
			if (balance !== 0) present.add(accountId);
		}
	}
	const ordered = accounts.filter((account) => present.has(account.id));
	const names = new Map(ordered.map((account) => [account.id, account.name]));
	const index = new Map(
		accounts.map((account, position) => [account.id, position]),
	);
	const rows: AccountTrendPoint[] = [];
	for (const point of points) {
		const date = point.date.slice(0, 10);
		for (const account of ordered) {
			rows.push({
				date,
				account: names.get(account.id) ?? account.id,
				balance: point.balances[account.id] ?? 0,
			});
		}
	}
	const last = points.at(-1);
	const series = ordered.map((account) => ({
		id: account.id,
		name: names.get(account.id) ?? account.id,
		endBalance: last?.balances[account.id] ?? 0,
		colorIndex: index.get(account.id) ?? 0,
	}));
	return { rows, series };
}
