import type { TransactionRow } from "@/api/generated/model/transactionRow.ts";
import type { Transaction } from "./model.ts";

const NUMERIC_EXPRESSION = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/** Literal figure from a stored amount, or null for calculated recipes. */
export function literalAmountOf(
	amount: TransactionRow["amount"],
): number | null {
	const config = (amount?.config ?? {}) as Record<string, unknown>;
	const expression = config["expression"];
	if (
		typeof expression === "string" &&
		NUMERIC_EXPRESSION.test(expression.trim())
	) {
		const value = Number(expression.trim());
		if (Number.isFinite(value)) return value;
	}
	for (const key of ["value", "amount"] as const) {
		const candidate = config[key];
		if (typeof candidate === "number" && Number.isFinite(candidate))
			return candidate;
	}
	return null;
}

/** Yearly percent from a stored growth-factor input, or zero. */
export function growthPercentOf(amount: TransactionRow["amount"]): number {
	const inputs = (amount?.inputs ?? {}) as Record<
		string,
		{
			source?: unknown;
			provider?: unknown;
			arguments?: unknown;
		}
	>;
	for (const name of Object.keys(inputs).sort()) {
		const binding = inputs[name];
		if (binding?.source !== "provider" || binding.provider !== "growth-factor")
			continue;
		const rate = (binding.arguments as Record<string, unknown> | null)?.[
			"annualGrowthRate"
		];
		if (typeof rate === "number" && Number.isFinite(rate)) return rate * 100;
	}
	return 0;
}

type TransactionQueryExtras = {
	claim?: { ruleId?: unknown; occurrenceDate?: unknown } | null;
	pending?: unknown;
	void?: unknown;
	postedTime?: unknown;
	transactionTime?: unknown;
	annualCap?: unknown;
};

function dayFromStamps(
	transactionTime: unknown,
	postedTime: unknown,
): string | null {
	const stamp =
		typeof transactionTime === "number" && transactionTime > 0
			? transactionTime
			: typeof postedTime === "number" && postedTime > 0
				? postedTime
				: 0;
	if (!stamp) return null;
	return new Date(stamp * 1000).toISOString().slice(0, 10);
}

function settledDayOf(postedTime: unknown): string | null {
	if (typeof postedTime !== "number" || postedTime <= 0) return null;
	return new Date(postedTime * 1000).toISOString().slice(0, 10);
}

function displayFrequencyOf(frequency: string): Transaction["frequency"] {
	if (frequency === "annual" || frequency === "yearly") return "yearly";
	return "monthly";
}

/**
 * Narrow query transaction to display transaction. Non-literal amounts resolve
 * through the caller's projection figure; without one the transaction stays
 * Varies.
 */
export function transactionToDisplay(
	row: TransactionRow,
	resolved?: { requested: number } | null,
): Transaction {
	const extra = row as TransactionRow & TransactionQueryExtras;
	const literal = literalAmountOf(row.amount);
	const requested =
		resolved && Number.isFinite(resolved.requested) ? resolved.requested : null;
	const amount = literal ?? requested;
	const once = row.kind === "posting";
	const claim = extra.claim;
	return {
		id: row.id,
		name: row.name || row.id,
		amount: Math.max(0, amount ?? 0),
		amountKnown: amount !== null,
		fromId: row.sourceAccountId,
		toId: row.destinations?.[0] ?? null,
		frequency: once ? "once" : displayFrequencyOf(row.frequency),
		startDate:
			row.startDate ||
			dayFromStamps(extra.transactionTime, extra.postedTime) ||
			"",
		endDate: row.endDate,
		annualIncrease: once ? 0 : growthPercentOf(row.amount),
		enabled: row.enabled,
		readOnly: row.readOnly,
		claimRuleId:
			typeof claim?.ruleId === "string" && claim.ruleId ? claim.ruleId : null,
		claimOccurrenceDate:
			typeof claim?.occurrenceDate === "string" && claim.occurrenceDate
				? claim.occurrenceDate
				: null,
		// Neither pending holds nor vanished holds have posted: legacy
		// rows may still carry a fabricated sync-time posted instant.
		postedDate:
			once && extra.pending !== true && extra.void !== true
				? settledDayOf(extra.postedTime)
				: null,
		pending: extra.pending === true,
		void: extra.void === true,
		syncOwned: row.syncOwned === true,
		transactionTime:
			typeof extra.transactionTime === "number" && extra.transactionTime > 0
				? extra.transactionTime
				: null,
	};
}
