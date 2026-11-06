package domain

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Shared state transitions; Go is the owner and single semantic source for
// transaction execution across deterministic, branch (FI), and Monte Carlo runs.

// AppliedTransactionTransition carries a transaction result plus per-account deltas.
type AppliedTransactionTransition struct {
	Result        AccountTransactionResult
	AccountDeltas []AccountDeltaEntry
}

// TransactionExecutionTransition extends AppliedTransactionTransition for transactions.
type TransactionExecutionTransition struct {
	AppliedTransactionTransition
	TransactionID string
}

// AccountDeltaEntry is one account balance change.
type AccountDeltaEntry struct {
	AccountID string
	Delta     float64
}

// collectDeltasInOrder emits changed accounts in model declaration order,
// with any extras appended sorted.
func collectDeltasInOrder(before, after map[string]float64, order []string) []AccountDeltaEntry {
	seen := map[string]bool{}
	deltas := []AccountDeltaEntry{}
	emit := func(id string) {
		if seen[id] {
			return
		}
		seen[id] = true
		was := before[id]
		delta := after[id] - was
		if delta != 0 {
			deltas = append(deltas, AccountDeltaEntry{AccountID: id, Delta: delta})
		}
	}
	for _, id := range order {
		if _, ok := after[id]; ok {
			emit(id)
		}
	}
	extraIDs := make([]string, 0, len(after))
	for id := range after {
		if !seen[id] {
			extraIDs = append(extraIDs, id)
		}
	}
	sortStrings(extraIDs)
	for _, id := range extraIDs {
		emit(id)
	}
	return deltas
}

// SimulationState is the backend state type with owned maps.
type SimulationState = types.SimulationState

// CloneSimulationState deep-copies balances and realized amount maps.
func CloneSimulationState(state SimulationState) SimulationState {
	cloned := SimulationState{
		Balances:                         SnapshotBalances(state.Balances),
		LatestRealizedTransactionAmounts: make(map[string]float64, len(state.LatestRealizedTransactionAmounts)),
		LatestRealizedTransactionDates:   make(map[string]string, len(state.LatestRealizedTransactionDates)),
		RealizedTransactionAmountsByYear: make(map[string]map[string]float64, len(state.RealizedTransactionAmountsByYear)),
	}
	for id, amount := range state.LatestRealizedTransactionAmounts {
		cloned.LatestRealizedTransactionAmounts[id] = amount
	}
	for id, date := range state.LatestRealizedTransactionDates {
		cloned.LatestRealizedTransactionDates[id] = date
	}
	for transactionID, byYear := range state.RealizedTransactionAmountsByYear {
		years := make(map[string]float64, len(byYear))
		for year, amount := range byYear {
			years[year] = amount
		}
		cloned.RealizedTransactionAmountsByYear[transactionID] = years
	}
	return cloned
}

// TransitionRuntime executes transactions/generated transactions against one state.
type TransitionRuntime struct {
	State            SimulationState
	model            types.SimulationInputs
	accountByID      map[string]types.Account
	accountOrder     []string
	paymentTerms     map[string]types.PaymentTerms
	projectionStart  string
	monteCarloSample *types.MonteCarloSample
}

// CreateTransitionRuntime clones initialState and binds model context.
func CreateTransitionRuntime(model types.SimulationInputs, initialState SimulationState, projectionStartDate string, monteCarloSample *types.MonteCarloSample) *TransitionRuntime {
	accountByID := make(map[string]types.Account, len(model.Accounts))
	accountOrder := make([]string, 0, len(model.Accounts))
	for _, account := range model.Accounts {
		accountByID[account.ID] = account
		accountOrder = append(accountOrder, account.ID)
	}
	return &TransitionRuntime{
		State:            CloneSimulationState(initialState),
		model:            model,
		accountByID:      accountByID,
		accountOrder:     accountOrder,
		paymentTerms:     paymentTermsByAccount(model.PaymentTerms),
		projectionStart:  projectionStartDate,
		monteCarloSample: monteCarloSample,
	}
}

func (t *TransitionRuntime) observeTransaction(transactionID string, realizedAmount float64, date string) {
	t.State.LatestRealizedTransactionAmounts[transactionID] = realizedAmount
	if t.State.LatestRealizedTransactionDates == nil {
		t.State.LatestRealizedTransactionDates = map[string]string{}
	}
	t.State.LatestRealizedTransactionDates[transactionID] = date
	year := date[:4]
	byYear, ok := t.State.RealizedTransactionAmountsByYear[transactionID]
	if !ok {
		byYear = map[string]float64{}
		t.State.RealizedTransactionAmountsByYear[transactionID] = byYear
	}
	byYear[year] += realizedAmount
}

// observeLossTransaction records a loss realization for dependent amount
// resolution without touching the annual-cap ledger. Losses are balance
// adjustments: they must neither consume nor inflate cap headroom, so only
// the latest realized amount carries the (negative) value.
func (t *TransitionRuntime) observeLossTransaction(transactionID string, realizedAmount float64) {
	t.State.LatestRealizedTransactionAmounts[transactionID] = realizedAmount
}

func (t *TransitionRuntime) applyAndCollectDeltas(result AccountTransactionResult, apply func()) AppliedTransactionTransition {
	beforeBalances := SnapshotBalances(t.State.Balances)
	apply()
	return AppliedTransactionTransition{
		Result:        result,
		AccountDeltas: collectDeltasInOrder(beforeBalances, t.State.Balances, t.accountOrder),
	}
}

// ExecuteTransaction executes one occurrence through the shared transitions.
// Amount work and simulation work are separate phases: PrepareTransactionExecution
// calculates the request from snapshots without touching runtime state, and
// ApplyPreparedExecution resolves it against constraints, applies it, and
// records the outcome. The historicalActual policy is explicit, not a second
// codepath: confirmed historical actuals move their recorded amount without
// hypothetical funding clamps (history describes what moved), while modeled
// rules and all forecast requests retain funding constraints. Annual caps
// still apply to rule instances; one-time actuals carry no cap.
func (t *TransitionRuntime) ExecuteTransaction(occurrence DatedTransactionOccurrence, date string, historicalActual bool) (TransactionExecutionTransition, error) {
	transaction := occurrence.Transaction
	var sampledRate *float64
	// Sampling is coordinator-owned: volatile amounts look up their
	// transaction's pre-sampled annual rate for this projection year.
	// Providers never draw RNG; a missing entry for a volatile transaction
	// is a preparation defect, not a fresh draw.
	if _, volatile := VolatileRateInputOf(transaction.Amount); volatile && t.monteCarloSample != nil {
		yearIndex := ProjectionYearIndex(t.projectionStart, date)
		rates, ok := t.monteCarloSample.AnnualRatesByTransactionID[transaction.ID]
		if !ok || yearIndex >= len(rates) {
			return TransactionExecutionTransition{}, fmt.Errorf(
				"Missing sampled annual rate for transaction %q in projection year %d.", transaction.ID, yearIndex)
		}
		rate := rates[yearIndex]
		sampledRate = &rate
	}
	prepared, err := PrepareTransactionExecution(occurrence, date, historicalActual, t.snapshotExecutionState(), sampledRate)
	if err != nil {
		return TransactionExecutionTransition{}, err
	}
	return t.ApplyPreparedExecution(prepared, date)
}

// ObserveTransaction records a realized amount without moving balances.
func (t *TransitionRuntime) ObserveTransaction(transactionID string, realizedAmount float64, date string) {
	t.observeTransaction(transactionID, realizedAmount, date)
}

// ExecuteGeneratedTransaction applies a reactive behavior transaction.
func (t *TransitionRuntime) ExecuteGeneratedTransaction(action AccountTransactionAction) (AppliedTransactionTransition, error) {
	result := ResolveAccountTransaction(action, t.State.Balances, t.accountByID)
	transition := t.applyAndCollectDeltas(result, func() {
		ApplyAccountTransaction(action, result.RealizedAmount, t.State.Balances, t.accountByID)
	})
	return transition, nil
}

// AccountByID exposes the bound account index to evaluations.
func (t *TransitionRuntime) AccountByID() map[string]types.Account { return t.accountByID }
