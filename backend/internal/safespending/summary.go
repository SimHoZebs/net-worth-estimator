// Package safespending owns the evidence-only cash read, separate from projection.
package safespending

import (
	"math"
	"slices"
	"sort"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func money(value float64) *float64 {
	value = math.Round(value*100) / 100
	return &value
}

func reason(reasons *[]string, value string) {
	if !slices.Contains(*reasons, value) {
		*reasons = append(*reasons, value)
	}
}

func fact(t types.Transaction) bool {
	// Pending is bank evidence even when simulation intentionally disables it.
	return (t.Enabled || t.Pending) && !t.Void && t.Source != "projected"
}

func posted(t types.Transaction, cut int64) bool {
	return fact(t) && !t.Pending && t.PostedTime > 0 && t.PostedTime <= cut && domain.TransactionInstant(&t) <= cut
}

// recordedByCut reports whether a posted settlement or a real pending
// authorization is evidence at the cut. Void rows, projected rows, and facts
// dated after the cut never do. Unscheduled spending needs no claim, so it
// shares this predicate with, but does not require, the claim-based helper.
func recordedByCut(t types.Transaction, cut int64) bool {
	return posted(t, cut) || (fact(t) && t.Pending && domain.TransactionInstant(&t) <= cut)
}

// cutState carries the evidence assembled during one BuildAtCut pass. The
// helpers below advance it through checkpoint selection, confirmed-fact application,
// baseline derivation and the final availability gate.
type cutState struct {
	s              *types.SafeSpendingSummary
	model          *types.FinancialModel
	settings       *types.SafeSpendingSettings
	latest         map[string]types.Checkpoint
	selected       map[string]bool
	balances       map[string]float64
	basis          map[string]types.DisplayBasis
	transactions   []types.Transaction
	ctx            *amounts
	cut            int64
	knownAvailable bool
}

func cashEvidence(model *types.FinancialModel, settings *types.SafeSpendingSettings, cut int64) *cutState {
	day := domain.FormatIsoDate(time.Unix(cut, 0))
	s := types.SafeSpendingSummary{CashAsOf: day, Status: "available", Reasons: []string{}, Baselines: []types.SafeSpendingBaseline{}, ConfirmedMovements: []types.SafeSpendingMovement{}, Bills: []types.SafeSpendingBill{}, Statements: []types.SafeSpendingStatement{}}
	st := &cutState{s: &s, model: model, settings: settings, latest: pickCheckpoints(model, cut), selected: map[string]bool{}, balances: map[string]float64{}, basis: map[string]types.DisplayBasis{}, cut: cut}
	st.applyConfirmedFacts()
	st.deriveBaselines()
	st.ctx.basis = st.basis
	return st
}

// effectiveCashBasis mirrors the owner-facing display choice at this evidence
// cut. A bank-reported available figure is the only thing that can embed
// outgoing holds, so without one posted is the effective figure. Otherwise the
// account's configured basis applies, with available as the default.
func effectiveCashBasis(account types.Account, cp types.Checkpoint) types.DisplayBasis {
	if cp.AvailableBalance == nil || types.NormalizeDisplayBasis(account.DisplayBasis) == types.DisplayBasisPosted {
		return types.DisplayBasisPosted
	}
	return types.DisplayBasisAvailable
}

// pickCheckpoints keeps the newest observation at or before the cut for each
// account. Later checkpoints are not evidence at this instant.
func pickCheckpoints(model *types.FinancialModel, cut int64) map[string]types.Checkpoint {
	latest := map[string]types.Checkpoint{}
	for _, cp := range model.Checkpoints {
		if cp.ObservedAt <= cut {
			old, ok := latest[cp.AccountID]
			if !ok || cp.ObservedAt > old.ObservedAt {
				latest[cp.AccountID] = cp
			}
		}
	}
	return latest
}

// applyConfirmedFacts resolves posted facts in instant order, maintaining the
// observed balances that baselines and conditional amounts read afterward.
func (st *cutState) applyConfirmedFacts() {
	st.s.SelectedAccountIDs = effectiveAccounts(st.model, st.settings, st.latest)
	for _, id := range st.s.SelectedAccountIDs {
		st.selected[id] = true
	}
	for id, cp := range st.latest {
		st.balances[id] = cp.Balance
	}
	st.transactions = slices.Clone(st.model.Transactions)
	sort.SliceStable(st.transactions, func(i, j int) bool {
		a, b := st.transactions[i], st.transactions[j]
		ai, bi := domain.TransactionInstant(&a), domain.TransactionInstant(&b)
		if ai != bi {
			return ai < bi
		}
		if a.PostedTime != b.PostedTime {
			return a.PostedTime < b.PostedTime
		}
		return a.ExecutionOrder < b.ExecutionOrder
	})
	// Recorded amounts resolve against observed facts only, never schedule application.
	st.ctx = newAmounts(st.model, st.balances)
	invalidate := func(tx types.Transaction, instant int64, cause string) {
		for _, account := range st.model.Accounts {
			id := account.ID
			cp, observed := st.latest[id]
			if !touches(tx, id) || (observed && instant <= cp.ObservedAt) {
				continue
			}
			// Provider inputs must not retain stale observed balances after
			// an unresolved movement, even for unselected debt accounts.
			delete(st.balances, id)
			if st.selected[id] {
				reason(&st.s.Reasons, cause)
			}
		}
	}
	for _, tx := range st.transactions {
		if !posted(tx, st.cut) {
			continue
		}
		instant := domain.TransactionInstant(&tx)
		if len(tx.Destinations) > 1 {
			invalidate(tx, instant, ReasonPostedRoutingUnknown)
		}
		amount, err := st.ctx.resolveFact(tx)
		if err != nil {
			st.ctx.invalidateRecorded(tx)
			invalidate(tx, instant, ReasonPostedAmountUnavailable)
			continue
		}
		st.ctx.record(tx, amount)
		if len(tx.Destinations) > 1 {
			continue
		}
		for _, account := range st.model.Accounts {
			id := account.ID
			cp, ok := st.latest[id]
			if !ok {
				continue
			}
			if instant <= cp.ObservedAt {
				continue
			}
			delta := cashDelta(tx, id, amount)
			if delta == 0 {
				continue
			}
			if _, known := st.balances[id]; known {
				st.balances[id] += delta
			}
			if st.selected[id] {
				st.s.ConfirmedMovements = append(st.s.ConfirmedMovements, types.SafeSpendingMovement{TransactionID: tx.ID, AccountID: id, Name: tx.Name, PostedAt: tx.PostedTime, EffectiveAt: instant, Amount: *money(delta)})
			}
		}
	}
}

// deriveBaselines records the observed cash per selected account and decides
// when the summed available figure is exact enough to publish.
func (st *cutState) deriveBaselines() {
	available := 0.0
	for _, a := range st.model.Accounts {
		if !st.selected[a.ID] {
			continue
		}
		b := types.SafeSpendingBaseline{AccountID: a.ID, AccountName: a.Name, Basis: "missing", Status: "missing", Reasons: []string{}}
		cp, ok := st.latest[a.ID]
		if !ok {
			reason(&b.Reasons, ReasonCashBaselineMissing)
		} else {
			b.ObservedAt = &cp.ObservedAt
			b.PostedBalance = &cp.Balance
			b.AvailableBalance = cp.AvailableBalance
			basis := effectiveCashBasis(a, cp)
			st.basis[a.ID] = basis
			b.Basis = string(basis)
			b.Status = "available"
			// Application starts from the observed posted total and adds confirmed
			// movements after it. Only an effective available figure adjusts
			// that total by the bank-reported gap. On the posted basis,
			// pending holds have not been deducted from starting cash.
			accountCash := st.balances[a.ID]
			if basis == types.DisplayBasisAvailable {
				accountCash += *cp.AvailableBalance - cp.Balance
			}
			available += accountCash
			holds, exactHolds := 0.0, true
			for _, tx := range st.transactions {
				if !fact(tx) || !touches(tx, a.ID) {
					continue
				}
				instant := domain.TransactionInstant(&tx)
				if tx.Pending && instant <= st.cut {
					if instant > cp.ObservedAt {
						if basis == types.DisplayBasisAvailable {
							reason(&b.Reasons, ReasonPendingAfterBaselineCoverageUnknown)
						}
					} else if basis == types.DisplayBasisAvailable && tx.SourceAccountID != nil && *tx.SourceAccountID == a.ID {
						// Outgoing holds are embedded only in a reported
						// available total. On the posted basis they stay out
						// of the starting cash without nulling it.
						addPaymentAmount(&holds, &exactHolds, st.ctx.holdAmount(tx))
					}
				}
				// A newly posted debit may settle a hold already in available cash.
				// Aggregate gaps cannot identify which transaction held that cash.
				if basis == types.DisplayBasisAvailable && posted(tx, st.cut) && instant > cp.ObservedAt && tx.SourceAccountID != nil && *tx.SourceAccountID == a.ID && math.Abs(cp.Balance-*cp.AvailableBalance) > .005 {
					reason(&b.Reasons, ReasonPostedHoldCoverageUnknown)
				}
			}
			// A reported balance proves only aggregate coverage. If the gap
			// cannot cover all known outgoing authorizations, a hold cannot
			// safely be treated as already deducted or deducted again.
			if basis == types.DisplayBasisAvailable && (!exactHolds || holds > max(0, cp.Balance-*cp.AvailableBalance)+.005) {
				reason(&b.Reasons, ReasonPendingHoldCoverageUnknown)
			}
			if len(b.Reasons) > 0 {
				b.Status = "uncertain"
			}
		}
		for _, r := range b.Reasons {
			reason(&st.s.Reasons, r)
		}
		st.s.Baselines = append(st.s.Baselines, b)
	}
	if len(st.selected) == 0 {
		reason(&st.s.Reasons, ReasonCashAccountsMissing)
	}
	st.knownAvailable = len(st.selected) > 0
	exactAvailable := st.knownAvailable && !slices.Contains(st.s.Reasons, ReasonPostedAmountUnavailable) && !slices.Contains(st.s.Reasons, ReasonPostedRoutingUnknown)
	for _, b := range st.s.Baselines {
		if b.Basis == "missing" {
			st.knownAvailable = false
		}
		if b.Status != "available" {
			exactAvailable = false
		}
	}
	if exactAvailable {
		st.s.CheckingAvailable = money(available)
	}
}

func (st *cutState) gateStatus() {
	if len(st.s.Reasons) > 0 {
		st.s.Status = "uncertain"
	}
	if !st.knownAvailable {
		st.s.Status = "missing"
	}
	sort.Strings(st.s.Reasons)
}

func touches(tx types.Transaction, id string) bool {
	return (tx.SourceAccountID != nil && *tx.SourceAccountID == id) || slices.Contains(tx.Destinations, id)
}

// cashDelta is used only for a single destination. Multi-destination recorded
// rows have no stored allocation evidence and are reported as uncertain above.
func cashDelta(tx types.Transaction, id string, amount float64) float64 {
	delta := 0.0
	if tx.SourceAccountID != nil && *tx.SourceAccountID == id {
		delta -= amount
	}
	for _, dest := range tx.Destinations {
		if dest == id {
			delta += amount
		}
	}
	return delta
}
