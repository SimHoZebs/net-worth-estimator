package domain

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Account balance evaluation. It answers whether one named account reached
// its own target, which is a different question from a net worth threshold: a
// household can clear a net worth target while holding no liquid reserve, and
// can hold a full reserve while net worth is negative.

// AccountBalancePathResult is the deterministic result shape.
type AccountBalancePathResult struct {
	Reached          bool    `json:"reached"`
	FirstReachedDate *string `json:"firstReachedDate"`
}

func (r *AccountBalancePathResult) ToJSON() types.JsonValue {
	return map[string]any{
		"reached":          r.Reached,
		"firstReachedDate": r.FirstReachedDate,
	}
}

// AccountBalanceProbabilisticResult is the stochastic result shape.
type AccountBalanceProbabilisticResult struct {
	Probability       float64 `json:"probability"`
	P10ReachedDate    *string `json:"p10ReachedDate"`
	MedianReachedDate *string `json:"medianReachedDate"`
	P90ReachedDate    *string `json:"p90ReachedDate"`
}

// EvaluateAccountBalance finds the first projected date at which the named
// account's own balance reaches target. Rows where the account is absent are
// skipped rather than treated as zero, so a disabled or removed account cannot
// report a spurious first crossing.
func EvaluateAccountBalance(path *types.ProjectionPath, accountID string, target float64) AccountBalancePathResult {
	firstReachedDate := (*string)(nil)
	// Snapshots are built in effective-model account order, so resolve the
	// expected position once and probe it per row (O(R+A)) instead of scanning
	// every row (O(R*A)). Fall back to a scan when shapes diverge.
	accountIndex := -1
	for index, account := range path.EffectiveModel.Accounts {
		if account.ID == accountID {
			accountIndex = index
			break
		}
	}
	for index := range path.Rows {
		row := &path.Rows[index]
		if row.IsHistorical {
			continue
		}
		var balance float64
		var ok bool
		if accountIndex >= 0 && accountIndex < len(row.AccountSnapshots) &&
			row.AccountSnapshots[accountIndex].AccountID == accountID {
			balance, ok = row.AccountSnapshots[accountIndex].Balance, true
		} else {
			balance, ok = accountBalanceInRow(row, accountID)
		}
		if !ok || balance < target {
			continue
		}
		date := row.Date
		firstReachedDate = &date
		break
	}
	return AccountBalancePathResult{
		Reached:          firstReachedDate != nil,
		FirstReachedDate: firstReachedDate,
	}
}

func accountBalanceInRow(row *types.ProjectionRow, accountID string) (float64, bool) {
	for _, snapshot := range row.AccountSnapshots {
		if snapshot.AccountID == accountID {
			return snapshot.Balance, true
		}
	}
	return 0, false
}

func (r *AccountBalancePathResult) firstReached() *string { return r.FirstReachedDate }

var accountBalanceDefinition = NewReachedDateReader(
	types.EvaluationTypeAccountBalance,
	"Account balance",
	ValidateAccountBalanceConfig,
	func(config any) (any, error) {
		parsed, err := ParseAccountBalanceConfig(config)
		if err != nil {
			return nil, err
		}
		return parsed, nil
	},
	func(ctx *EvaluationContext, config any) (PathResult, error) {
		typed := config.(types.AccountBalanceConfig)
		result := EvaluateAccountBalance(ctx.Path, typed.AccountID, typed.Target)
		return &result, nil
	},
	func(deterministic PathResult) bool {
		return deterministic.(*AccountBalancePathResult).Reached
	},
)
