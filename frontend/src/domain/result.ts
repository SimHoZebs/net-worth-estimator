import type { TransactionFulfillment } from "../api/contracts.ts";
import type {
	FinancialIndependenceAnalysis,
	FinancialIndependenceRange,
} from "./financialIndependence.ts";
import { clampMonth } from "./format.ts";
import type { Evaluation } from "./model.ts";

export interface Point {
	date: string;
	total: number;
	balances: Record<string, number>;
}
export interface Occurrence {
	date: string;
	transaction: import("./model.ts").Transaction;
	amount: number;
}
export interface TransactionAccountDelta {
	accountId: string;
	delta: number;
}
export interface TransactionResult {
	date: string;
	transactionId: string;
	name: string;
	requested: number;
	realized: number;
	fromId: string | null;
	toId: string | null;
	available: number | null;
	constraint: string | null;
	accountDeltas: TransactionAccountDelta[];
	constraintTypes?: string[];
	fulfillment?: TransactionFulfillment;
}
export interface EvaluationResult {
	evaluation: Evaluation;
	firstDate: string | null;
	current: number;
	final: number;
}
export type OtherEvaluationType =
	| "financialIndependence"
	| "postingFulfillment"
	| "cycleFulfillment";
export interface OtherEvaluationProgress {
	fraction: number;
	current: string;
	share: string | null;
}
/**
 * Generic numeric result carried alongside the status badge. Envelopes that
 * report a numeric `value` (and optional `bands`) surface it here; cards
 * render it next to the status without changing status semantics. Null when
 * the envelope carries no numeric result.
 */
export interface OtherEvaluationValue {
	current: number | null;
	unit: "currency" | "ratio" | "count" | null;
}
export interface OtherEvaluationBands {
	p10: number | null;
	p50: number | null;
	p90: number | null;
}
export interface OtherEvaluation {
	id: string;
	name: string;
	type: OtherEvaluationType;
	enabled: boolean;
	status: string;
	goal: string | null;
	outcomeDate: string | null;
	outcomeText: string;
	qualifier: string | null;
	progress: OtherEvaluationProgress | null;
	/** Numeric result rendered alongside the status badge. Null when absent. */
	value?: OtherEvaluationValue | null;
	/** Percentile bands rendered alongside the status badge. Null when absent. */
	bands?: OtherEvaluationBands | null;
	/** Configured transaction scope for posting-fulfillment evidence. Null means all. */
	postingIds?: string[] | null;
	financialIndependence?: FinancialIndependenceAnalysis | null;
}
export interface Projection {
	points: Point[];
	currentNetWorth: number;
	transactions: TransactionResult[];
	firstFailure: TransactionResult | null;
	evaluations: EvaluationResult[];
	otherEvaluations: OtherEvaluation[];
	inflows: number;
	outflows: number;
	transfers: number;
	startDateHasCheckpoint?: boolean;
	plannedPurchases?: PurchaseSchedule | null;
}

export interface PurchaseSchedule {
	purchases: { purchaseId: string; date: string | null; amount: number }[];
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
	evaluationSuccess: Record<string, number>;
	failureShare: number;
	financialIndependence?: Record<string, FinancialIndependenceRange>;
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
	return clampMonth({ year, month, day });
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

// The engine owns this value. The previous plan-balance fallback existed only
// for the client-side engine and is gone.
export function currentNetWorth(projection: Projection): number {
	return projection.currentNetWorth;
}
