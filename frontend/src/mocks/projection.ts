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
/**
 * A model projection shaped like the engine output: every enabled recurring
 * transaction expanded monthly on its own day of month, a one-time renovation that
 * exceeds the protected balance, and a mortgage paid off after five years so its
 * scheduled payment continues at zero.
 */
export function activityProjection(
	model: typeof financialModelFixture = financialModelFixture,
): Projection {
	const transactions: TransactionResult[] = [];
	for (const transaction of model.transactions) {
		if (!transaction.enabled) continue;
		if (transaction.frequency === "once") {
			const shortfall = transaction.id === "renovation";
			transactions.push(
				event(
					model,
					transaction.id,
					transaction.startDate,
					shortfall ? 48000 : transaction.amount,
					shortfall ? 12000 : transaction.amount,
					shortfall ? "Protected account balance" : null,
				),
			);
			continue;
		}
		const day = Number(transaction.startDate.slice(8, 10));
		for (let month = 0; month < 120; month++) {
			const year = 2026 + Math.floor(month / 12);
			const monthIndex = ((month + 9) % 12) + 1;
			const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
			const date = `${year}-${String(monthIndex).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
			if (date <= model.startDate) continue;
			// The mortgage is paid off after five years; the scheduled payment then
			// continues at zero and must not appear as a transaction.
			const paidOff = transaction.id === "mortgage-payment" && month >= 60;
			transactions.push(
				event(
					model,
					transaction.id,
					date,
					paidOff ? 0 : transaction.amount,
					paidOff ? 0 : transaction.amount,
					null,
				),
			);
		}
	}
	return projectionFixture({ transactions });
}
