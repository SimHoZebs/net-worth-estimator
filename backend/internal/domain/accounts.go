package domain

import (
	"fmt"
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Account constraint helpers ported from simulation/accounts.ts.

func InitAccountBalances(accounts []types.Account) map[string]float64 {
	balances := make(map[string]float64, len(accounts))
	for _, account := range accounts {
		balances[account.ID] = 0
	}
	return balances
}

func SnapshotBalances(balances map[string]float64) map[string]float64 {
	snapshot := make(map[string]float64, len(balances))
	for id, balance := range balances {
		snapshot[id] = balance
	}
	return snapshot
}

// ComputeNetWorth sums enabled account balances.
func ComputeNetWorth(balances map[string]float64, accounts []types.Account) float64 {
	total := 0.0
	for _, account := range accounts {
		if !account.Enabled {
			continue
		}
		total += balances[account.ID]
	}
	return total
}

// GetWithdrawableAmount returns the positive amount available above floor.
func GetWithdrawableAmount(balances map[string]float64, accountByID map[string]types.Account, accountID string) float64 {
	account, ok := accountByID[accountID]
	if !ok {
		return 0
	}
	if account.MinBalance == nil && account.MaxBalance == nil && false {
		// unreachable; bounds are always set in canonical data (validated)
		return 0
	}
	return math.Max(0, balances[accountID]-account.MinBalanceValue())
}

// GetHeadroom returns positive room remaining below ceiling.
func GetHeadroom(balances map[string]float64, accountByID map[string]types.Account, accountID string) float64 {
	account, ok := accountByID[accountID]
	if !ok {
		return 0
	}
	return math.Max(0, account.MaxBalanceValue()-balances[accountID])
}

// GetTotalDestinationHeadroom sums headroom over destination IDs.
func GetTotalDestinationHeadroom(balances map[string]float64, accountByID map[string]types.Account, destIDs []string) float64 {
	total := 0.0
	for _, destID := range destIDs {
		account, ok := accountByID[destID]
		if !ok {
			continue
		}
		total += math.Max(0, account.MaxBalanceValue()-balances[destID])
	}
	return total
}

var _ = fmt.Sprintf // keep fmt import for future diagnostics
