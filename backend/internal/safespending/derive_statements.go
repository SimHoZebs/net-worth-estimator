package safespending

import (
	"sort"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// DeriveStatements reconstructs the full close history of every enabled credit
// card from the card's closing-day cadence and recorded bank evidence. The
// billed amount of a closed statement is the bank-observed balance at that
// close, negated into debt; the open cycle is priced with the same replay
// engine the forecast uses (cardStatementRows). A close with no observation in
// its cycle stays unknown instead of being invented from a closing day or a
// current balance. Payment terms supply due dates; a card without terms keeps
// a null due date.
func DeriveStatements(model *types.FinancialModel, settings *types.SafeSpendingSettings, cut int64) []types.DerivedStatement {
	if settings == nil {
		settings = &types.SafeSpendingSettings{}
	}
	if model == nil {
		model = &types.FinancialModel{}
	}
	st := cashEvidence(model, settings, cut)
	today := st.s.CashAsOf
	dayClose := cut >= domain.DayCloseUnix(today)

	cards := []types.Account{}
	for _, account := range model.Accounts {
		if account.Enabled && account.Kind == types.AccountKindCreditCard {
			cards = append(cards, account)
		}
	}
	tracked := trackedCards(cards)
	terms := domain.PaymentTermsByAccount(model)
	observations := checkpointObservations(model, cut, today)

	payoffDay := calendarDay(settings.PaydayDay, types.DefaultSafeSpendingPaydayDay)
	payoff := nextClosingAfter(payoffDay, today)

	derived := []types.DerivedStatement{}
	for _, card := range cards {
		day := accountClosingDay(card)
		lastClosed := lastClosingBefore(day, today)
		if dayClose {
			lastClosed = lastClosingBefore(day, nextIsoDay(today))
		}
		estimated := nextClosingAfter(day, lastClosed)

		// A statement is priced only by an observation made within its own
		// cycle: after the previous close and on or before this close. Earlier
		// or missing observations never get reused as a later billed amount.
		closes := closeDatesBetween(day, firstHistoryClose(day, observations[card.ID], model, card.ID, today), lastClosed)
		closes = append(closes, estimated)

		amounts := map[string]*float64{}
		obs := observations[card.ID]
		for _, close := range closes {
			previous := lastClosingBefore(day, close)
			for i := len(obs) - 1; i >= 0; i-- {
				cp := obs[i]
				if cp.day > previous && cp.day <= close {
					amount := -cp.balance // a negative bank balance is debt owed
					if amount < 0 {
						amount = 0
					}
					priced := domain.MoneyCents(amount)
					value := domain.MoneyFromCents(priced)
					amounts[close] = &value
					break
				}
			}
		}

		// The open cycle has no close observation yet. Price it with the
		// forecast engine when a cycle observation is available, so an
		// estimated statement is a replay estimate, never an invented fact.
		if _, ok := amounts[estimated]; !ok && lastClosed != "" {
			estimate := estimateOpenCycle(st, card.ID, day, lastClosed, estimated, payoff, tracked)
			if estimate != nil {
				amounts[estimated] = estimate
			}
		}

		for _, close := range closes {
			amount := amounts[close]
			kind := "estimated"
			if close != estimated {
				kind = "closed"
			}
			if amount == nil {
				kind = "unknown"
			}
			statement := types.DerivedStatement{
				ID:          types.DerivedStatementID(card.ID, close),
				AccountID:   card.ID,
				ClosingDate: close,
				Balance:     amount,
				Kind:        kind,
				Currency:    domain.DefaultCardStatementCurrency,
			}
			if termsForCard, ok := terms[card.ID]; ok && termsForCard.DueDay >= 1 && termsForCard.DueDay <= 31 {
				due := nextClosingAfter(termsForCard.DueDay, close)
				statement.DueDate = &due
			}
			derived = append(derived, statement)
		}
	}

	sort.Slice(derived, func(i, j int) bool {
		a, b := derived[i], derived[j]
		if a.ClosingDate != b.ClosingDate {
			return a.ClosingDate < b.ClosingDate
		}
		return a.AccountID < b.AccountID
	})
	return derived
}

type checkpointObservation struct {
	day     string
	balance float64
}

// checkpointObservations collects each card's bank observations in day order.
func checkpointObservations(model *types.FinancialModel, cut int64, today string) map[string][]checkpointObservation {
	byCard := map[string][]checkpointObservation{}
	for _, cp := range model.Checkpoints {
		if cp.ObservedAt > cut {
			continue
		}
		day := domain.FormatIsoDate(time.Unix(cp.ObservedAt, 0).UTC())
		if day > today {
			day = today
		}
		byCard[cp.AccountID] = append(byCard[cp.AccountID], checkpointObservation{day: day, balance: cp.Balance})
	}
	for _, rows := range byCard {
		sort.Slice(rows, func(i, j int) bool { return rows[i].day < rows[j].day })
	}
	return byCard
}

// firstHistoryClose bounds how far back unknown history is enumerated: the
// earliest of a card's first observation and its first posted movement.
func firstHistoryClose(day int, observations []checkpointObservation, model *types.FinancialModel, cardID, today string) string {
	start := today
	if len(observations) > 0 && observations[0].day < start {
		start = observations[0].day
	}
	for _, tx := range model.Transactions {
		if !recordedByCut(tx, domain.DayCloseUnix(today)) || !touches(tx, cardID) {
			continue
		}
		posted := postingDay(tx)
		if posted != "" && posted < start {
			start = posted
		}
	}
	return nextClosingAfter(day, previousIsoDay(start))
}

// closeDatesBetween enumerates closing dates from first through last inclusive.
func closeDatesBetween(day int, first, last string) []string {
	dates := []string{}
	if first == "" || first > last {
		return dates
	}
	for date := first; date <= last; date = nextClosingAfter(day, date) {
		dates = append(dates, date)
	}
	return dates
}

// estimateOpenCycle reuses the forecast's replay to price the current open
// cycle from the most recent closed statement. It never turns an estimate into
// a closed statement.
func estimateOpenCycle(st *cutState, cardID string, day int, lastClosed, estimated, payoff string, tracked map[string]bool) *float64 {
	closePayoff := payoff
	if closePayoff <= estimated {
		closePayoff = nextIsoDay(estimated)
	}
	closes := []statementClose{{date: lastClosed, closed: true}, {date: estimated, closed: false}}
	amounts, _, _ := cardStatementRows(st, cardID, closes, tracked, []string{closePayoff}, nil)
	if len(amounts) < 2 || amounts[1] == nil {
		return nil
	}
	return amounts[1]
}
