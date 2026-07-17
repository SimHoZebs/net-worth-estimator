import type { IsoDate } from "../types/scenario";

export interface PolicyPeriod {
	index: number;
	startDate: IsoDate;
	endDate: IsoDate;
}

export interface ReactivePolicy<TState, TResult> {
	initialize(): TState;
	react(state: TState, period: PolicyPeriod): void;
	finish(state: TState): TResult;
}

export function runReactivePolicy<TState, TResult>(
	periods: readonly PolicyPeriod[],
	policy: ReactivePolicy<TState, TResult>,
): TResult {
	const state = policy.initialize();
	for (const period of periods) policy.react(state, period);
	return policy.finish(state);
}
