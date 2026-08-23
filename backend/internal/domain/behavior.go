package domain

import ()

// Behavior runtime ported from behavior/runtime.ts: a generic period loop.

// BehaviorPeriod is one monthly evaluation window.
type BehaviorPeriod struct {
	Index     int
	StartDate IsoDate
	EndDate   IsoDate
}

// ReactiveBehavior drives per-period state transitions to a final result.
type ReactiveBehavior[TState any, TResult any] struct {
	Initialize func() TState
	React      func(state *TState, period BehaviorPeriod)
	ShouldStop func(state *TState, period BehaviorPeriod) bool
	Finish     func(state *TState) TResult
}

// RunReactiveBehavior executes the loop with optional early stop.
func RunReactiveBehavior[TState any, TResult any](periods []BehaviorPeriod, behavior ReactiveBehavior[TState, TResult]) TResult {
	state := behavior.Initialize()
	for _, period := range periods {
		behavior.React(&state, period)
		if behavior.ShouldStop != nil && behavior.ShouldStop(&state, period) {
			break
		}
	}
	return behavior.Finish(&state)
}
