import type {
	BackendPlannedPurchase,
	EvaluationTables,
	FinancialModel,
} from "../api/contracts.ts";
import { isoDateFromEpochSeconds, todayIso } from "../domain/format.ts";

/**
 * Everything the projection layer needs to build a request and map a
 * result. It is a set of narrow row slices, not the canonical model
 * document. The same shape is derived from a model in tests and fixtures.
 */
export interface ProjectionSource {
	revision: string;
	startDate: string;
	accounts: { id: string; name: string }[];
	transactions: {
		id: string;
		name: string;
		sourceAccountId: string | null;
		destinations: string[] | null;
	}[];
	schedules: {
		id: string;
		name: string;
		sourceAccountId: string | null;
		destinations: string[] | null;
		startDate: string;
	}[];
	plannedPurchases: BackendPlannedPurchase[];
	checkpoints: { observedAt: number }[];
	evaluations: EvaluationTables;
}

/** Fill optional evaluation tables so the projection contract is complete. */
export function normalizedEvaluations(
	evaluations: EvaluationTables | undefined,
): EvaluationTables {
	return {
		...evaluations,
		financialIndependence: evaluations?.financialIndependence ?? [],
		netWorthThreshold: evaluations?.netWorthThreshold ?? [],
		accountBalance: evaluations?.accountBalance ?? [],
		transactionFulfillment: evaluations?.transactionFulfillment ?? [],
		cycleFulfillment: evaluations?.cycleFulfillment ?? [],
		plannedPurchases: evaluations?.plannedPurchases ?? [],
	};
}

/** Test and fixture adapter. Production reads the row queries instead. */
export function projectionSourceFromModel(
	model: FinancialModel | null,
	revision?: string,
): ProjectionSource | null {
	if (!model) return null;
	return {
		revision: revision ?? "",
		startDate: projectionStartDate(model),
		accounts: model.accounts.map((account) => ({
			id: account.id,
			name: account.name,
		})),
		transactions: model.transactions.map((transaction) => ({
			id: transaction.id,
			name: transaction.name,
			sourceAccountId: transaction.sourceAccountId,
			destinations: transaction.destinations,
		})),
		schedules: model.schedules.map((schedule) => ({
			id: schedule.id,
			name: schedule.name,
			sourceAccountId: schedule.sourceAccountId,
			destinations: schedule.destinations,
			startDate: schedule.startDate,
		})),
		plannedPurchases: model.plannedPurchases ?? [],
		checkpoints: model.checkpoints,
		evaluations: normalizedEvaluations(model.evaluations),
	};
}

/** Latest checkpoint, else first schedule, else first transaction, else today. */
export function projectionStartDateFromRows({
	checkpoints,
	schedules,
	transactions,
}: {
	checkpoints: { observedAt: number }[];
	schedules: { startDate: string }[];
	transactions: { startDate: string }[];
}): string {
	const latest = checkpoints
		.map((checkpoint) => isoDateFromEpochSeconds(checkpoint.observedAt))
		.sort()
		.at(-1);
	return (
		latest ??
		schedules[0]?.startDate ??
		transactions[0]?.startDate ??
		todayIso()
	);
}

/**
 * Pre-projection fallback for a model document (fixtures and overrides).
 * The server milestone (ProjectionMilestones.projectionStartDate) is the
 * authority once a projection result exists; this helper only supplies the
 * fallback start before the first result, with today for empty fixtures.
 */
export function projectionStartDate(model: FinancialModel): string {
	return projectionStartDateFromRows({
		checkpoints: model.checkpoints,
		schedules: model.schedules ?? [],
		transactions: model.transactions.map((transaction) => ({
			startDate: isoDateFromEpochSeconds(
				transaction.transactionTime > 0
					? transaction.transactionTime
					: transaction.postedTime,
			),
		})),
	});
}
