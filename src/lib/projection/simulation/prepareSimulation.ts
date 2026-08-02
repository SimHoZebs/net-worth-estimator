import {
	applyModelOverrides,
	EMPTY_MODEL_OVERRIDES,
} from "../model/applyModelOverrides";
import type { IncomeDataSnapshot } from "../types/income";
import type {
	FinancialModelDocument,
	IsoDate,
	ModelOverrides,
	ProjectionRuntimeSettings,
} from "../types/model";
import type { MonteCarloSample, PreparedProjection } from "../types/simulation";
import type { ModelValidationIssue } from "../types/validation";
import { addYearsClamped, compareIsoDates } from "../utils/date";
import { validateFinancialModel } from "../validation/validateFinancialModel";
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
	incomeData?: IncomeDataSnapshot,
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
		incomeData,
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
	incomeData?: IncomeDataSnapshot,
): PreparedProjection {
	const effectiveDocument = applyModelOverrides(document, overrides);
	if (
		effectiveDocument.postings.some(
			(posting) => posting.enabled && posting.amount.resolver === "income",
		) &&
		!incomeData
	) {
		throw new SimulationPreparationError([
			{
				severity: "error",
				code: "income-data.missing",
				message: "Income data is required to project an income posting.",
				path: [],
			},
		]);
	}
	const validationErrors = validateFinancialModel(effectiveDocument, {
		incomeData,
	}).filter((issue) => issue.severity === "error");
	if (validationErrors.length > 0)
		throw new SimulationPreparationError(validationErrors);
	const startDate = projectionSettings.fallbackProjectionStartDate;
	const history = replayHistoricalPostings(
		effectiveDocument,
		startDate,
		incomeData,
	);
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
			incomeData,
		},
	};
}
