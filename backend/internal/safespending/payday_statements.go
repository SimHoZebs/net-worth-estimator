package safespending

import (
	"sort"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type statementClose struct {
	date   string
	closed bool
}

// effectiveCards mirrors useSafeSpendingSelections: enabled debt accounts are
// the candidates, independent of optional minimum payment terms. A null
// selection falls back to IDs ending in _card when any exist, otherwise to
// every debt account; an explicit, even empty, selection keeps only those IDs.
func effectiveCards(model *types.FinancialModel, settings *types.SafeSpendingSettings) []types.Account {
	candidates := []types.Account{}
	for _, account := range model.Accounts {
		if account.Enabled && account.Kind == types.AccountKindDebt {
			candidates = append(candidates, account)
		}
	}
	if settings.AccountIDs == nil {
		cardLike := []types.Account{}
		for _, account := range candidates {
			if strings.HasSuffix(account.ID, "_card") {
				cardLike = append(cardLike, account)
			}
		}
		if len(cardLike) > 0 {
			return cardLike
		}
		return candidates
	}
	chosen := []types.Account{}
	for _, account := range candidates {
		for _, id := range settings.AccountIDs {
			if account.ID == id {
				chosen = append(chosen, account)
				break
			}
		}
	}
	return chosen
}

func accountClosingDay(account types.Account) int {
	if day := account.StatementClosingDay; day >= 1 && day <= 31 {
		return day
	}
	return defaultClosingDay
}

// statementCloses enumerates every close that must be settled by payday. A
// close on today has not happened at a midday cut, so it is a projection even
// when today is the card's closing day.
func statementCloses(day int, today, payday string) []statementClose {
	closes := []statementClose{}
	current := lastClosingBefore(day, today)
	closes = append(closes, statementClose{date: current, closed: true})
	if payday == "" {
		return closes
	}
	for {
		next := nextClosingAfter(day, current)
		if next > payday {
			break
		}
		closes = append(closes, statementClose{date: next})
		current = next
	}
	return closes
}

func buildStatements(st *cutState, model *types.FinancialModel, settings *types.SafeSpendingSettings, today, payday string, cut int64) *float64 {
	exact := true
	total := 0.0
	for _, card := range effectiveCards(model, settings) {
		closes := statementCloses(accountClosingDay(card), today, payday)
		amounts, known := cardStatementRows(st, model, card.ID, closes, cut)
		if amounts == nil {
			amounts = make([]*float64, len(closes))
		}
		if !known {
			exact = false
			cause := ReasonStatementEstimateUnavailable
			if closes[0].closed {
				cause = ReasonStatementBalanceUnavailable
			}
			reason(&st.s.Reasons, cause)
		}
		for i, close := range closes {
			kind := "estimated"
			if close.closed {
				kind = "closed"
			}
			st.s.Statements = append(st.s.Statements, types.SafeSpendingStatement{
				AccountID:   card.ID,
				Name:        card.Name,
				ClosingDate: close.date,
				Kind:        kind,
				Amount:      amounts[i],
			})
			if amounts[i] != nil {
				total += *amounts[i]
			}
		}
	}
	sort.Slice(st.s.Statements, func(i, j int) bool {
		a, b := st.s.Statements[i], st.s.Statements[j]
		if a.ClosingDate != b.ClosingDate {
			return a.ClosingDate < b.ClosingDate
		}
		return a.AccountID < b.AccountID
	})
	if !exact {
		return nil
	}
	return money(total)
}

// cardActivity carries the owed change for one dated row. A charge raises the
// balance of the statement whose period contains the row; a payment settles
// the oldest unpaid statement and any excess moves forward, never back.
type cardActivity struct {
	date    string
	charge  float64
	payment float64
}

// cardStatementRows computes one payoff per close in date order. Each newer
// statement is funded only by its own period's charges, so summing the rows
// never counts a carried balance twice. Payments are allocated oldest first
// across all rows with the remainder carried forward.
func cardStatementRows(st *cutState, model *types.FinancialModel, cardID string, closes []statementClose, cut int64) ([]*float64, bool) {
	first := closes[0].date
	closeCut := min(domain.DayCloseUnix(first), cut)
	evidence := cashEvidence(model, st.settings, closeCut)
	balance, observed := evidence.balances[cardID]
	if !observed {
		return nil, false
	}
	// Opening balance is bank evidence at the close. Replaying to that instant
	// includes charges made after an earlier checkpoint.
	bases := make([]float64, len(closes))
	bases[0] = max(0, -balance)

	claims := claimState(model, cut)
	activities := []cardActivity{}
	for _, tx := range model.Transactions {
		if !fact(tx) || !touches(tx, cardID) {
			continue
		}
		if len(tx.Destinations) > 1 {
			return nil, false // no allocation evidence for a split movement
		}
		date := transactionDay(tx)
		if date <= first {
			continue
		}
		amount, err := st.ctx.resolveFact(tx)
		if err != nil {
			return nil, false
		}
		if tx.Pending || domain.TransactionInstant(&tx) > cut {
			return nil, false
		}
		if cashPaymentToCard(model, tx, cardID) {
			activities = append(activities, cardActivity{date: date, payment: amount})
			continue
		}
		activities = append(activities, cardActivity{date: date, charge: -cashDelta(tx, cardID, amount)})
	}

	cardRules := []types.Schedule{}
	for _, rule := range model.Schedules {
		if rule.Enabled && rule.SourceAccountID != nil && *rule.SourceAccountID == cardID {
			cardRules = append(cardRules, rule)
		}
	}
	for i := 1; i < len(closes); i++ {
		occurrences := domain.ResolveOccurrences(cardRules, nil, nextIsoDay(closes[i-1].date), closes[i].date, true)
		for date, rows := range occurrences.ByDate {
			for _, row := range rows {
				if row.Rule == nil {
					continue
				}
				claim := types.TransactionClaim{ScheduleID: row.Rule.ID, OccurrenceDate: date}
				if claims.settled[claim] || claims.pending[claim] {
					continue
				}
				amount, err := st.ctx.resolve(row, date)
				if err != nil || amount < 0 {
					return nil, false
				}
				activities = append(activities, cardActivity{date: date, charge: amount})
			}
		}
	}

	for _, bill := range st.s.Bills {
		if bill.ScheduleID == nil || bill.Date <= first || !scheduledPaymentTo(bill.ScheduleID, model, cardID) {
			continue
		}
		if bill.Status == "unpaid" {
			if bill.Amount == nil {
				return nil, false
			}
			activities = append(activities, cardActivity{date: bill.Date, payment: *bill.Amount})
			continue
		}
		if bill.Status != "paid" {
			return nil, false
		}
	}

	// Net each period before clamping so a refund before a purchase cannot be
	// discarded by an intermediate zero.
	for _, activity := range activities {
		if index := periodOf(closes, activity.date); index > 0 {
			bases[index] += activity.charge
		}
	}
	for i := range bases {
		bases[i] = max(0, bases[i])
	}

	remaining := 0.0
	for _, activity := range activities {
		remaining += activity.payment
	}
	rows := make([]*float64, len(closes))
	for i, base := range bases {
		rows[i] = money(max(0, base-remaining))
		remaining = max(0, remaining-base)
	}
	return rows, true
}

// periodOf maps a date to the close whose period contains it. Dates after the
// last close belong to that last statement because payday settles it too.
func periodOf(closes []statementClose, date string) int {
	for i := 1; i < len(closes); i++ {
		if date <= closes[i].date {
			return i
		}
	}
	return len(closes) - 1
}

// cashPaymentToCard identifies a settlement by a cash account, selected or
// not. An external refund has no source account and adjusts the open statement
// instead. Split routing is rejected by the caller because no share is known.
func cashPaymentToCard(model *types.FinancialModel, tx types.Transaction, cardID string) bool {
	if tx.SourceAccountID == nil || !contains(tx.Destinations, cardID) {
		return false
	}
	for _, account := range model.Accounts {
		if account.ID == *tx.SourceAccountID {
			return account.Kind == types.AccountKindCash || account.Kind == types.AccountKindInvestment
		}
	}
	return false
}

func scheduledPaymentTo(scheduleID *string, model *types.FinancialModel, cardID string) bool {
	if scheduleID == nil {
		return false
	}
	for _, rule := range model.Schedules {
		if rule.ID == *scheduleID {
			return contains(rule.Destinations, cardID)
		}
	}
	return false
}

func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}
