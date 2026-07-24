import {
	applyModelOverrides,
	EMPTY_MODEL_OVERRIDES,
} from "../model/applyModelOverrides";
import type {
	FinancialModelDocument,
	IsoDate,
	ModelOverrides,
	ProjectionRuntimeSettings,
} from "../types/model";
import type { MonteCarloSample, PreparedProjection } from "../types/simulation";
import { addYearsClamped, compareIsoDates } from "../utils/date";
import { initAccountBalances, snapshotBalances } from "./accounts";

function prepareCheckpointHistory(document: FinancialModelDocument) {
	const checkpoints = document.checkpoints
		.map((checkpoint, index) => ({ checkpoint, index }))
		.sort(
			(left, right) =>
				compareIsoDates(left.checkpoint.Date, right.checkpoint.Date) ||
				left.index - right.index,
		);
	const groupedByDate = new Map<IsoDate, typeof document.checkpoints>();

	for (const { checkpoint } of checkpoints) {
		const existing = groupedByDate.get(checkpoint.Date);
		if (existing) existing.push(checkpoint);
		else groupedByDate.set(checkpoint.Date, [checkpoint]);
	}

	const balances = initAccountBalances(document.accounts);
	const historicalSnapshots = Array.from(groupedByDate.entries()).map(
		([date, dateCheckpoints]) => {
			for (const checkpoint of dateCheckpoints) {
				balances[checkpoint.AccountId] = checkpoint.Balance;
			}
			return { date, balances: snapshotBalances(balances) };
		},
	);

	return {
		balances,
		historicalSnapshots,
		latestCheckpointDate:
			historicalSnapshots[historicalSnapshots.length - 1]?.date ?? null,
	};
}

export function prepareSimulationRequest(
	document: FinancialModelDocument,
	projectionSettings: ProjectionRuntimeSettings,
	overrides: ModelOverrides = EMPTY_MODEL_OVERRIDES,
	monteCarloSample?: MonteCarloSample,
): PreparedProjection {
	const effectiveDocument = applyModelOverrides(document, overrides);
	const checkpointHistory = prepareCheckpointHistory(effectiveDocument);
	const startDate =
		checkpointHistory.latestCheckpointDate ??
		projectionSettings.fallbackProjectionStartDate;
	return {
		effectiveDocument,
		historicalSnapshots: checkpointHistory.historicalSnapshots,
		latestCheckpointDate: checkpointHistory.latestCheckpointDate,
		request: {
			model: {
				accounts: effectiveDocument.accounts,
				postings: effectiveDocument.postings,
			},
			initialState: {
				balances: snapshotBalances(checkpointHistory.balances),
				latestRealizedPostingAmounts: new Map(),
				realizedPostingAmountsByYear: new Map(),
			},
			startDate,
			endDate: addYearsClamped(startDate, projectionSettings.horizonYears),
			includeStartDateEvents: checkpointHistory.latestCheckpointDate === null,
			monteCarloSample,
		},
	};
}
