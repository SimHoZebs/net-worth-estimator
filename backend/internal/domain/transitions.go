package domain

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Shared state transitions ported from simulation/transitions.ts. This file is
// the single semantic source for posting execution across deterministic,
// branch (FI), and Monte Carlo runs.

// AppliedMovementTransition carries a movement result plus per-account deltas.
type AppliedMovementTransition struct {
	Result        AccountMovementResult
	AccountDeltas []AccountDeltaEntry
}

// PostingExecutionTransition extends AppliedMovementTransition for postings.
type PostingExecutionTransition struct {
	AppliedMovementTransition
	PostingID string
	Income    *types.IncomeEvent
}

// SimulationState mirrors types.SimulationState with owned maps.
type SimulationState = types.SimulationState

// CloneSimulationState deep-copies balances and realized amount maps.
func CloneSimulationState(state SimulationState) SimulationState {
	cloned := SimulationState{
		Balances:                     SnapshotBalances(state.Balances),
		LatestRealizedPostingAmounts: make(map[string]float64, len(state.LatestRealizedPostingAmounts)),
		RealizedPostingAmountsByYear: make(map[string]map[string]float64, len(state.RealizedPostingAmountsByYear)),
	}
	for id, amount := range state.LatestRealizedPostingAmounts {
		cloned.LatestRealizedPostingAmounts[id] = amount
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

// TransitionRuntime executes postings/generated movements against one state.
type TransitionRuntime struct {
	State            SimulationState
	model            types.FinancialModel
	accountByID      map[string]types.Account
	accountOrder     []string
	projectionStart  string
	monteCarloSample *types.MonteCarloSample
	incomeData       *types.IncomeDataSnapshot
}

// CreateTransitionRuntime clones initialState and binds model context.
func CreateTransitionRuntime(model types.FinancialModel, initialState SimulationState, projectionStartDate string, monteCarloSample *types.MonteCarloSample, incomeData *types.IncomeDataSnapshot) (*TransitionRuntime, error) {
	if incomeData == nil {
		incomeData = types.EmptyIncomeData()
	}
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
		projectionStart:  projectionStartDate,
		monteCarloSample: monteCarloSample,
		incomeData:       incomeData,
	}, nil
}

func (t *TransitionRuntime) observePosting(postingID string, realizedAmount float64, date string) {
	t.State.LatestRealizedPostingAmounts[postingID] = realizedAmount
	year := date[:4]
	byYear, ok := t.State.RealizedPostingAmountsByYear[postingID]
	if !ok {
		byYear = map[string]float64{}
		t.State.RealizedPostingAmountsByYear[postingID] = byYear
	}
	byYear[year] += realizedAmount
}

func (t *TransitionRuntime) applyAndCollectDeltas(result AccountMovementResult, apply func()) AppliedMovementTransition {
	beforeBalances := SnapshotBalances(t.State.Balances)
	apply()
	return AppliedMovementTransition{
		Result:        result,
		AccountDeltas: collectDeltasInOrder(beforeBalances, t.State.Balances, t.accountOrder),
	}
}

// ExecutePosting executes one occurrence through the shared transitions.
func (t *TransitionRuntime) ExecutePosting(occurrence DatedPostingOccurrence, date string) (PostingExecutionTransition, error) {
	posting := occurrence.Posting
	if posting.Amount.Resolver == "income" {
		execution, err := ExecuteIncomePosting(posting, date, t.incomeData, t.State.Balances, t.accountByID, t.accountOrder)
		if err != nil {
			return PostingExecutionTransition{}, err
		}
		result := AccountMovementResult{
			RequestedAmount: execution.RequestedAmount,
			RealizedAmount:  execution.RealizedAmount,
		}
		t.observePosting(posting.ID, result.RealizedAmount, date)
		return PostingExecutionTransition{
			AppliedMovementTransition: AppliedMovementTransition{
				Result:        result,
				AccountDeltas: execution.AccountDeltas,
			},
			PostingID: posting.ID,
			Income:    &execution.Income,
		}, nil
	}
	yearIndex := ProjectionYearIndex(t.projectionStart, date)
	var sampledRate *float64
	if posting.Volatility > 0 && t.monteCarloSample != nil {
		rates, ok := t.monteCarloSample.AnnualRatesByPostingID[posting.ID]
		if !ok || yearIndex >= len(rates) {
			return PostingExecutionTransition{}, fmt.Errorf(
				"Missing sampled annual rate for posting %q in projection year %d.", posting.ID, yearIndex)
		}
		rate := rates[yearIndex]
		sampledRate = &rate
	}
	rawRequested, err := ComputeRequestedAmount(occurrence, date, t.State.LatestRealizedPostingAmounts, t.State.RealizedPostingAmountsByYear, t.State.Balances, sampledRate)
	if err != nil {
		return PostingExecutionTransition{}, err
	}
	requestedAmount := maxFloat(0, rawRequested)
	year := date[:4]
	realizedThisYear := t.State.RealizedPostingAmountsByYear[posting.ID][year]
	annualCapRemaining := inf()
	if posting.AnnualCap != nil {
		annualCapRemaining = maxFloat(0, *posting.AnnualCap-realizedThisYear)
	}
	result := ResolvePostingMovement(posting, requestedAmount, annualCapRemaining, t.State.Balances, t.accountByID)
	transition := t.applyAndCollectDeltas(result, func() {
		ApplyPosting(posting, result.RealizedAmount, t.State.Balances, t.accountByID)
	})
	t.observePosting(posting.ID, result.RealizedAmount, date)
	return PostingExecutionTransition{
		AppliedMovementTransition: transition,
		PostingID:                 posting.ID,
	}, nil
}

// ObservePosting records a realized amount without moving balances.
func (t *TransitionRuntime) ObservePosting(postingID string, realizedAmount float64, date string) {
	t.observePosting(postingID, realizedAmount, date)
}

// ExecuteGeneratedMovement applies a reactive behavior movement.
func (t *TransitionRuntime) ExecuteGeneratedMovement(action AccountMovementAction) (AppliedMovementTransition, error) {
	result := ResolveAccountMovement(action, t.State.Balances, t.accountByID)
	transition := t.applyAndCollectDeltas(result, func() {
		ApplyAccountMovement(action, result.RealizedAmount, t.State.Balances, t.accountByID)
	})
	return transition, nil
}

// AccountByID exposes the bound account index to evaluations.
func (t *TransitionRuntime) AccountByID() map[string]types.Account { return t.accountByID }
