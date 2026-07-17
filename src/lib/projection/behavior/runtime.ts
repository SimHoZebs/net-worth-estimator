import type { IsoDate } from "../types/scenario";

export interface BehaviorPeriod {
	index: number;
	startDate: IsoDate;
	endDate: IsoDate;
}

export interface ReactiveBehavior<TState, TResult> {
	initialize(): TState;
	react(state: TState, period: BehaviorPeriod): void;
	finish(state: TState): TResult;
}

export function runReactiveBehavior<TState, TResult>(
	periods: readonly BehaviorPeriod[],
	behavior: ReactiveBehavior<TState, TResult>,
): TResult {
	const state = behavior.initialize();
	for (const period of periods) behavior.react(state, period);
	return behavior.finish(state);
}
