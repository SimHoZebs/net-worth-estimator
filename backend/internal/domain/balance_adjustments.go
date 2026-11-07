package domain

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

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
	return position.replay.adjustments, nil
}
