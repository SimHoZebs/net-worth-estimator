package domain

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

// ObservationKey identifies one checkpoint by account and exact instant.
type ObservationKey struct {
	AccountID  string
	ObservedAt int64
}

// NoopCheckpointKeys returns checkpoints whose raw recorded balance matches
// the actual-only balance immediately before their reset (within float
// tolerance). Persistence uses this exact set so a sub-dollar balance change
// is not mistaken for a no-op.
func NoopCheckpointKeys(model *types.FinancialModel, asOf string) (map[ObservationKey]struct{}, error) {
	instant, day, err := ParseAsOfCut(asOf)
	if err != nil {
		return nil, err
	}
	position, err := prepareFinancePositionAt(model, day, instant, types.ModelOverrides{})
	if err != nil {
		return nil, err
	}
	return position.appliedHistory.noopCheckpointKeys, nil
}
