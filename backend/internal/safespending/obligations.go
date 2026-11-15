package safespending

import (
	"fmt"
	"slices"
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
}

func newAmounts(model *types.FinancialModel, balances map[string]float64) *amounts {
	return &amounts{balances: balances, latest: map[string]float64{}, dates: map[string]string{}, years: map[string]map[string]float64{}, terms: domain.PaymentTermsByAccount(model)}
}

func (a *amounts) resolve(o domain.DatedTransactionOccurrence, date string) (float64, error) {
	// Validate against evidence identities rather than all configured accounts.
	// Several canonical providers otherwise default missing model values to zero.
	refs := &domain.AmountReferenceContext{AccountIDs: map[string]bool{}, TransactionIDs: map[string]bool{}}
	for id := range a.balances {
		refs.AccountIDs[id] = true
	}
	for id := range a.latest {
		refs.TransactionIDs[id] = true
	}
	if _, err := domain.ValidateAmountDescriptor(o.Transaction.Amount, refs); err != nil {
		return 0, err
	}
	return domain.ComputeRequestedAmount(o, date, a.latest, a.dates, a.years, a.balances, a.terms, nil)
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
	date := time.Unix(domain.TransactionInstant(&tx), 0).UTC().Format("2006-01-02")
	return a.resolve(domain.DatedTransactionOccurrence{Transaction: &tx}, date)
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

func (a *amounts) record(tx types.Transaction, value float64) {
	date := time.Unix(domain.TransactionInstant(&tx), 0).UTC().Format("2006-01-02")
	a.latest[tx.ID] = value
	a.dates[tx.ID] = date
	if a.years[tx.ID] == nil {
		a.years[tx.ID] = map[string]float64{}
	}
	a.years[tx.ID][date[:4]] += value
	if tx.Claim != nil {
		id := tx.Claim.ScheduleID
		a.latest[id] = value
		a.dates[id] = date
		if a.years[id] == nil {
			a.years[id] = map[string]float64{}
		}
		a.years[id][date[:4]] += value
	}
}

func buildObligations(s *types.SafeSpendingSummary, model *types.FinancialModel, settings *types.SafeSpendingSettings, selected map[string]bool, observations map[string]types.Checkpoint, ctx *amounts, cut int64) {
	transactions := []types.Transaction{}
	for _, tx := range model.Transactions {
		if fact(tx) {
			// ResolveOccurrences uses Enabled for simulation eligibility and its
			// claim index. Evidence includes disabled live holds without changing
			// the shared snapshot or the projection engine's eligibility rules.
			tx.Enabled = true
			transactions = append(transactions, tx)
		}
	}
	start := s.Start
	// Only explicit transaction claims suppress occurrences, including pending
	// claims. Simulation's realized rows are never evidence that a bill was paid.
	occurrences := domain.ResolveOccurrences(model.Schedules, transactions, start, s.End, true)
	dates := make([]string, 0, len(occurrences.ByDate))
	for date := range occurrences.ByDate {
		dates = append(dates, date)
	}
	sort.Strings(dates)
	seen := map[string]bool{}
	total := 0.0
	known := true
	add := func(o domain.DatedTransactionOccurrence, date string) {
		tx := o.Transaction
		billDate := date
		if tx.Claim != nil {
			billDate = tx.Claim.OccurrenceDate
		}
		if billDate < start || billDate > s.End {
			return
		}
		if tx.SourceAccountID == nil || !selected[*tx.SourceAccountID] {
			return
		}
		// Only the portion leaving the selected cash set is an obligation.
		selectedDestinations := 0
		for _, id := range tx.Destinations {
			if selected[id] {
				selectedDestinations++
			}
		}
		if len(tx.Destinations) > 0 && selectedDestinations == len(tx.Destinations) {
			return
		}
		selectedID := tx.ID
		if tx.Claim != nil {
			selectedID = tx.Claim.ScheduleID
		}
		if settings.TransactionIDs != nil && !slices.Contains(settings.TransactionIDs, tx.ID) && !slices.Contains(settings.TransactionIDs, selectedID) {
			return
		}
		if o.Rule == nil && posted(*tx, cut) {
			return
		}
		id := "transaction:" + tx.ID
		row := types.SafeSpendingObligation{ID: id, TransactionID: &tx.ID, AccountID: *tx.SourceAccountID, Name: tx.Name, Date: date, Status: "outstanding"}
		if o.Rule != nil {
			row.ID = "schedule:" + o.Rule.ID + ":" + date
			row.TransactionID = nil
			row.ScheduleID = &o.Rule.ID
			// A date-only schedule at or before an observed cash day may
			// already have been paid without a claim. It is not an arrears
			// ledger, and neither a due date nor amount matching proves unpaid.
			if cp, ok := observations[*tx.SourceAccountID]; ok && date <= time.Unix(cp.ObservedAt, 0).UTC().Format("2006-01-02") {
				row.Status = "payment-status-unknown"
				reason(&s.Reasons, "scheduled-payment-status-unknown")
			}
		}
		if tx.Claim != nil {
			row.ScheduleID = &tx.Claim.ScheduleID
			row.Date = tx.Claim.OccurrenceDate
		}
		if seen[row.ID] {
			return
		}
		seen[row.ID] = true
		if tx.Pending {
			row.Status = "pending-coverage-unknown"
			reason(&s.Reasons, "pending-obligation-coverage-unknown")
		}
		amount, err := ctx.resolve(o, date)
		if selectedDestinations > 0 {
			known = false
			reason(&s.Reasons, "obligation-routing-unknown")
			s.OutstandingObligations = append(s.OutstandingObligations, row)
			return
		}
		if err != nil {
			known = false
			reason(&s.Reasons, "obligation-amount-unavailable")
		} else if amount < 0 {
			known = false
			reason(&s.Reasons, "negative-obligation-amount")
		} else {
			row.Amount = money(amount)
			total += *row.Amount
		}
		s.OutstandingObligations = append(s.OutstandingObligations, row)
	}
	for _, date := range dates {
		for _, o := range occurrences.ByDate[date] {
			add(o, date)
		}
	}
	// A payment can claim an occurrence inside the requested range while its
	// transaction date is outside it. Keep its exact identity and amount.
	for i := range transactions {
		tx := &transactions[i]
		if tx.Claim != nil && tx.Claim.OccurrenceDate >= start && tx.Claim.OccurrenceDate <= s.End {
			add(domain.DatedTransactionOccurrence{Transaction: tx}, tx.Claim.OccurrenceDate)
		}
	}
	sort.SliceStable(s.OutstandingObligations, func(i, j int) bool {
		a, b := s.OutstandingObligations[i], s.OutstandingObligations[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		return a.ID < b.ID
	})
	if known {
		s.OutstandingBillsTotal = money(total)
	}
}
