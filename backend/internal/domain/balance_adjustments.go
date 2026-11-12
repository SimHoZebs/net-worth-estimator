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
