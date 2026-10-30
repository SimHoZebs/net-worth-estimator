package domain

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

// ResolveCurrentPosition uses the same historical preparation as projections,
// but never simulates future events or executes forecast evaluations.
// asOfDate is a "YYYY-MM-DD" date (legacy day-close cut at the end of that
// UTC day, inclusive, backward compatible) or an RFC 3339 timestamp for an
// exact cut: only events and observations at or before the cut apply, so
// an 11:00 actual never affects a 10:00 balance. Balances are the adjusted
// modeled balances at the cut, with the latest observation and its
// timestamp carried per account, identical to the projection baseline at
// the same cut.
func ResolveCurrentPosition(model *types.FinancialModel, asOfDate string, overrides types.ModelOverrides) (*types.CurrentPosition, error) {
	cutInstant, cutDay, err := ParseAsOfCut(asOfDate)
	if err != nil {
		return nil, &SimulationPreparationError{Issues: []types.ModelValidationIssue{{
			Severity: types.SeverityError,
			Code:     "settings.projection-start.format",
			Message:  err.Error(),
			Path:     []any{"asOfDate"},
		}}}
	}
	position, err := preparePositionAt(model, cutDay, cutInstant, overrides)
	if err != nil {
		return nil, err
	}
	result := &types.CurrentPosition{
		AsOfDate: asOfDate,
		NetWorth: roundCurrency(ComputeNetWorth(position.state.Balances, position.model.Accounts)),
		Accounts: make([]types.PositionAccount, 0, len(position.model.Accounts)),
	}
	for _, account := range position.model.Accounts {
		row := types.PositionAccount{
			AccountID: account.ID,
			Balance:   roundCurrency(position.state.Balances[account.ID]),
		}
		if observed, ok := position.replay.latestObserved[account.ID]; ok {
			observedBalance := observed.Balance
			observedInstant := CheckpointInstant(observed)
			row.ObservedBalance = &observedBalance
			row.ObservedAt = &observedInstant
		}
		result.Accounts = append(result.Accounts, row)
	}
	return result, nil
}
