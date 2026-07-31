import type { IsoDate, MovementEvent } from "../types/model";
import type {
	FinancialModel,
	MonteCarloSample,
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
	observePosting(
		postingId: string,
		realizedAmount: number,
		date: IsoDate,
	): void;
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
	monteCarloSample,
}: {
	model: FinancialModel;
	initialState: SimulationState;
	projectionStartDate: IsoDate;
	monteCarloSample?: MonteCarloSample;
}): SimulationTransitionRuntime {
	const state = cloneSimulationState(initialState);
	const accountById = new Map(
		model.accounts.map((account) => [account.id, account]),
	);

	function observePosting(
		postingId: string,
		realizedAmount: number,
		date: IsoDate,
	) {
		state.latestRealizedPostingAmounts.set(postingId, realizedAmount);
		const year = date.slice(0, 4);
		const amountsByYear =
			state.realizedPostingAmountsByYear.get(postingId) ??
			new Map<string, number>();
		amountsByYear.set(year, (amountsByYear.get(year) ?? 0) + realizedAmount);
		state.realizedPostingAmountsByYear.set(postingId, amountsByYear);
	}

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
			if (posting.volatility > 0 && monteCarloSample !== undefined) {
				sampledRate = monteCarloSample.annualRatesByPostingId.get(posting.id)?.[
					yearIndex
				];
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
					state.realizedPostingAmountsByYear,
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

			const transition = applyAndCollectDeltas(result, () => {
				applyPosting(
					posting,
					result.realizedAmount,
					state.balances,
					accountById,
				);
			});
			observePosting(posting.id, result.realizedAmount, date);
			return { ...transition, postingId: posting.id };
		},
		observePosting,
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
