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
	for index := range path.Rows {
		row := &path.Rows[index]
		if row.IsHistorical {
			continue
		}
		balance, ok := accountBalanceInRow(row, accountID)
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

var accountBalanceDefinition = &EvaluationDefinition{
	Type:  types.EvaluationTypeAccountBalance,
	Label: "Account balance",

	ValidateConfig: ValidateAccountBalanceConfig,
	ParseConfig: func(config any) (any, error) {
		parsed, err := ParseAccountBalanceConfig(config)
		if err != nil {
			return nil, err
		}
		return parsed, nil
	},

	EvaluatePath: func(ctx *EvaluationContext, config any) (PathResult, error) {
		typed := config.(types.AccountBalanceConfig)
		result := EvaluateAccountBalance(ctx.Path, typed.AccountID, typed.Target)
		return &result, nil
	},

	// Threshold and account balance goals aggregate identically, so they share
	// the accumulator, the fold, and the finalize step.
	CreateAccumulator: func(config any, deterministic PathResult) (Accumulator, error) {
		return &thresholdAccumulator{reachedDates: []string{}}, nil
	},
	Accumulate: accumulateReachedDate,
	Finalize: func(accumulator Accumulator, ctx *EvaluationFinalizeContext) (types.JsonValue, error) {
		return finalizeReachedDates(accumulator.(*thresholdAccumulator)), nil
	},
	Status: func(deterministic PathResult, probabilistic types.JsonValue) types.EvaluationResultStatus {
		if probabilistic != nil {
			probability, _ := probabilistic.(map[string]any)["probability"].(float64)
			if probability >= 0.5 {
				return types.StatusSatisfied
			}
			return types.StatusNotSatisfied
		}
		if deterministic != nil && deterministic.(*AccountBalancePathResult).Reached {
			return types.StatusSatisfied
		}
		return types.StatusNotSatisfied
	},
}
