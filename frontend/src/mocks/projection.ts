import type {
	EvaluationResult,
	MovementResult,
	Point,
	Projection,
} from "../domain/result.ts";
import { testPlan } from "./plan.ts";

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
		movements: [],
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

export function movementFixture(
	overrides: Partial<MovementResult> = {},
): MovementResult {
	return {
		date: "2026-03-06",
		movementId: "renovation",
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
		evaluation: testPlan.evaluations[0]!,
		firstDate: "2028-06-01",
		current: 361200,
		final: 1016195,
		...overrides,
	};
}

function event(
	plan: typeof testPlan,
	movementId: string,
	date: string,
	requested: number,
	realized: number,
	constraint: string | null,
): MovementResult {
	const transaction = plan.transactions.find((item) => item.id === movementId);
	const fromId = transaction?.fromId ?? null;
	const toId = transaction?.toId ?? null;
	return {
		date,
		movementId,
		name: transaction?.name ?? movementId,
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
 * A household projection with the shapes the activity view must handle:
 * a shortfall against a protected balance, a two-sided transfer, and enough
 * recurring occurrences to paginate.
 */
/**
 * A household projection shaped like the engine output: every enabled recurring
 * movement expanded monthly on its own day of month, a one-time renovation that
 * exceeds the protected balance, and a mortgage paid off after five years so its
 * scheduled payment continues at zero.
 */
export function activityProjection(
	plan: typeof testPlan = testPlan,
): Projection {
	const movements: MovementResult[] = [];
	for (const transaction of plan.transactions) {
		if (!transaction.enabled) continue;
		if (transaction.frequency === "once") {
			const shortfall = transaction.id === "renovation";
			movements.push(
				event(
					plan,
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
			if (date <= plan.startDate) continue;
			// The mortgage is paid off after five years; the scheduled payment then
			// continues at zero and must not appear as a transaction.
			const paidOff = transaction.id === "mortgage-payment" && month >= 60;
			movements.push(
				event(
					plan,
					transaction.id,
					date,
					paidOff ? 0 : transaction.amount,
					paidOff ? 0 : transaction.amount,
					null,
				),
			);
		}
	}
	return projectionFixture({ movements });
}
