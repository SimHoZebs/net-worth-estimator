import type { MovementEvent } from "../types/scenario";
import type {
	SimulationRequest,
	SimulationRun,
	SimulationState,
} from "../types/simulation";
import { compareIsoDates, projectionYearIndex } from "../utils/date";
import { snapshotBalances } from "./accounts";
import type { DatedPostingOccurrence } from "./postings";
import {
	addOccurrences,
	applyPosting,
	computeRequestedAmount,
	resolvePostingMovement,
} from "./postings";

function cloneState(state: SimulationState): SimulationState {
	return {
		balances: snapshotBalances(state.balances),
		latestRealizedPostingAmounts: new Map(state.latestRealizedPostingAmounts),
		realizedPostingAmountsByYear: new Map(
			Array.from(
				state.realizedPostingAmountsByYear,
				([postingId, amountsByYear]) => [postingId, new Map(amountsByYear)],
			),
		),
	};
}

export function simulate(request: SimulationRequest): SimulationRun {
	const state = cloneState(request.initialState);
	const accountById = new Map(
		request.model.accounts.map((account) => [account.id, account]),
	);
	const latestRealizedPostingAmounts = state.latestRealizedPostingAmounts;
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
		const year = date.slice(0, 4);
		const yearIndex = projectionYearIndex(request.startDate, date);

		for (const occurrence of [...occurrences].sort(
			(left, right) =>
				left.posting.priority - right.posting.priority ||
				left.index - right.index,
		)) {
			const { posting } = occurrence;
			const stochasticRate =
				posting.volatility > 0
					? request.sampledAssumptions?.annualRatesByPostingId.get(
							posting.id,
						)?.[yearIndex]
					: undefined;
			const requestedAmount = Math.max(
				0,
				computeRequestedAmount(
					occurrence,
					date,
					latestRealizedPostingAmounts,
					state.balances,
					stochasticRate,
				),
			);
			const amountsByYear = state.realizedPostingAmountsByYear.get(posting.id);
			const annualCapRemaining =
				posting.annualCap === null
					? Number.POSITIVE_INFINITY
					: Math.max(0, posting.annualCap - (amountsByYear?.get(year) ?? 0));
			const movement = resolvePostingMovement(
				posting,
				requestedAmount,
				annualCapRemaining,
				state.balances,
				accountById,
			);
			if (posting.annualCap !== null) {
				const updatedAmountsByYear = amountsByYear ?? new Map<string, number>();
				updatedAmountsByYear.set(
					year,
					(updatedAmountsByYear.get(year) ?? 0) + movement.realizedAmount,
				);
				state.realizedPostingAmountsByYear.set(
					posting.id,
					updatedAmountsByYear,
				);
			}

			const beforeBalances = snapshotBalances(state.balances);
			applyPosting(
				posting,
				movement.realizedAmount,
				state.balances,
				accountById,
			);
			const accountDeltas: MovementEvent["accountDeltas"] = [];
			for (const [accountId, after] of Object.entries(state.balances)) {
				const before = beforeBalances[accountId] ?? 0;
				if (before !== after) {
					accountDeltas.push({ accountId, delta: after - before });
				}
			}

			movementAttempts.push({
				date,
				sequence: movementSequence++,
				origin: { type: "posting", postingId: posting.id },
				requestedAmount: movement.requestedAmount,
				realizedAmount: movement.realizedAmount,
				bindingConstraints: movement.bindingConstraints,
				accountDeltas,
			});
			latestRealizedPostingAmounts.set(posting.id, movement.realizedAmount);
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
		initialState: cloneState(request.initialState),
		finalState: cloneState(state),
		snapshots,
		movementAttempts,
		sampledAssumptions: request.sampledAssumptions,
	};
}
