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

/** A named saved row that can identify which model a hook is looking at. */
export interface SavedRowRevision {
	revision: string | null | undefined;
	content: unknown;
}

export type SavedRowName =
	| "balances"
	| "checkpoints"
	| "schedules"
	| "transactions"
	| "evaluations";

/**
 * Fingerprint the saved rows that identify a model in view. A server
 * revision is preferred; without one the row content is serialized. Callers
 * choose their row set: current position omits evaluations, which are
 * backend-owned and must not move its key.
 */
export function savedRowFingerprint(
	rows: Partial<Record<SavedRowName, SavedRowRevision>>,
	options: {
		includeEvaluations?: boolean;
		skipMissingContent?: boolean;
	} = {},
): string {
	const names: SavedRowName[] = [
		"balances",
		"checkpoints",
		"schedules",
		"transactions",
	];
	if (options.includeEvaluations) names.push("evaluations");
	const parts: string[] = [];
	for (const name of names) {
		const row = rows[name];
		if (!row) continue;
		if (row.revision) parts.push(`${name}:${row.revision}`);
		else if (options.skipMissingContent && row.content === undefined) continue;
		else parts.push(`${name}:${JSON.stringify(row.content)}`);
	}
	return parts.join("|");
}

/** Row-backed projections start today unless the caller supplies an explicit
 * start. Historical rows remain available to the server's history replay. */
export function projectionStartDateFromRows(_input: {
	checkpoints: { observedAt: number }[];
	schedules: { startDate: string }[];
	transactions: { startDate: string }[];
}): string {
	return todayIso();
}

/** Saved display start from the narrow row queries. This preserves the
 * established checkpoint/schedule/transaction derivation for account
 * activity filtering, independent of the projection fallback. */
export function savedStartDateFromRows(input: {
	checkpoints: { observedAt: number }[];
	schedules: { startDate: string }[];
	transactions: { startDate: string }[];
}): string {
	const latest = input.checkpoints
		.map((checkpoint) => isoDateFromEpochSeconds(checkpoint.observedAt))
		.sort()
		.at(-1);
	return (
		latest ??
		input.schedules[0]?.startDate ??
		input.transactions[0]?.startDate ??
		todayIso()
	);
}

/**
 * Pre-projection fallback for an override model document. Explicit model
 * fixtures keep their established checkpoint/schedule/transaction derivation;
 * the server milestone is authoritative once a projection result exists.
 */
export function projectionStartDate(model: FinancialModel): string {
	const latest = model.checkpoints
		.map((checkpoint) => isoDateFromEpochSeconds(checkpoint.observedAt))
		.sort()
		.at(-1);
	return (
		latest ??
		model.schedules?.[0]?.startDate ??
		model.transactions
			.map((transaction) =>
				isoDateFromEpochSeconds(
					transaction.transactionTime > 0
						? transaction.transactionTime
						: transaction.postedTime,
				),
			)
			.at(0) ??
		todayIso()
	);
}
