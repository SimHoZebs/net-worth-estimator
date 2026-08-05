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
import { addOccurrences, type DatedPostingOccurrence } from "./postings";
import { createTransitionRuntime } from "./transitions";

export class SimulationPreparationError extends Error {
	constructor(public readonly issues: ModelValidationIssue[]) {
		super(
			`Cannot prepare an invalid financial model: ${issues.map((issue) => issue.message).join(" ")}`,
		);
		this.name = "SimulationPreparationError";
	}
}

function replayHistoricalState(
	document: FinancialModelDocument,
	projectionStartDate: IsoDate,
	incomeData?: IncomeDataSnapshot,
) {
	const futureCheckpoint = document.checkpoints.find(
		(checkpoint) => compareIsoDates(checkpoint.Date, projectionStartDate) > 0,
	);
	if (futureCheckpoint) {
		throw new SimulationPreparationError([
			{
				severity: "error",
				code: "checkpoint.date.future",
				message: `Checkpoint for '${futureCheckpoint.AccountId}' is dated after the projection start (${futureCheckpoint.Date}).`,
				path: ["checkpoints"],
			},
		]);
	}

	const checkpointsByDate = new Map<IsoDate, typeof document.checkpoints>();
	for (const checkpoint of document.checkpoints) {
		const checkpoints = checkpointsByDate.get(checkpoint.Date) ?? [];
		checkpoints.push(checkpoint);
		checkpointsByDate.set(checkpoint.Date, checkpoints);
	}
	const hasStartDateCheckpoint = checkpointsByDate.has(projectionStartDate);
	const occurrencesByDate = new Map<IsoDate, DatedPostingOccurrence[]>();

	document.postings.forEach((posting, index) => {
		if (
			posting.enabled &&
			posting.frequency === "once" &&
			(compareIsoDates(posting.startDate, projectionStartDate) < 0 ||
				(hasStartDateCheckpoint && posting.startDate === projectionStartDate))
		) {
			const occurrences = occurrencesByDate.get(posting.startDate) ?? [];
			occurrences.push({ posting, index });
			occurrencesByDate.set(posting.startDate, occurrences);
		}
	});

	const earliestCheckpointDate = document.checkpoints.reduce<IsoDate | null>(
		(earliest, checkpoint) =>
			earliest === null || compareIsoDates(checkpoint.Date, earliest) < 0
				? checkpoint.Date
				: earliest,
		null,
	);
	if (earliestCheckpointDate !== null) {
		const recurringPostings = document.postings.filter(
			(posting) => posting.frequency !== "once",
		);
		const recurringOccurrencesByDate = new Map<
			IsoDate,
			DatedPostingOccurrence[]
		>();
		addOccurrences(
			recurringPostings,
			recurringOccurrencesByDate,
			earliestCheckpointDate,
			projectionStartDate,
			true,
		);
		for (const [date, recurringOccurrences] of recurringOccurrencesByDate) {
			if (!hasStartDateCheckpoint && date === projectionStartDate) continue;
			const occurrences = occurrencesByDate.get(date) ?? [];
			occurrences.push(
				...recurringOccurrences.map((occurrence) => ({
					...occurrence,
					index: document.postings.indexOf(occurrence.posting),
				})),
			);
			occurrencesByDate.set(date, occurrences);
		}
	}

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
	const historicalDates = new Set([
		...occurrencesByDate.keys(),
		...checkpointsByDate.keys(),
	]);

	for (const date of [...historicalDates].sort(compareIsoDates)) {
		const occurrences = occurrencesByDate.get(date) ?? [];
		occurrences.sort(
			(left, right) =>
				left.posting.priority - right.posting.priority ||
				left.index - right.index,
		);
		for (const occurrence of occurrences) {
			try {
				transitions.executePosting(occurrence, date);
			} catch (error) {
				throw new SimulationPreparationError([
					{
						severity: "error",
						code: "posting.history.execution",
						message: `Could not replay posting '${occurrence.posting.id}' on ${date}: ${error instanceof Error ? error.message : "Unknown error"}`,
						path: ["postings", occurrence.index],
					},
				]);
			}
		}

		const checkpointCorrections = (checkpointsByDate.get(date) ?? []).map(
			(checkpoint) => {
				const modeledBalance =
					transitions.state.balances[checkpoint.AccountId] ?? 0;
				transitions.state.balances[checkpoint.AccountId] = checkpoint.Balance;
				return {
					accountId: checkpoint.AccountId,
					observedBalance: checkpoint.Balance,
					modeledBalance,
					adjustment: checkpoint.Balance - modeledBalance,
				};
			},
		);
		historicalSnapshots.push({
			date,
			balances: snapshotBalances(transitions.state.balances),
			...(checkpointCorrections.length > 0 ? { checkpointCorrections } : {}),
		});
	}

	return {
		state: transitions.state,
		historicalSnapshots,
		includeStartDateEvents: !hasStartDateCheckpoint,
	};
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
	const history = replayHistoricalState(
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
			includeStartDateEvents: history.includeStartDateEvents,
			monteCarloSample,
			incomeData,
		},
	};
}
