import type {
	BackendPlannedPurchase,
	EvaluationTables,
	FinancialModel,
} from "../api/contracts.ts";
import { todayIso } from "../domain/format.ts";
import { projectionStartDate } from "./projectionStartDate.ts";

/**
 * Everything the projection layer needs to build a request and map a
 * result. It is a set of narrow row slices, not the canonical model
 * document. The same shape is derived from a model in tests and fixtures.
 */
export interface ProjectionSource {
	revision: string;
	startDate: string;
	accounts: { id: string; name: string }[];
	postings: {
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
		postingFulfillment: evaluations?.postingFulfillment ?? [],
		cycleFulfillment: evaluations?.cycleFulfillment ?? [],
		plannedPurchases: evaluations?.plannedPurchases ?? [],
	};
}

/** Test and fixture adapter. Production reads the row queries instead. */
export function projectionSourceFromModel(
	model: FinancialModel | null,
	revision = "",
): ProjectionSource | null {
	if (!model) return null;
	return {
		revision,
		startDate: projectionStartDate(model),
		accounts: model.accounts.map((account) => ({
			id: account.id,
			name: account.name,
		})),
		postings: model.postings.map((posting) => ({
			id: posting.id,
			name: posting.name,
			sourceAccountId: posting.sourceAccountId,
			destinations: posting.destinations,
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
		.map((checkpoint) =>
			new Date(checkpoint.observedAt * 1000).toISOString().slice(0, 10),
		)
		.sort()
		.at(-1);
	return (
		latest ??
		schedules[0]?.startDate ??
		transactions[0]?.startDate ??
		todayIso()
	);
}
