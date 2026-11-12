package domain

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

// ObservationKey identifies one checkpoint by account and exact instant.
type ObservationKey struct {
	AccountID  string
	ObservedAt int64
}

// ZeroDeltaObservations returns the observations whose raw recorded balance
// matched the modeled balance at their instant (within float tolerance).
// Persistence uses this exact set so a sub-dollar correction is not mistaken
// for a no-op; the activity feed uses the rounded adjustment view instead.
func ZeroDeltaObservations(model *types.FinancialModel, asOf string) (map[ObservationKey]struct{}, error) {
	instant, day, err := ParseAsOfCut(asOf)
	if err != nil {
		return nil, err
	}
	position, err := prepareFinancePositionAt(model, day, instant, types.ModelOverrides{})
	if err != nil {
		return nil, err
	}
	return position.replay.zeroDeltaObservations, nil
}

// ResolveBalanceAdjustments uses the same finance-only replay as current
// balances. No forecast evaluation or future simulation runs.
func ResolveBalanceAdjustments(model *types.FinancialModel, asOf string) ([]types.BalanceAdjustment, error) {
	instant, day, err := ParseAsOfCut(asOf)
	if err != nil {
		return nil, err
	}
	position, err := prepareFinancePositionAt(model, day, instant, types.ModelOverrides{})
	if err != nil {
		return nil, err
	}
	// A zero-delta observation still applies to state and remains the
	// account's latest observation, but it reconciles nothing, so it
	// produces no adjustment row.
	rows := make([]types.BalanceAdjustment, 0, len(position.replay.adjustments))
	for _, row := range position.replay.adjustments {
		if row.Adjustment != 0 {
			rows = append(rows, row)
		}
	}
	return rows, nil
}
