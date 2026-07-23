import { initAccountBalances, snapshotBalances } from "../simulation/accounts";
import type {
	FinancialModelDocument,
	IsoDate,
	ProjectionRuntimeSettings,
	ScenarioOverrides,
} from "../types/scenario";
import type {
	PreparedProjection,
	SampledAssumptions,
} from "../types/simulation";
import { addYearsClamped, compareIsoDates } from "../utils/date";
import {
	applyScenarioOverrides,
	EMPTY_SCENARIO_OVERRIDES,
} from "./prepareScenario";

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
	overrides: ScenarioOverrides = EMPTY_SCENARIO_OVERRIDES,
	annualRatesByPostingId?: ReadonlyMap<string, readonly number[]>,
): PreparedProjection {
	const effectiveDocument = applyScenarioOverrides(document, overrides);
	const checkpointHistory = prepareCheckpointHistory(effectiveDocument);
	const startDate =
		checkpointHistory.latestCheckpointDate ??
		projectionSettings.fallbackProjectionStartDate;
	const sampledAssumptions: SampledAssumptions | undefined =
		annualRatesByPostingId === undefined
			? undefined
			: { annualRatesByPostingId };

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
			sampledAssumptions,
		},
	};
}
