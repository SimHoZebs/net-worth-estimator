package domain

import "github.com/simhozebs/net-worth-estimator/backend/internal/types"

// ResolveCurrentPosition uses the same historical preparation as projections,
// but never simulates future events or executes forecast evaluations.
func ResolveCurrentPosition(document *types.FinancialModelDocument, asOfDate string, overrides types.ModelOverrides) (*types.CurrentPosition, error) {
	position, err := preparePosition(document, asOfDate, overrides)
	if err != nil {
		return nil, err
	}
	result := &types.CurrentPosition{
		AsOfDate: asOfDate,
		NetWorth: roundCurrency(ComputeNetWorth(position.state.Balances, position.document.Accounts)),
		Accounts: make([]types.PositionAccount, 0, len(position.document.Accounts)),
	}
	for _, account := range position.document.Accounts {
		result.Accounts = append(result.Accounts, types.PositionAccount{
			AccountID: account.ID,
			Balance:   roundCurrency(position.state.Balances[account.ID]),
		})
	}
	return result, nil
}
