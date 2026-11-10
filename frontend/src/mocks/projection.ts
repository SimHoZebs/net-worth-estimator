import type {
	EvaluationResult,
	TransactionResult,
	Point,
	Projection,
} from "../domain/result.ts";
import { financialModelFixture } from "./financialModel.ts";

/**
 * A hand-built projection in the shape the Go engine returns. Unit tests used
 * to call the deleted client-side engine; they now state the projection they
 * are reasoning about.
 */
export function projectionFixture(
	overrides: Partial<Projection> = {},
): Projection {
	const points: Point[] = [
		{ date: "2026-01-01", total: 1000, balances: { checking: 1000 } },
		{ date: "2026-07-01", total: 1400, balances: { checking: 1400 } },
		{ date: "2027-01-01", total: 1800, balances: { checking: 1800 } },
	];
	return {
		points,
		currentNetWorth: 1000,
		transactions: [],
		firstFailure: null,
		evaluations: [],
		otherEvaluations: [],
		inflows: 0,
		outflows: 0,
		transfers: 0,
		startDateHasCheckpoint: true,
		...overrides,
	};
}

export function transactionFixture(
	overrides: Partial<TransactionResult> = {},
): TransactionResult {
	return {
		date: "2026-03-06",
		transactionId: "renovation",
		name: "Home renovation",
		requested: 9000,
		realized: 6350,
		fromId: "checking",
		toId: null,
		available: 6350,
		constraint: "Protected account balance",
		accountDeltas: [{ accountId: "checking", delta: -6350 }],
		fulfillment: {
			unfulfilledAmount: Math.max(
				0,
				(overrides.requested ?? 9000) - (overrides.realized ?? 6350),
			),
			destinationLimitedAmount: 0,
		},
		...overrides,
	};
}

export function evaluationFixture(
	overrides: Partial<EvaluationResult> = {},
): EvaluationResult {
	return {
		evaluation: financialModelFixture.evaluations[0]!,
		firstDate: "2028-06-01",
		current: 361200,
		final: 1016195,
		...overrides,
	};
}

function event(
	model: typeof financialModelFixture,
	transactionId: string,
	date: string,
	requested: number,
	realized: number,
	constraint: string | null,
): TransactionResult {
	const transaction = model.transactions.find(
		(item) => item.id === transactionId,
	);
	const fromId = transaction?.fromId ?? null;
	const toId = transaction?.toId ?? null;
	return {
		date,
		transactionId,
		name: transaction?.name ?? transactionId,
		requested,
		realized,
		fromId,
		toId,
		available: realized,
		constraint,
		fulfillment: {
			unfulfilledAmount: Math.max(0, requested - realized),
			destinationLimitedAmount: 0,
		},
		accountDeltas: [
			...(fromId ? [{ accountId: fromId, delta: -realized }] : []),
			...(toId ? [{ accountId: toId, delta: realized }] : []),
		],
	};
}

/**
 * A model projection with the shapes the activity view must handle:
 * a shortfall against a protected balance, a two-sided transfer, and enough
 * recurring occurrences to paginate.
 */
export function activityProjection(
	model: typeof financialModelFixture = financialModelFixture,
): Projection {
	// Explicit engine-shaped outcomes, not a second occurrence generator.
	const transactions = [
		event(model, "pay", "2026-09-28", 11200, 11200, null),
		event(model, "living", "2026-10-01", 5400, 5400, null),
		event(model, "mortgage-payment", "2026-10-01", 2050, 2050, null),
		event(model, "invest", "2026-10-03", 1800, 1800, null),
		event(model, "retirement-contribution", "2026-10-05", 1100, 1100, null),
		event(model, "living", "2026-11-01", 5400, 5400, null),
		event(
			model,
			"renovation",
			"2028-06-15",
			48000,
			12000,
			"Protected account balance",
		),
		event(model, "mortgage-payment", "2032-10-01", 0, 0, null),
	].filter((row) =>
		model.transactions.some(
			(transaction) =>
				transaction.id === row.transactionId && transaction.enabled,
		),
	);
	return projectionFixture({ transactions });
}
