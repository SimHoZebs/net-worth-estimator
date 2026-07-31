import {
	applyModelOverrides,
	EMPTY_MODEL_OVERRIDES,
} from "../model/applyModelOverrides";
import { validateCsvFinancialModel } from "../sources/csv/csvValidation";
import type {
	FinancialModelDocument,
	IsoDate,
	ModelOverrides,
	ProjectionRuntimeSettings,
} from "../types/model";
import type { MonteCarloSample, PreparedProjection } from "../types/simulation";
import type { ModelValidationIssue } from "../types/validation";
import { addYearsClamped, compareIsoDates } from "../utils/date";
import { initAccountBalances, snapshotBalances } from "./accounts";
import type { DatedPostingOccurrence } from "./postings";
import { createTransitionRuntime } from "./transitions";

export class SimulationPreparationError extends Error {
	constructor(public readonly issues: ModelValidationIssue[]) {
		super(
			`Cannot prepare an invalid financial model: ${issues.map((issue) => issue.message).join(" ")}`,
		);
		this.name = "SimulationPreparationError";
	}
}

function replayHistoricalPostings(
	document: FinancialModelDocument,
	projectionStartDate: IsoDate,
) {
	const occurrences = document.postings
		.map((posting, index): DatedPostingOccurrence => ({ posting, index }))
		.filter(
			({ posting }) =>
				posting.enabled &&
				posting.frequency === "once" &&
				compareIsoDates(posting.startDate, projectionStartDate) < 0,
		)
		.sort(
			(left, right) =>
				compareIsoDates(left.posting.startDate, right.posting.startDate) ||
				left.posting.priority - right.posting.priority ||
				left.index - right.index,
		);
	const transitions = createTransitionRuntime({
		model: { accounts: document.accounts, postings: document.postings },
		initialState: {
			balances: initAccountBalances(document.accounts),
			latestRealizedPostingAmounts: new Map(),
			realizedPostingAmountsByYear: new Map(),
		},
		projectionStartDate,
	});
	const historicalSnapshots: PreparedProjection["historicalSnapshots"] = [];

	for (const [index, occurrence] of occurrences.entries()) {
		const date = occurrence.posting.startDate;
		transitions.executePosting(occurrence, date);
		if (occurrences[index + 1]?.posting.startDate !== date) {
			historicalSnapshots.push({
				date,
				balances: snapshotBalances(transitions.state.balances),
			});
		}
	}

	return { state: transitions.state, historicalSnapshots };
}

export function prepareSimulationRequest(
	document: FinancialModelDocument,
	projectionSettings: ProjectionRuntimeSettings,
	overrides: ModelOverrides = EMPTY_MODEL_OVERRIDES,
	monteCarloSample?: MonteCarloSample,
): PreparedProjection {
	const effectiveDocument = applyModelOverrides(document, overrides);
	const validationErrors = validateCsvFinancialModel(effectiveDocument).filter(
		(issue) => issue.severity === "error",
	);
	if (validationErrors.length > 0)
		throw new SimulationPreparationError(validationErrors);
	const startDate = projectionSettings.fallbackProjectionStartDate;
	const history = replayHistoricalPostings(effectiveDocument, startDate);
	return {
		effectiveDocument,
		historicalSnapshots: history.historicalSnapshots,
		request: {
			model: {
				accounts: effectiveDocument.accounts,
				postings: effectiveDocument.postings,
			},
			initialState: history.state,
			startDate,
			endDate: addYearsClamped(startDate, projectionSettings.horizonYears),
			includeStartDateEvents: true,
			monteCarloSample,
		},
	};
}
