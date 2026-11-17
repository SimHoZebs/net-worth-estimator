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

// obligationBuilder carries the mutable state of one buildObligations pass.
// The add method was previously a closure over all of these values.
type obligationBuilder struct {
	summary      *types.SafeSpendingSummary
	settings     *types.SafeSpendingSettings
	selected     map[string]bool
	observations map[string]types.Checkpoint
	ctx          *amounts
	cut          int64
	start        string
	seen         map[string]bool
	known        bool
	total        float64
}

func (b *obligationBuilder) add(o domain.DatedTransactionOccurrence, date string) {
	tx := o.Transaction
	billDate := date
	if tx.Claim != nil {
		billDate = tx.Claim.OccurrenceDate
	}
	if billDate < b.start || billDate > b.summary.End {
		return
	}
	if tx.SourceAccountID == nil || !b.selected[*tx.SourceAccountID] {
		return
	}
	// Only the portion leaving the selected cash set is an obligation.
	selectedDestinations := 0
	for _, id := range tx.Destinations {
		if b.selected[id] {
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
	if b.settings.TransactionIDs != nil && !slices.Contains(b.settings.TransactionIDs, tx.ID) && !slices.Contains(b.settings.TransactionIDs, selectedID) {
		return
	}
	if o.Rule == nil && posted(*tx, b.cut) {
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
		if cp, ok := b.observations[*tx.SourceAccountID]; ok && date <= domain.FormatIsoDate(time.Unix(cp.ObservedAt, 0)) {
			row.Status = "payment-status-unknown"
			reason(&b.summary.Reasons, ReasonScheduledPaymentStatusUnknown)
		}
	}
	if tx.Claim != nil {
		row.ScheduleID = &tx.Claim.ScheduleID
		row.Date = tx.Claim.OccurrenceDate
	}
	if b.seen[row.ID] {
		return
	}
	b.seen[row.ID] = true
	if tx.Pending {
		row.Status = "pending-coverage-unknown"
		reason(&b.summary.Reasons, ReasonPendingObligationCoverageUnknown)
	}
	amount, err := b.ctx.resolve(o, date)
	if selectedDestinations > 0 {
		b.known = false
		reason(&b.summary.Reasons, ReasonObligationRoutingUnknown)
		b.summary.OutstandingObligations = append(b.summary.OutstandingObligations, row)
		return
	}
	if err != nil {
		b.known = false
		reason(&b.summary.Reasons, ReasonObligationAmountUnavailable)
	} else if amount < 0 {
		b.known = false
		reason(&b.summary.Reasons, ReasonNegativeObligationAmount)
	} else {
		row.Amount = money(amount)
		b.total += *row.Amount
	}
	b.summary.OutstandingObligations = append(b.summary.OutstandingObligations, row)
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
	// Only explicit transaction claims suppress occurrences, including pending
	// claims. Simulation's realized rows are never evidence that a bill was paid.
	occurrences := domain.ResolveOccurrences(model.Schedules, transactions, s.Start, s.End, true)
	dates := make([]string, 0, len(occurrences.ByDate))
	for date := range occurrences.ByDate {
		dates = append(dates, date)
	}
	sort.Strings(dates)
	b := &obligationBuilder{
		summary:      s,
		settings:     settings,
		selected:     selected,
		observations: observations,
		ctx:          ctx,
		cut:          cut,
		start:        s.Start,
		seen:         map[string]bool{},
		known:        true,
	}
	for _, date := range dates {
		for _, o := range occurrences.ByDate[date] {
			b.add(o, date)
		}
	}
	// A payment can claim an occurrence inside the requested range while its
	// transaction date is outside it. Keep its exact identity and amount.
	for i := range transactions {
		tx := &transactions[i]
		if tx.Claim != nil && tx.Claim.OccurrenceDate >= b.start && tx.Claim.OccurrenceDate <= s.End {
			b.add(domain.DatedTransactionOccurrence{Transaction: tx}, tx.Claim.OccurrenceDate)
		}
	}
	sort.SliceStable(s.OutstandingObligations, func(i, j int) bool {
		a, b := s.OutstandingObligations[i], s.OutstandingObligations[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		return a.ID < b.ID
	})
	if b.known {
		s.OutstandingBillsTotal = money(b.total)
	}
}
