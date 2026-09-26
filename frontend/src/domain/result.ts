import { isoDate } from "./format.ts";
import type { Goal } from "./model.ts";

export interface Point {
	date: string;
	total: number;
	balances: Record<string, number>;
}
export interface Occurrence {
	date: string;
	movement: import("./model.ts").Movement;
	amount: number;
}
export interface MovementAccountDelta {
	accountId: string;
	delta: number;
}
export interface MovementResult {
	date: string;
	movementId: string;
	name: string;
	requested: number;
	realized: number;
	fromId: string | null;
	toId: string | null;
	available: number | null;
	constraint: string | null;
	accountDeltas: MovementAccountDelta[];
	constraintTypes?: string[];
}
export interface GoalResult {
	goal: Goal;
	firstDate: string | null;
	current: number;
	final: number;
}
export interface Projection {
	points: Point[];
	currentNetWorth: number;
	movements: MovementResult[];
	firstFailure: MovementResult | null;
	goals: GoalResult[];
	inflows: number;
	outflows: number;
	transfers: number;
	startDateHasCheckpoint?: boolean;
}
export interface RangePoint {
	date: string;
	lower: number;
	median: number;
	upper: number;
}
export interface RangeResult {
	points: RangePoint[];
	count: number;
	goalSuccess: Record<string, number>;
	failureShare: number;
}

function monthDate({
	year,
	month,
	day,
}: {
	year: number;
	month: number;
	day: number;
}) {
	const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	return isoDate(new Date(Date.UTC(year, month, Math.min(day, maxDay))));
}

// The horizon end date, clamped to month end. The backend resolves its own end
// date; the client uses this to label the visible range.
export function horizonDate({
	start,
	years,
}: {
	start: string;
	years: number;
}) {
	const value = new Date(`${start}T12:00:00Z`);
	return monthDate({
		year: value.getUTCFullYear() + years,
		month: value.getUTCMonth(),
		day: value.getUTCDate(),
	});
}

// Linear-interpolation percentile over an unsorted sample.
export function quantile({
	values,
	fraction,
}: {
	values: number[];
	fraction: number;
}) {
	if (!values.length) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const position = (sorted.length - 1) * fraction;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	const weight = position - lower;
	return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

// The engine owns this value. The previous plan-balance fallback existed only
// for the client-side engine and is gone.
export function currentNetWorth(projection: Projection): number {
	return projection.currentNetWorth;
}
