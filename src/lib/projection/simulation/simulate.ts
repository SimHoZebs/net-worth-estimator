import type { MovementEvent } from "../types/model";
import type { SimulationRequest, SimulationRun } from "../types/simulation";
import { compareIsoDates } from "../utils/date";
import { snapshotBalances } from "./accounts";
import type { DatedPostingOccurrence } from "./postings";
import { addOccurrences } from "./postings";
import { cloneSimulationState, createTransitionRuntime } from "./transitions";

export function simulate(request: SimulationRequest): SimulationRun {
	const transitions = createTransitionRuntime({
		model: request.model,
		initialState: request.initialState,
		projectionStartDate: request.startDate,
		monteCarloSample: request.monteCarloSample,
	});
	const { state } = transitions;
	const movementAttempts: MovementEvent[] = [];
	const snapshots: SimulationRun["snapshots"] = [];
	const eventDates = new Map<string, DatedPostingOccurrence[]>();
	let movementSequence = 0;

	addOccurrences(
		request.model.postings,
		eventDates,
		request.startDate,
		request.endDate,
		request.includeStartDateEvents,
	);

	for (const date of Array.from(eventDates.keys()).sort(compareIsoDates)) {
		const occurrences = eventDates.get(date);
		if (!occurrences) continue;
		for (const occurrence of [...occurrences].sort(
			(left, right) =>
				left.posting.priority - right.posting.priority ||
				left.index - right.index,
		)) {
			const transition = transitions.executePosting(occurrence, date);

			movementAttempts.push({
				date,
				sequence: movementSequence++,
				origin: { type: "posting", postingId: transition.postingId },
				requestedAmount: transition.result.requestedAmount,
				realizedAmount: transition.result.realizedAmount,
				accountDeltas: transition.accountDeltas,
			});
		}

		snapshots.push({ date, balances: snapshotBalances(state.balances) });
	}

	return {
		request: {
			model: request.model,
			startDate: request.startDate,
			endDate: request.endDate,
			includeStartDateEvents: request.includeStartDateEvents,
		},
		initialState: cloneSimulationState(request.initialState),
		finalState: cloneSimulationState(state),
		snapshots,
		movementAttempts,
		monteCarloSample: request.monteCarloSample,
	};
}
