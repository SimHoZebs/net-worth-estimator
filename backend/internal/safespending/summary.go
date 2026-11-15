// Package safespending owns the evidence-only cash read, separate from projection.
package safespending

import (
	"math"
	"slices"
	"sort"

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

// Build uses one model snapshot. Cash is evidenced through the start UTC day;
// bills are conditional requested amounts within the inclusive date window.
func Build(model *types.FinancialModel, settings *types.SafeSpendingSettings, start, end string) types.SafeSpendingSummary {
	day := domain.MustParseIsoDate(start)
	return BuildAtCut(model, settings, start, end, day.AddDate(0, 0, 1).Unix()-1)
}

// BuildAtCut explicitly bounds observed facts without a domain wall clock.
// The API supplies its captured request instant so authored future-today facts
// remain conditional instead of masquerading as cash already observed.
func BuildAtCut(model *types.FinancialModel, settings *types.SafeSpendingSettings, start, end string, factualCut int64) types.SafeSpendingSummary {
	day := domain.MustParseIsoDate(start)
	cut := min(day.AddDate(0, 0, 1).Unix()-1, factualCut)
	s := types.SafeSpendingSummary{Start: start, End: end, Status: "available", Reasons: []string{}, Baselines: []types.SafeSpendingBaseline{}, ConfirmedMovements: []types.SafeSpendingMovement{}, OutstandingObligations: []types.SafeSpendingObligation{}}
	if settings == nil {
		settings = &types.SafeSpendingSettings{}
	}
	if model == nil {
		model = &types.FinancialModel{}
	}
	latest := map[string]types.Checkpoint{}
	for _, cp := range model.Checkpoints {
		if cp.ObservedAt <= cut {
			old, ok := latest[cp.AccountID]
			if !ok || cp.ObservedAt > old.ObservedAt {
				latest[cp.AccountID] = cp
			}
		}
	}
	selected := map[string]bool{}
	s.SelectedAccountIDs = effectiveAccounts(model, settings, latest)
	for _, id := range s.SelectedAccountIDs {
		selected[id] = true
	}
	balances := map[string]float64{}
	for id, cp := range latest {
		balances[id] = cp.Balance
	}
	transactions := slices.Clone(model.Transactions)
	sort.SliceStable(transactions, func(i, j int) bool {
		a, b := transactions[i], transactions[j]
		ai, bi := domain.TransactionInstant(&a), domain.TransactionInstant(&b)
		if ai != bi {
			return ai < bi
		}
		if a.PostedTime != b.PostedTime {
			return a.PostedTime < b.PostedTime
		}
		return a.ExecutionOrder < b.ExecutionOrder
	})
	// Recorded amounts resolve against observed facts only, never schedule replay.
	ctx := newAmounts(model, balances)
	invalidate := func(tx types.Transaction, instant int64, cause string) {
		for _, account := range model.Accounts {
			id := account.ID
			cp, observed := latest[id]
			if !touches(tx, id) || (observed && instant <= cp.ObservedAt) {
				continue
			}
			// Provider inputs must not retain stale observed balances after
			// an unresolved movement, even for unselected debt accounts.
			delete(balances, id)
			if selected[id] {
				reason(&s.Reasons, cause)
			}
		}
	}
	for _, tx := range transactions {
		if !posted(tx, cut) {
			continue
		}
		instant := domain.TransactionInstant(&tx)
		if len(tx.Destinations) > 1 {
			invalidate(tx, instant, "posted-routing-unknown")
		}
		amount, err := ctx.resolveFact(tx)
		if err != nil {
			ctx.invalidateRecorded(tx)
			invalidate(tx, instant, "posted-amount-unavailable")
			continue
		}
		ctx.record(tx, amount)
		if len(tx.Destinations) > 1 {
			continue
		}
		for _, account := range model.Accounts {
			id := account.ID
			cp, ok := latest[id]
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
			if _, known := balances[id]; known {
				balances[id] += delta
			}
			if selected[id] {
				s.ConfirmedMovements = append(s.ConfirmedMovements, types.SafeSpendingMovement{TransactionID: tx.ID, AccountID: id, Name: tx.Name, PostedAt: tx.PostedTime, EffectiveAt: instant, Amount: *money(delta)})
			}
		}
	}
	available := 0.0
	for _, a := range model.Accounts {
		if !selected[a.ID] {
			continue
		}
		b := types.SafeSpendingBaseline{AccountID: a.ID, AccountName: a.Name, Basis: "missing", Status: "missing", Reasons: []string{}}
		cp, ok := latest[a.ID]
		if !ok {
			reason(&b.Reasons, "cash-baseline-missing")
		} else {
			b.ObservedAt = &cp.ObservedAt
			b.PostedBalance = &cp.Balance
			b.AvailableBalance = cp.AvailableBalance
			b.Basis = "posted"
			b.Status = "uncertain"
			if cp.AvailableBalance == nil {
				reason(&b.Reasons, "available-balance-missing")
			} else {
				b.Basis = "available"
				b.Status = "available"
				available += *cp.AvailableBalance + balances[a.ID] - cp.Balance
			}
			for _, tx := range transactions {
				if !fact(tx) || !touches(tx, a.ID) {
					continue
				}
				instant := domain.TransactionInstant(&tx)
				if tx.Pending && instant <= cut && instant > cp.ObservedAt {
					reason(&b.Reasons, "pending-after-baseline-coverage-unknown")
				}
				if tx.Pending && instant <= cut && instant <= cp.ObservedAt {
					reason(&b.Reasons, "pending-baseline-coverage-unknown")
				}
				// A newly posted debit may settle a hold already in available cash.
				// Aggregate gaps cannot identify which transaction held that cash.
				if posted(tx, cut) && instant > cp.ObservedAt && tx.SourceAccountID != nil && *tx.SourceAccountID == a.ID && cp.AvailableBalance != nil && math.Abs(cp.Balance-*cp.AvailableBalance) > .005 {
					reason(&b.Reasons, "posted-hold-coverage-unknown")
				}
			}
			if len(b.Reasons) > 0 {
				b.Status = "uncertain"
			}
		}
		for _, r := range b.Reasons {
			reason(&s.Reasons, r)
		}
		s.Baselines = append(s.Baselines, b)
	}
	if len(selected) == 0 {
		reason(&s.Reasons, "cash-accounts-missing")
	}
	knownAvailable := len(selected) > 0
	exactAvailable := knownAvailable && !slices.Contains(s.Reasons, "posted-amount-unavailable") && !slices.Contains(s.Reasons, "posted-routing-unknown")
	for _, b := range s.Baselines {
		if b.AvailableBalance == nil {
			knownAvailable = false
		}
		if b.Status != "available" {
			exactAvailable = false
		}
	}
	if exactAvailable {
		s.CheckingAvailable = money(available)
	}
	buildObligations(&s, model, settings, selected, latest, ctx, cut)
	if len(s.Reasons) > 0 {
		s.Status = "uncertain"
	}
	if !knownAvailable {
		s.Status = "missing"
	}
	if s.Status == "available" && s.CheckingAvailable != nil && s.OutstandingBillsTotal != nil {
		s.CashAfterBills = money(*s.CheckingAvailable - *s.OutstandingBillsTotal)
	}
	return s
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
