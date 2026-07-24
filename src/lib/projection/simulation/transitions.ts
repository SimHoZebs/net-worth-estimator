import type { IsoDate, MovementEvent } from "../types/scenario";
import type {
	FinancialModel,
	SampledAssumptions,
	SimulationState,
} from "../types/simulation";
import { projectionYearIndex } from "../utils/date";
import { snapshotBalances } from "./accounts";
import type {
	AccountMovementAction,
	AccountMovementResult,
	DatedPostingOccurrence,
} from "./postings";
import {
	applyAccountMovement,
	applyPosting,
	computeRequestedAmount,
	resolveAccountMovement,
	resolvePostingMovement,
} from "./postings";

export interface AppliedMovementTransition {
	result: AccountMovementResult;
	accountDeltas: MovementEvent["accountDeltas"];
}

export interface PostingExecutionTransition extends AppliedMovementTransition {
	postingId: string;
}

export interface SimulationTransitionRuntime {
	readonly state: SimulationState;
	executePosting(
		occurrence: DatedPostingOccurrence,
		date: IsoDate,
	): PostingExecutionTransition;
	observePosting(postingId: string, realizedAmount: number): void;
	executeGeneratedMovement(
		action: AccountMovementAction,
	): AppliedMovementTransition;
}

export function cloneSimulationState(state: SimulationState): SimulationState {
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

export function createTransitionRuntime({
	model,
	initialState,
	projectionStartDate,
	sampledAssumptions,
}: {
	model: FinancialModel;
	initialState: SimulationState;
	projectionStartDate: IsoDate;
	sampledAssumptions?: SampledAssumptions;
}): SimulationTransitionRuntime {
	const state = cloneSimulationState(initialState);
	const accountById = new Map(
		model.accounts.map((account) => [account.id, account]),
	);

	function applyAndCollectDeltas(
		result: AccountMovementResult,
		apply: () => void,
	): AppliedMovementTransition {
		const beforeBalances = snapshotBalances(state.balances);
		apply();
		const accountDeltas: MovementEvent["accountDeltas"] = [];
		for (const [accountId, after] of Object.entries(state.balances)) {
			const before = beforeBalances[accountId] ?? 0;
			if (before !== after) {
				accountDeltas.push({ accountId, delta: after - before });
			}
		}
		return { result, accountDeltas };
	}

	return {
		state,
		executePosting(occurrence, date) {
			const { posting } = occurrence;
			const yearIndex = projectionYearIndex(projectionStartDate, date);
			let sampledRate: number | undefined;
			if (posting.volatility > 0 && sampledAssumptions !== undefined) {
				sampledRate = sampledAssumptions.annualRatesByPostingId.get(
					posting.id,
				)?.[yearIndex];
				if (sampledRate === undefined) {
					throw new Error(
						`Missing sampled annual rate for posting "${posting.id}" in projection year ${yearIndex}.`,
					);
				}
			}
			const requestedAmount = Math.max(
				0,
				computeRequestedAmount(
					occurrence,
					date,
					state.latestRealizedPostingAmounts,
					state.balances,
					sampledRate,
				),
			);
			const year = date.slice(0, 4);
			const amountsByYear = state.realizedPostingAmountsByYear.get(posting.id);
			const annualCapRemaining =
				posting.annualCap === null
					? Number.POSITIVE_INFINITY
					: Math.max(0, posting.annualCap - (amountsByYear?.get(year) ?? 0));
			const result = resolvePostingMovement(
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
					(updatedAmountsByYear.get(year) ?? 0) + result.realizedAmount,
				);
				state.realizedPostingAmountsByYear.set(
					posting.id,
					updatedAmountsByYear,
				);
			}

			const transition = applyAndCollectDeltas(result, () => {
				applyPosting(
					posting,
					result.realizedAmount,
					state.balances,
					accountById,
				);
			});
			state.latestRealizedPostingAmounts.set(posting.id, result.realizedAmount);
			return { ...transition, postingId: posting.id };
		},
		observePosting(postingId, realizedAmount) {
			state.latestRealizedPostingAmounts.set(postingId, realizedAmount);
		},
		executeGeneratedMovement(action) {
			const result = resolveAccountMovement(
				action,
				state.balances,
				accountById,
			);
			return applyAndCollectDeltas(result, () => {
				applyAccountMovement(
					action,
					result.realizedAmount,
					state.balances,
					accountById,
				);
			});
		},
	};
}
