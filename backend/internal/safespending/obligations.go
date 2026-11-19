package safespending

import (
	"fmt"
	"sort"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type amounts struct {
	balances map[string]float64
	latest   map[string]float64
	dates    map[string]string
	years    map[string]map[string]float64
	terms    map[string]types.PaymentTerms
	refs     *domain.AmountReferenceContext
}

func newAmounts(model *types.FinancialModel, balances map[string]float64) *amounts {
	return &amounts{
		balances: balances,
		latest:   map[string]float64{},
		dates:    map[string]string{},
		years:    map[string]map[string]float64{},
		terms:    domain.PaymentTermsByAccount(model),
		refs:     &domain.AmountReferenceContext{AccountIDs: map[string]bool{}, TransactionIDs: map[string]bool{}},
	}
}

// referenceContext reuses the context allocated in newAmounts but refreshes
// both ID sets from the live evidence maps. Observed balances are dropped when
// an unresolved movement invalidates them and recorded facts accumulate during
// replay, so a context frozen at construction would validate against stale IDs.
func (a *amounts) referenceContext() *domain.AmountReferenceContext {
	clear(a.refs.AccountIDs)
	clear(a.refs.TransactionIDs)
	for id := range a.balances {
		a.refs.AccountIDs[id] = true
	}
	for id := range a.latest {
		a.refs.TransactionIDs[id] = true
	}
	return a.refs
}

func (a *amounts) resolve(o domain.DatedTransactionOccurrence, date string) (float64, error) {
	// Validate against evidence identities rather than all configured accounts.
	// Several canonical providers otherwise default missing model values to zero.
	if _, err := domain.ValidateAmountDescriptor(o.Transaction.Amount, a.referenceContext()); err != nil {
		return 0, err
	}
	return domain.ComputeRequestedAmount(o, date, a.latest, a.dates, a.years, a.balances, a.terms, nil)
}

func transactionDay(tx types.Transaction) string {
	return domain.FormatIsoDate(time.Unix(domain.TransactionInstant(&tx), 0))
}

// Recorded facts cannot borrow a later balance observation to recalculate an
// earlier amount. Static inputs and prior known recorded amounts are evidence;
// account-dependent providers remain available only for conditional bills.
func (a *amounts) resolveFact(tx types.Transaction) (float64, error) {
	for _, input := range tx.Amount.Inputs {
		if input.Source == "literal" {
			continue
		}
		id, _ := input.Arguments["id"].(string)
		if input.Provider != "model-value" {
			return 0, fmt.Errorf("recorded amount requires contemporaneous provider evidence")
		}
		if _, known := a.latest[id]; !known {
			return 0, fmt.Errorf("recorded amount dependency is unknown")
		}
	}
	return a.resolve(domain.DatedTransactionOccurrence{Transaction: &tx}, transactionDay(tx))
}

// A newer unknown fact supersedes earlier amount evidence even when a balance
// observation already incorporates its movement. A checkpoint proves a balance,
// not that transaction's amount or its claimed schedule's latest amount.
func (a *amounts) invalidateRecorded(tx types.Transaction) {
	ids := []string{tx.ID}
	if tx.Claim != nil {
		ids = append(ids, tx.Claim.ScheduleID)
	}
	for _, id := range ids {
		delete(a.latest, id)
		delete(a.dates, id)
		delete(a.years, id)
	}
}

func (a *amounts) recordID(id, date string, value float64) {
	a.latest[id] = value
	a.dates[id] = date
	if a.years[id] == nil {
		a.years[id] = map[string]float64{}
	}
	a.years[id][date[:4]] += value
}

func (a *amounts) record(tx types.Transaction, value float64) {
	date := transactionDay(tx)
	a.recordID(tx.ID, date, value)
	if tx.Claim != nil {
		a.recordID(tx.Claim.ScheduleID, date, value)
	}
}

// Expand selected schedules first so claims enrich the same occurrence identity,
// even when a payment posts outside the cycle or for a different amount. Only
// occurrences in [start, end] are expanded, so a claim naming another cycle
// cannot pull all-history arrears into this ledger or duplicate an occurrence
// outside the window.
func buildObligations(s *types.SafeSpendingSummary, model *types.FinancialModel, settings *types.SafeSpendingSettings, selected map[string]bool, ctx *amounts, cut int64, start, end string) *float64 {
	claims := map[types.TransactionClaim]*types.Transaction{}
	for i := range model.Transactions {
		tx := &model.Transactions[i]
		if happenedByCut(*tx, cut) {
			claims[*tx.Claim] = tx
		}
	}
	schedules := effectiveBills(model.Schedules, selected, settings.TransactionIDs)
	total := 0.0
	exact := true
	for date, occurrences := range domain.ResolveOccurrences(schedules, nil, start, end, true).ByDate {
		for _, o := range occurrences {
			row, cause := billEvidence(o, date, claims[types.TransactionClaim{ScheduleID: o.Rule.ID, OccurrenceDate: date}], selected, ctx)
			if cause != "" {
				reason(&s.Reasons, cause)
				exact = false
			}
			if row.Status == "unpaid" && row.Amount != nil {
				total += *row.Amount
			}
			s.Bills = append(s.Bills, *row)
		}
	}
	sort.Slice(s.Bills, func(i, j int) bool {
		a, b := s.Bills[i], s.Bills[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		return a.ID < b.ID
	})
	sort.Strings(s.Reasons)
	if exact {
		return money(total)
	}
	return nil
}

func billEvidence(o domain.DatedTransactionOccurrence, date string, claim *types.Transaction, selected map[string]bool, ctx *amounts) (*types.SafeSpendingBill, string) {
	rule := o.Rule
	internal := 0
	for _, id := range rule.Destinations {
		if selected[id] {
			internal++
		}
	}
	row := &types.SafeSpendingBill{ID: "schedule:" + rule.ID + ":" + date, ScheduleID: &rule.ID, Date: date, Name: rule.Name, AccountID: *rule.SourceAccountID, Status: "unpaid"}
	if claim != nil {
		// An exact claim that happened by the evidence cut settles the
		// occurrence. A real pending authorization is such evidence too, even
		// before it posts. The cash ledger already carries its movement or
		// hold under the cash rules, so the scheduled bill is neither a second
		// deduction nor a reason to withhold the subtotal.
		row.TransactionID = &claim.ID
		row.Status = "paid"
		if !claim.Pending {
			if amount, ok := ctx.latest[claim.ID]; ok {
				row.Amount = money(amount)
			}
			return row, ""
		}
		// A hold has no replayed settlement amount. Only literal inputs are
		// evidence at authorization time; the end-of-cut provider context
		// could contain a fact posted after the hold.
		for _, input := range claim.Amount.Inputs {
			if input.Source != "literal" {
				return row, ""
			}
		}
		if amount, err := ctx.resolveFact(*claim); err == nil {
			row.Amount = money(amount)
		}
		return row, ""
	}
	if internal > 0 {
		row.Status = "unknown"
		return row, ReasonObligationRoutingUnknown
	}
	amount, err := ctx.resolve(o, date)
	if err != nil {
		row.Status = "unknown"
		return row, ReasonObligationAmountUnavailable
	}
	if amount < 0 {
		row.Status = "unknown"
		return row, ReasonNegativeObligationAmount
	}
	row.Amount = money(amount)
	// Without an exact happening claim the occurrence stays expected, priced and
	// deducted once. A balance observation on its date is not settlement
	// evidence in either direction, so it never turns the bill unknown.
	return row, ""
}
