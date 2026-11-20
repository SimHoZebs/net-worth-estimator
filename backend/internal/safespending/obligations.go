package safespending

import (
	"fmt"
	"math"
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
	return utcDay(domain.TransactionInstant(&tx))
}

func postingDay(tx types.Transaction) string {
	return utcDay(max(domain.TransactionInstant(&tx), tx.PostedTime))
}

func utcDay(instant int64) string {
	return domain.FormatIsoDate(time.Unix(instant, 0))
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

// Expand selected schedules first so claims enrich the same occurrence identity
// even when a payment posts outside the period or for a different amount.
func buildObligations(s *types.SafeSpendingSummary, model *types.FinancialModel, settings *types.SafeSpendingSettings, selected map[string]bool, ctx *amounts, cut int64, start, end string, accountStarts map[string]string) *float64 {
	claims := map[types.TransactionClaim]*types.Transaction{}
	for i := range model.Transactions {
		tx := &model.Transactions[i]
		if tx.Claim != nil && recordedByCut(*tx, cut) {
			prior := claims[*tx.Claim]
			if prior == nil || (prior.Pending && !tx.Pending) {
				claims[*tx.Claim] = tx
			}
		}
	}
	// A posted settlement that happens inside the current payment window bars
	// its exact occurrence even when that occurrence came due in an earlier
	// period. Keeping the row prevents a payment the bar already knows about
	// from resurfacing as an unpaid bill. An unlinked older occurrence has no
	// such evidence and stays outside the forecast: its missing link says
	// nothing about whether the bill was paid.
	barred := map[types.TransactionClaim]bool{}
	for claim, tx := range claims {
		if tx.Pending || !posted(*tx, cut) {
			continue
		}
		day := postingDay(*tx)
		if day >= s.PaymentPeriodStart && day <= s.PayoffDate && claim.OccurrenceDate < s.PaymentPeriodStart {
			barred[claim] = true
		}
	}
	occurrenceStart := start
	for claim := range barred {
		occurrenceStart = min(occurrenceStart, claim.OccurrenceDate)
	}
	schedules := effectiveBills(model.Schedules, selected, settings.TransactionIDs)
	total := 0.0
	exact := true
	for date, occurrences := range domain.ResolveOccurrences(schedules, nil, occurrenceStart, end, true).ByDate {
		for _, o := range occurrences {
			claim := types.TransactionClaim{ScheduleID: o.Rule.ID, OccurrenceDate: date}
			if earliest := accountStarts[*o.Rule.SourceAccountID]; earliest != "" && date < earliest && !barred[claim] {
				continue
			}
			row, cause := billEvidence(o, date, claims[claim], selected, ctx)
			if cause != "" {
				reason(&s.Reasons, cause)
				exact = false
			}
			if amount, outstanding := billCashDebit(*row); outstanding {
				addPaymentAmount(&total, &exact, amount)
			}
			s.Bills = append(s.Bills, *row)
		}
	}
	sortBills(s.Bills)
	sort.Strings(s.Reasons)
	if exact {
		return money(total)
	}
	return nil
}

func sortBills(bills []types.SafeSpendingBill) {
	sort.Slice(bills, func(i, j int) bool {
		a, b := bills[i], bills[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		return a.ID < b.ID
	})
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
	// A pending transaction may claim an occurrence without sharing its route.
	// Only a hold on the same cash movement can stand in for the bill in the
	// forecast. The cash baseline independently checks whether it covers that hold.
	if claim != nil && (!claim.Pending || pendingBillRouteMatches(rule, claim)) {
		row.TransactionID = &claim.ID
		if !claim.Pending {
			row.Status = "paid"
			actual := postingDay(*claim)
			row.ActualDate = &actual
			if amount, ok := ctx.latest[claim.ID]; ok {
				row.Amount = money(amount)
			}
			return row, ""
		}
		row.Status = "pending"
		hold := ctx.holdAmount(*claim)
		expected, err := ctx.resolve(o, date)
		if err == nil && expected >= 0 {
			row.Amount = money(expected)
			if hold != nil {
				row.UncoveredHold = money(max(0, expected-*hold))
			}
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

func billCashDebit(bill types.SafeSpendingBill) (*float64, bool) {
	switch bill.Status {
	case "paid":
		return nil, false
	case "pending":
		return bill.UncoveredHold, true
	default:
		return bill.Amount, true
	}
}

func pendingBillRouteMatches(rule *types.Schedule, hold *types.Transaction) bool {
	return hold.SourceAccountID != nil &&
		*hold.SourceAccountID == *rule.SourceAccountID &&
		len(hold.Destinations) <= 1 &&
		slices.Equal(rule.Destinations, hold.Destinations)
}

// flagPossibleHoldOverlap warns about a plausible hold without converting it
// into a claim or dropping the scheduled payment from the forecast.
func flagPossibleHoldOverlap(st *cutState) {
	rules := map[string]*types.Schedule{}
	for i := range st.model.Schedules {
		rule := &st.model.Schedules[i]
		rules[rule.ID] = rule
	}
	for _, tx := range st.transactions {
		if !tx.Pending || tx.Claim != nil || tx.SourceAccountID == nil ||
			!st.selected[*tx.SourceAccountID] || !recordedByCut(tx, st.cut) {
			continue
		}
		cp := st.latest[*tx.SourceAccountID]
		if cp.AvailableBalance == nil || domain.TransactionInstant(&tx) > cp.ObservedAt {
			continue
		}
		amount := st.ctx.holdAmount(tx)
		if amount == nil || *amount <= 0 || *amount > cp.Balance-*cp.AvailableBalance+.005 {
			continue
		}
		heldOn := domain.MustParseIsoDate(transactionDay(tx))
		for _, bill := range st.s.Bills {
			if bill.Date > st.s.PayoffDate || bill.Status != "unpaid" || bill.AccountID != *tx.SourceAccountID ||
				bill.ScheduleID == nil || bill.Amount == nil || *bill.Amount != *amount {
				continue
			}
			rule := rules[*bill.ScheduleID]
			if rule != nil && pendingBillRouteMatches(rule, &tx) &&
				math.Abs(domain.MustParseIsoDate(bill.Date).Sub(heldOn).Hours()/24) <= float64(domain.AutoClaimWindowDays(rule.Recurrence)) {
				reason(&st.s.Reasons, ReasonPossiblePendingPaymentOverlap)
				return
			}
		}
	}
}

func (a *amounts) holdAmount(tx types.Transaction) *float64 {
	// A hold has no replayed settlement amount. The end-of-cut provider
	// context could contain a fact posted after the authorization.
	for _, input := range tx.Amount.Inputs {
		if input.Source != "literal" {
			return nil
		}
	}
	amount, err := a.resolveFact(tx)
	if err != nil || amount < 0 {
		return nil
	}
	return money(amount)
}
