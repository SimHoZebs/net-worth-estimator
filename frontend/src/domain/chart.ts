import { shiftDate } from "./format.ts";
import type { Projection } from "./result.ts";

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
 * Dash patterns for the monochrome accounts view, in ascending visual
 * weight. Keyed by nothing: callers assign them through
 * assignAccountDashes.
 */
export const ACCOUNT_LINE_DASHES: ReadonlyArray<string | undefined> = [
	undefined, // solid
	"6 3", // dash
	"1.5 3", // dots
	"8 3 2 3", // dash-dot
	"12 4 2 4", // long dash plus short dash
	"3 2 8 2", // dot plus dash
];

/**
 * One dash per visible series, aligned with the input order. The global
 * account order seeds the choice so an account keeps its pattern across
 * window changes; a series that would collide with an earlier visible one
 * takes the next free pattern, so the visible set is always distinct
 * (until more series than patterns, where the extras fall back to solid).
 */
export function assignAccountDashes(
	series: ReadonlyArray<{ colorIndex: number }>,
): (string | undefined)[] {
	const used = new Set<string | undefined>();
	return series.map((entry) => {
		let dash =
			ACCOUNT_LINE_DASHES[entry.colorIndex % ACCOUNT_LINE_DASHES.length];
		if (used.has(dash)) {
			dash = ACCOUNT_LINE_DASHES.find((candidate) => !used.has(candidate));
		}
		used.add(dash);
		return dash;
	});
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
	accounts: ReadonlyArray<{
		id: string;
		name: string;
		display?: import("./model.ts").Account["display"];
	}>;
}): { rows: AccountTrendPoint[]; series: AccountTrendSeries[] } {
	const present = new Set<string>();
	for (const point of points) {
		for (const [accountId, balance] of Object.entries(point.balances)) {
			if (balance !== 0) present.add(accountId);
		}
	}
	const ordered = accounts.filter((account) =>
		componentIds(account).some((id) => present.has(id)),
	);
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
				balance: displayBalance(account, point.balances),
			});
		}
	}
	const last = points.at(-1);
	const series = ordered.map((account) => ({
		id: account.id,
		name: names.get(account.id) ?? account.id,
		endBalance: last ? displayBalance(account, last.balances) : 0,
		colorIndex: index.get(account.id) ?? 0,
	}));
	return { rows, series };
}
import { componentIds, displayBalance } from "./accountDisplay.ts";
