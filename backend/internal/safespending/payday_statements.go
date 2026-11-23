package safespending

import (
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type statementClose struct {
	date   string
	closed bool
}

type statementPayoff struct {
	date   string
	amount *float64
}

type carriedStatementScope struct {
	reset, nextFundingDate string
}

// effectiveCards mirrors the frontend's declared-credit-card selection in
// both paths. A null selection falls back to every enabled credit_card
// account. An explicit selection is authoritative but still limited to
// declared credit cards, so a neutral synced cash account or an unrelated loan
// is never tracked as a card and a declared card is never silently dropped.
func effectiveCards(model *types.FinancialModel, settings *types.SafeSpendingSettings) []types.Account {
	cards := []types.Account{}
	for _, account := range model.Accounts {
		if account.Enabled && account.Kind == types.AccountKindCreditCard {
			cards = append(cards, account)
		}
	}
	if settings.AccountIDs == nil {
		return cards
	}
	chosen := []types.Account{}
	for _, account := range cards {
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

// statementCloses assigns a statement to the first payoff strictly after its
// close. A close on today's date is an estimate until end-of-day evidence.
func statementCloses(day int, today, firstPayoff, lastPayoff string, cut int64) []statementClose {
	closes := []statementClose{}
	current := lastClosingBefore(day, today)
	if today < firstPayoff && cut >= domain.DayCloseUnix(today) {
		current = lastClosingBefore(day, nextIsoDay(today))
	}
	closes = append(closes, statementClose{date: current, closed: true})
	for {
		next := nextClosingAfter(day, current)
		if next >= lastPayoff {
			break
		}
		closes = append(closes, statementClose{date: next})
		current = next
	}
	return closes
}

func buildStatements(st *cutState, payoff string) *float64 {
	exact := true
	total := 0.0
	cards := effectiveCards(st.model, st.settings)
	tracked := trackedCards(cards)
	for _, card := range cards {
		closes := statementCloses(accountClosingDay(card), st.s.CashAsOf, payoff, payoff, st.cut)
		amounts, known, _ := cardStatementRows(st, card.ID, closes, tracked, []string{payoff}, nil)
		if amounts == nil {
			amounts = make([]*float64, len(closes))
		}
		if !known {
			exact = false
		}
		for i, close := range closes {
			kind := "estimated"
			if close.closed {
				kind = "closed"
			}
			if amounts[i] == nil && (close.closed || amounts[0] != nil) {
				cause := ReasonStatementEstimateUnavailable
				if close.closed {
					cause = ReasonStatementBalanceUnavailable
				}
				reason(&st.s.Reasons, cause)
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

func followingStatementReserves(st *cutState, payoffs []string, nextFundingDate string) ([]statementPayoff, *float64, *float64) {
	totals := make([]float64, len(payoffs))
	followingKnown, carriedKnown, outsideKnown := true, true, true
	carried, outsideHorizon := 0.0, 0.0
	first, last := payoffs[0], payoffs[len(payoffs)-1]
	cards := effectiveCards(st.model, st.settings)
	tracked := trackedCards(cards)
	scope := carriedStatementScope{reset: st.s.CycleReset, nextFundingDate: nextFundingDate}
	for _, card := range cards {
		closes := statementCloses(accountClosingDay(card), st.s.CashAsOf, first, last, st.cut)
		rows, exact, _ := cardStatementRows(st, card.ID, closes, tracked, payoffs, nil)
		followingKnown = followingKnown && exact
		if exact {
			for i, close := range closes {
				owner := sort.SearchStrings(payoffs, nextIsoDay(close.date))
				totals[owner] += *rows[i]
			}
		} else if len(rows) > 0 && rows[0] != nil {
			reason(&st.s.Reasons, ReasonStatementEstimateUnavailable)
		}
		// Reserve pre-reset charges due at later payoffs only when their cash
		// debit belongs to the next funding bucket. An autopay funded in the
		// current bucket has already used cash, so net it against these charges.
		if scope.reset <= lastClosingBefore(accountClosingDay(card), first) {
			continue
		}
		rows, exact, beyond := cardStatementRows(st, card.ID, closes, tracked, payoffs, &scope)
		carriedKnown = carriedKnown && exact
		outsideKnown = outsideKnown && exact
		outsideHorizon += beyond
		if exact {
			for i, close := range closes {
				owner := sort.SearchStrings(payoffs, nextIsoDay(close.date))
				if owner > 0 && payoffs[owner] >= scope.nextFundingDate {
					carried += *rows[i]
				}
			}
		} else if len(rows) > 0 && rows[0] != nil {
			reason(&st.s.Reasons, ReasonStatementEstimateUnavailable)
		}
	}
	reserves := make([]statementPayoff, len(payoffs))
	for i, date := range payoffs {
		reserves[i].date = date
		if i == 0 {
			reserves[i].amount = st.s.StatementReserve
		} else if followingKnown {
			reserves[i].amount = money(totals[i])
		}
	}
	var carriedAmount *float64
	if carriedKnown {
		carriedAmount = money(carried)
	}
	var outsideAmount *float64
	if outsideKnown {
		outsideAmount = money(outsideHorizon)
	}
	return reserves, carriedAmount, outsideAmount
}

func trackedCards(cards []types.Account) map[string]bool {
	tracked := map[string]bool{}
	for _, card := range cards {
		tracked[card.ID] = true
	}
	return tracked
}

// cardActivity carries the owed change for one dated row. A charge raises the
// balance of the statement whose period contains the row; a payment settles
// the oldest unpaid statement and any excess moves forward, never back.
type cardActivity struct {
	date            string
	charge          float64
	payment         float64
	firstPayoffOnly bool
}

// transferLeg tells how one single-destination movement touches a card. It
// follows cashDelta in the balance application: the source balance falls by the
// amount and the destination balance rises by it, so with debt = max(0,
// -balance) the source owes more (a charge) and the destination owes less (a
// payment). Each leg is dated on the card's own statement ledger.
type transferLeg int

const (
	legNone transferLeg = iota
	legCharge
	legPayment
)

// recordedLeg classifies a posted movement. Both ends must be tracked cards so
// that an internal transfer is never mistaken for cash settling a purchase.
// Multi-destination rows are rejected by the caller because no share is known.
func recordedLeg(tx types.Transaction, cardID string, tracked map[string]bool) transferLeg {
	if tx.SourceAccountID == nil || len(tx.Destinations) != 1 {
		return legNone
	}
	src := *tx.SourceAccountID
	dst := tx.Destinations[0]
	if !tracked[src] || !tracked[dst] || src == dst {
		return legNone
	}
	switch cardID {
	case src:
		return legCharge
	case dst:
		return legPayment
	}
	return legNone
}

// scheduledLeg classifies a rule occurrence on the same cashDelta basis. A
// rule authored on the card charges it, whether or not it hands the debt to a
// tracked destination; a rule landing on this card from a tracked card pays it
// down. A split routing has no per-card share, so the caller keeps the payoff
// unavailable.
func scheduledLeg(rule types.Schedule, cardID string, tracked map[string]bool) (transferLeg, bool) {
	if rule.SourceAccountID == nil {
		return legNone, true
	}
	if len(rule.Destinations) > 1 {
		return legNone, false
	}
	src := *rule.SourceAccountID
	if src == cardID {
		return legCharge, true
	}
	if len(rule.Destinations) == 1 && tracked[src] && rule.Destinations[0] == cardID {
		return legPayment, true
	}
	return legNone, true
}

// cardStatementRows computes one payoff per close in date order. Each newer
// statement is funded only by its own period's charges, so summing the rows
// never counts a carried balance twice. Payments are allocated oldest first
// across all rows with the remainder carried forward.
func cardStatementRows(st *cutState, cardID string, closes []statementClose, tracked map[string]bool, payoffs []string, carry *carriedStatementScope) ([]*float64, bool, float64) {
	model, cut := st.model, st.cut
	first := closes[0].date
	closeCut := min(domain.DayCloseUnix(first), cut)
	evidence := cashEvidence(model, st.settings, closeCut)
	balance, observed := evidence.balances[cardID]
	if !observed {
		return nil, false, 0
	}
	// Opening balance is bank evidence at the close. Applying history to that instant
	// includes charges made after an earlier checkpoint.
	bases := make([]float64, len(closes))
	// A positive card balance is a credit against later charges.
	bases[0] = -balance
	unknownFrom := len(closes)
	pendingOutsideForecast := false
	outsideHorizon := 0.0

	claims := claimState(model, cut)
	activities := []cardActivity{}
	for _, tx := range model.Transactions {
		if !recordedByCut(tx, cut) || !touches(tx, cardID) {
			continue
		}
		date := postingDay(tx)
		incurred := date
		if tx.Pending {
			// An authorization that remains open cannot post into a prior
			// close. Keep the observed statement and locate the potential
			// liability using the earliest date it could still post.
			date = max(date, st.s.CashAsOf)
			if cut >= domain.DayCloseUnix(date) {
				date = nextIsoDay(date)
			}
		}
		if date <= first {
			continue
		}
		leg := recordedLeg(tx, cardID, tracked)
		isPayment := leg == legPayment || (leg == legNone && cashPaymentToCard(model, tx, cardID))
		// A split incoming transfer can be a payment without a known
		// allocation; it may change the oldest statement rather than just
		// the open one.
		if len(tx.Destinations) > 1 && contains(tx.Destinations, cardID) && tx.SourceAccountID != nil {
			return nil, false, 0
		}
		period := periodOf(closes, date)
		if !isPayment {
			if carry != nil && incurred >= carry.reset {
				continue
			}
			if period < 0 {
				// A priced current-cycle authorization still belongs to this
				// funding bucket when its payoff is past the ledger horizon.
				// Reserve it once as outside-horizon carry: no in-range row
				// exists and no next-bucket debit offset is attached to it.
				if carry != nil && tx.Pending && tx.SourceAccountID != nil && *tx.SourceAccountID == cardID {
					if tx.Claim != nil && claims.settled[*tx.Claim] {
						continue
					}
					if held := pendingCardChargeAmount(st, tx); held != nil {
						outsideHorizon += *held
					} else {
						pendingOutsideForecast = true
					}
				}
				continue
			}
		}
		amount, known := st.ctx.latest[tx.ID]
		if tx.Pending {
			// A bank-reported authorization is evidence at the cut. A priced
			// card purchase is forecast as posted, into the earliest open
			// statement selected above. A pending repayment is not confirmed
			// cash, so it keeps the conservative gate rather than lowering a
			// payoff or borrowing from a later funding bucket.
			if isPayment {
				return nil, false, 0
			}
			if tx.Claim != nil && claims.settled[*tx.Claim] {
				continue
			}
			if held := pendingCardChargeAmount(st, tx); held != nil {
				amount, known = *held, true
			}
		}
		if !known || len(tx.Destinations) > 1 {
			if isPayment {
				return nil, false, 0
			}
			unknownFrom = min(unknownFrom, period)
			continue
		}
		switch leg {
		case legCharge:
			// The source balance falls, so this card owes more as of the date.
			activities = append(activities, cardActivity{date: date, charge: amount})
		case legPayment:
			// The destination balance rises, so this card owes less. No cash
			// movement is added: history application already applied cashDelta once.
			activities = append(activities, cardActivity{date: date, payment: amount})
		default:
			if isPayment {
				activities = append(activities, cardActivity{date: date, payment: amount})
			} else {
				activities = append(activities, cardActivity{date: date, charge: -cashDelta(tx, cardID, amount)})
			}
		}
	}

	cardRules := []types.Schedule{}
	for _, rule := range model.Schedules {
		if !rule.Enabled || rule.SourceAccountID == nil {
			continue
		}
		// A rule on the card is a charge unless it hands the debt to another
		// tracked card. A rule from a tracked card into this one adds debt too.
		if *rule.SourceAccountID == cardID ||
			(tracked[*rule.SourceAccountID] && contains(rule.Destinations, cardID)) {
			cardRules = append(cardRules, rule)
		}
	}
	through := payoffs[len(payoffs)-1]
	occurrences := domain.ResolveOccurrences(cardRules, nil, nextIsoDay(first), through, true)
	for date, rows := range occurrences.ByDate {
		for _, row := range rows {
			claim := types.TransactionClaim{ScheduleID: row.Rule.ID, OccurrenceDate: date}
			if claims.settled[claim] || claims.pending[claim] {
				continue
			}
			leg, ok := scheduledLeg(*row.Rule, cardID, tracked)
			if carry != nil {
				if leg == legPayment && date > payoffs[0] && date >= carry.nextFundingDate {
					continue
				}
				if leg != legPayment && date >= carry.reset {
					continue
				}
			}
			if leg != legPayment && periodOf(closes, date) < 0 {
				continue
			}
			amount, err := st.ctx.resolve(row, date)
			if !ok || err != nil || amount < 0 {
				if leg != legCharge {
					return nil, false, 0
				}
				unknownFrom = min(unknownFrom, periodOf(closes, date))
				continue
			}
			switch leg {
			case legCharge:
				activities = append(activities, cardActivity{date: date, charge: amount})
			case legPayment:
				activities = append(activities, cardActivity{date: date, payment: amount})
			}
		}
	}

	for _, bill := range st.s.Bills {
		date := max(st.s.CashAsOf, bill.Date)
		if date > through || (carry != nil && date > payoffs[0] && date >= carry.nextFundingDate) || bill.Status == "paid" {
			continue
		}
		applies, allocated := scheduledPaymentTo(bill.ScheduleID, model, cardID)
		if !applies {
			continue
		}
		if !allocated {
			return nil, false, 0
		}
		if bill.Status == "unpaid" {
			if bill.Amount == nil {
				return nil, false, 0
			}
			activities = append(activities, cardActivity{
				date: date, payment: *bill.Amount,
				firstPayoffOnly: carry != nil && date >= carry.nextFundingDate,
			})
			continue
		}
		return nil, false, 0
	}

	// Net each period before clamping so a refund before a purchase cannot be
	// discarded by an intermediate zero.
	for _, activity := range activities {
		if index := periodOf(closes, activity.date); index > 0 {
			bases[index] += activity.charge
		}
	}

	// Prior payments settle the oldest outstanding amounts first. A later
	// next-funded payment cannot replace an earlier payment already applied
	// to the first payoff, and cannot roll into current-funded carryover.
	sort.SliceStable(activities, func(i, j int) bool { return activities[i].date < activities[j].date })
	remaining := 0.0
	rows := make([]*float64, len(closes))
	i, nextActivity := 0, 0
	for _, payoff := range payoffs {
		start := nextActivity
		for nextActivity < len(activities) && activities[nextActivity].date <= payoff {
			nextActivity++
		}
		credits := activities[start:nextActivity]
		for i < len(closes) && closes[i].date < payoff {
			if i >= unknownFrom {
				return rows, false, 0
			}
			base := bases[i] - remaining
			remaining = max(0, -base)
			for len(credits) > 0 && base > 0 {
				applied := min(base, credits[0].payment)
				base -= applied
				credits[0].payment -= applied
				if credits[0].payment <= 0 {
					credits = credits[1:]
				}
			}
			rows[i] = money(max(0, base))
			i++
		}
		for _, credit := range credits {
			if !credit.firstPayoffOnly {
				remaining += credit.payment
			}
		}
	}
	return rows, !pendingOutsideForecast, outsideHorizon
}

// pendingCardChargeAmount prices a bank-reported card purchase from its own
// hold, falling back to an exact claimed occurrence when the hold is unpriced.
func pendingCardChargeAmount(st *cutState, tx types.Transaction) *float64 {
	if held := st.ctx.holdAmount(tx); held != nil {
		return held
	}
	return claimedCardChargeAmount(st, tx)
}

// claimedCardChargeAmount prices a pending card purchase from the exact
// schedule it claims when the bank hold has no usable amount. The claim
// suppresses that occurrence in the rule loop, so this is its single count.
func claimedCardChargeAmount(st *cutState, tx types.Transaction) *float64 {
	if tx.Claim == nil {
		return nil
	}
	for i := range st.model.Schedules {
		rule := &st.model.Schedules[i]
		if rule.ID != tx.Claim.ScheduleID {
			continue
		}
		occurrence := domain.DatedTransactionOccurrence{
			Transaction: &types.Transaction{
				ID:              rule.ID,
				Amount:          rule.Amount,
				SourceAccountID: rule.SourceAccountID,
				Destinations:    rule.Destinations,
			},
			Rule: rule,
		}
		amount, err := st.ctx.resolve(occurrence, tx.Claim.OccurrenceDate)
		if err != nil || amount < 0 {
			return nil
		}
		return money(amount)
	}
	return nil
}

// periodOf maps a posted date to its close. Debt after the last included
// close is not yet part of any payoff in this forecast.
func periodOf(closes []statementClose, date string) int {
	for i := 1; i < len(closes); i++ {
		if date <= closes[i].date {
			return i
		}
	}
	return -1
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

func scheduledPaymentTo(scheduleID *string, model *types.FinancialModel, cardID string) (applies, allocated bool) {
	if scheduleID == nil {
		return false, false
	}
	for _, rule := range model.Schedules {
		if rule.ID == *scheduleID {
			return contains(rule.Destinations, cardID), len(rule.Destinations) == 1
		}
	}
	return false, false
}

func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}
