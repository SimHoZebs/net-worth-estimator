package domain

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Amount calculation is isolated from simulation execution.
//
// PreparePostingExecution answers "what amount should be simulated" as a
// pure function of snapshots: it never touches live runtime state and never
// mutates anything. ApplyPreparedExecution answers "what actually moved"
// against live balances: it owns every impossible-state decision through
// the shared Resolve functions, then applies and records. The handoff
// between them is PreparedPostingExecution, which carries no rules,
// schedules, samples, or ledgers — only the resolved request.

// ExecutionSnapshot is the read-only input to amount calculation. Maps are
// shared by reference exactly as the kernel already passes them; providers
// must not mutate them.
type ExecutionSnapshot struct {
	Balances        map[string]float64
	LatestRealized  map[string]float64
	LatestDates     map[string]string
	RealizedByYear  map[string]map[string]float64
	PaymentTerms    map[string]types.PaymentTerms
	ProjectionStart string
}

// PreparedPostingExecution is the handoff from amount calculation to
// simulation: one resolved request plus the cap headroom it was computed
// against. The simulator never re-resolves amounts and never consults
// rules, schedules, or samples.
type PreparedPostingExecution struct {
	Posting            *types.Posting
	RequestedAmount    float64
	AnnualCapRemaining float64
	HistoricalActual   bool
	IsLoss             bool
}

// PreparePostingExecution calculates the amount to simulate for one
// occurrence without touching runtime state. A nil sampledRate resolves
// literally; only volatile amounts consult it, and only rules carry caps.
func PreparePostingExecution(occurrence DatedPostingOccurrence, date string, historicalActual bool, snapshot ExecutionSnapshot, sampledRate *float64) (PreparedPostingExecution, error) {
	posting := occurrence.Posting
	rawRequested, err := ComputeRequestedAmount(occurrence, date, snapshot.LatestRealized, snapshot.LatestDates, snapshot.RealizedByYear, snapshot.Balances, snapshot.PaymentTerms, sampledRate)
	if err != nil {
		return PreparedPostingExecution{}, err
	}
	// A negative amount on a sourceless inflow posting is an investment
	// loss: it reduces destination balances instead of clamping to zero.
	if rawRequested < 0 && IsExternalInflow(posting) {
		return PreparedPostingExecution{
			Posting:            posting,
			RequestedAmount:    rawRequested,
			AnnualCapRemaining: inf(),
			HistoricalActual:   historicalActual,
			IsLoss:             true,
		}, nil
	}
	capRemaining := inf()
	if !historicalActual {
		year := date[:4]
		realizedThisYear := snapshot.RealizedByYear[posting.ID][year]
		if occurrence.Rule != nil && occurrence.Rule.AnnualCap != nil {
			capRemaining = maxFloat(0, *occurrence.Rule.AnnualCap-realizedThisYear)
		}
	}
	return PreparedPostingExecution{
		Posting:            posting,
		RequestedAmount:    rawRequested,
		AnnualCapRemaining: capRemaining,
		HistoricalActual:   historicalActual,
	}, nil
}

// snapshotExecutionState exposes the runtime ledgers to amount calculation
// without granting mutation.
func (t *TransitionRuntime) snapshotExecutionState() ExecutionSnapshot {
	return ExecutionSnapshot{
		Balances:        t.State.Balances,
		LatestRealized:  t.State.LatestRealizedPostingAmounts,
		LatestDates:     t.State.LatestRealizedPostingDates,
		RealizedByYear:  t.State.RealizedPostingAmountsByYear,
		PaymentTerms:    t.paymentTerms,
		ProjectionStart: t.projectionStart,
	}
}

// ApplyPreparedExecution runs the simulation half of one prepared occurrence:
// resolve requested against constraints (every impossible state lands
// here), apply the realized amount, and record the outcome in the ledgers.
// Amounts are never recomputed here.
func (t *TransitionRuntime) ApplyPreparedExecution(prepared PreparedPostingExecution, date string) (PostingExecutionTransition, error) {
	posting := prepared.Posting
	if prepared.IsLoss {
		result := ResolveNegativeInflowTransaction(posting, prepared.RequestedAmount, t.State.Balances, t.accountByID)
		transition := t.applyAndCollectDeltas(result, func() {
			ApplyNegativeInflow(posting, result.RealizedAmount, t.State.Balances, t.accountByID)
		})
		t.observeLossPosting(posting.ID, result.RealizedAmount)
		return PostingExecutionTransition{
			AppliedTransactionTransition: transition,
			PostingID:                    posting.ID,
		}, nil
	}
	requestedAmount := maxFloat(0, prepared.RequestedAmount)
	realizedAmount := requestedAmount
	if !prepared.HistoricalActual {
		realizedAmount = ResolvePostingTransaction(posting, requestedAmount, prepared.AnnualCapRemaining, t.State.Balances, t.accountByID).RealizedAmount
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
