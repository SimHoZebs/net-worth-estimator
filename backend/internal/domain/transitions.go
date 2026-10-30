package domain

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Shared state transitions; Go is the owner and single semantic source for
// posting execution across deterministic, branch (FI), and Monte Carlo runs.

// AppliedTransactionTransition carries a transaction result plus per-account deltas.
type AppliedTransactionTransition struct {
	Result        AccountTransactionResult
	AccountDeltas []AccountDeltaEntry
}

// PostingExecutionTransition extends AppliedTransactionTransition for postings.
type PostingExecutionTransition struct {
	AppliedTransactionTransition
	PostingID string
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
		Balances:                     SnapshotBalances(state.Balances),
		LatestRealizedPostingAmounts: make(map[string]float64, len(state.LatestRealizedPostingAmounts)),
		LatestRealizedPostingDates:   make(map[string]string, len(state.LatestRealizedPostingDates)),
		RealizedPostingAmountsByYear: make(map[string]map[string]float64, len(state.RealizedPostingAmountsByYear)),
	}
	for id, amount := range state.LatestRealizedPostingAmounts {
		cloned.LatestRealizedPostingAmounts[id] = amount
	}
	for id, date := range state.LatestRealizedPostingDates {
		cloned.LatestRealizedPostingDates[id] = date
	}
	for postingID, byYear := range state.RealizedPostingAmountsByYear {
		years := make(map[string]float64, len(byYear))
		for year, amount := range byYear {
			years[year] = amount
		}
		cloned.RealizedPostingAmountsByYear[postingID] = years
	}
	return cloned
}

// TransitionRuntime executes postings/generated transactions against one state.
type TransitionRuntime struct {
	State            SimulationState
	model            types.FinancialModel
	accountByID      map[string]types.Account
	accountOrder     []string
	paymentTerms     map[string]types.PaymentTerms
	projectionStart  string
	monteCarloSample *types.MonteCarloSample
}

// CreateTransitionRuntime clones initialState and binds model context.
func CreateTransitionRuntime(model types.FinancialModel, initialState SimulationState, projectionStartDate string, monteCarloSample *types.MonteCarloSample) (*TransitionRuntime, error) {
	accountByID := make(map[string]types.Account, len(model.Accounts))
	accountOrder := make([]string, 0, len(model.Accounts))
	seenAccounts := map[string]bool{}
	for _, account := range model.Accounts {
		accountByID[account.ID] = account
		if !seenAccounts[account.ID] {
			seenAccounts[account.ID] = true
			accountOrder = append(accountOrder, account.ID)
		}
	}
	return &TransitionRuntime{
		State:            CloneSimulationState(initialState),
		model:            model,
		accountByID:      accountByID,
		accountOrder:     accountOrder,
		paymentTerms:     paymentTermsByAccount(model.PaymentTerms),
		projectionStart:  projectionStartDate,
		monteCarloSample: monteCarloSample,
	}, nil
}

func (t *TransitionRuntime) observePosting(postingID string, realizedAmount float64, date string) {
	t.State.LatestRealizedPostingAmounts[postingID] = realizedAmount
	if t.State.LatestRealizedPostingDates == nil {
		t.State.LatestRealizedPostingDates = map[string]string{}
	}
	t.State.LatestRealizedPostingDates[postingID] = date
	year := date[:4]
	byYear, ok := t.State.RealizedPostingAmountsByYear[postingID]
	if !ok {
		byYear = map[string]float64{}
		t.State.RealizedPostingAmountsByYear[postingID] = byYear
	}
	byYear[year] += realizedAmount
}

// observeLossPosting records a loss realization for dependent amount
// resolution without touching the annual-cap ledger. Losses are balance
// adjustments: they must neither consume nor inflate cap headroom, so only
// the latest realized amount carries the (negative) value.
func (t *TransitionRuntime) observeLossPosting(postingID string, realizedAmount float64) {
	t.State.LatestRealizedPostingAmounts[postingID] = realizedAmount
}

func (t *TransitionRuntime) applyAndCollectDeltas(result AccountTransactionResult, apply func()) AppliedTransactionTransition {
	beforeBalances := SnapshotBalances(t.State.Balances)
	apply()
	return AppliedTransactionTransition{
		Result:        result,
		AccountDeltas: collectDeltasInOrder(beforeBalances, t.State.Balances, t.accountOrder),
	}
}

// ExecutePosting executes one occurrence through the shared transitions.
// The historicalActual policy is explicit, not a second codepath: confirmed
// historical actuals move their recorded amount without hypothetical
// funding clamps (history describes what moved), while modeled rules and
// all forecast requests retain funding constraints. Annual caps still
// apply to rule instances; one-time actuals carry no cap.
func (t *TransitionRuntime) ExecutePosting(occurrence DatedPostingOccurrence, date string, historicalActual bool) (PostingExecutionTransition, error) {
	posting := occurrence.Posting
	// Rate behavior (volatility sampling, annual caps) belongs to rules.
	// Manual postings execute literally unless their amount carries a
	// volatile occurrence-rate input; only rules carry caps.
	var ruleAnnualCap *float64
	if occurrence.Rule != nil {
		ruleAnnualCap = occurrence.Rule.AnnualCap
	}
	yearIndex := ProjectionYearIndex(t.projectionStart, date)
	var sampledRate *float64
	// Sampling is coordinator-owned: volatile amounts look up their
	// transaction's pre-sampled annual rate for this projection year.
	// Providers never draw RNG; a missing entry for a volatile transaction
	// is a preparation defect, not a fresh draw.
	if _, volatile := VolatileRateInputOf(posting.Amount); volatile && t.monteCarloSample != nil {
		rates, ok := t.monteCarloSample.AnnualRatesByPostingID[posting.ID]
		if !ok || yearIndex >= len(rates) {
			return PostingExecutionTransition{}, fmt.Errorf(
				"Missing sampled annual rate for posting %q in projection year %d.", posting.ID, yearIndex)
		}
		rate := rates[yearIndex]
		sampledRate = &rate
	}
	rawRequested, err := ComputeRequestedAmount(occurrence, date, t.State.LatestRealizedPostingAmounts, t.State.LatestRealizedPostingDates, t.State.RealizedPostingAmountsByYear, t.State.Balances, t.paymentTerms, sampledRate)
	if err != nil {
		return PostingExecutionTransition{}, err
	}
	// A negative amount on a sourceless inflow posting is an investment
	// loss: it reduces destination balances instead of clamping to zero.
	// Clamping discards the entire downside of sampled return
	// distributions, which biases stochastic bands above the base case.
	if rawRequested < 0 && IsExternalInflow(posting) {
		result := ResolveNegativeInflowTransaction(posting, rawRequested, t.State.Balances, t.accountByID)
		transition := t.applyAndCollectDeltas(result, func() {
			ApplyNegativeInflow(posting, result.RealizedAmount, t.State.Balances, t.accountByID)
		})
		t.observeLossPosting(posting.ID, result.RealizedAmount)
		return PostingExecutionTransition{
			AppliedTransactionTransition: transition,
			PostingID:                    posting.ID,
		}, nil
	}
	requestedAmount := maxFloat(0, rawRequested)
	realizedAmount := requestedAmount
	if !historicalActual {
		year := date[:4]
		realizedThisYear := t.State.RealizedPostingAmountsByYear[posting.ID][year]
		annualCapRemaining := inf()
		if ruleAnnualCap != nil {
			annualCapRemaining = maxFloat(0, *ruleAnnualCap-realizedThisYear)
		}
		realizedAmount = ResolvePostingTransaction(posting, requestedAmount, annualCapRemaining, t.State.Balances, t.accountByID).RealizedAmount
	}
	result := AccountTransactionResult{RequestedAmount: requestedAmount, RealizedAmount: realizedAmount}
	transition := t.applyAndCollectDeltas(result, func() {
		ApplyPosting(posting, result.RealizedAmount, t.State.Balances, t.accountByID)
	})
	t.observePosting(posting.ID, result.RealizedAmount, date)
	return PostingExecutionTransition{
		AppliedTransactionTransition: transition,
		PostingID:                    posting.ID,
	}, nil
}

// ObservePosting records a realized amount without moving balances.
func (t *TransitionRuntime) ObservePosting(postingID string, realizedAmount float64, date string) {
	t.observePosting(postingID, realizedAmount, date)
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
