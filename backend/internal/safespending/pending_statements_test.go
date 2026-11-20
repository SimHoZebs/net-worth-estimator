package safespending

import (
	"slices"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// pricedPendingCharge is a bank-reported authorization on card-a. The hold
// amount resolves from the transaction itself rather than a schedule.
func pricedPendingCharge(id string, amount float64, at string) types.Transaction {
	hold := payment(id, amount, at)
	hold.SourceAccountID = ptr("card-a")
	hold.Pending = true
	hold.PostedTime = 0
	return hold
}

func unpriced(hold types.Transaction) types.Transaction {
	hold.Amount.Inputs["dynamic"] = types.AmountInputBinding{
		Source:    "provider",
		Provider:  "model-value",
		Arguments: map[string]any{"id": "unknown-hold-amount"},
	}
	return hold
}

func TestKnownPendingCardChargeForecastsIntoOpenStatement(t *testing.T) {
	model, settings := paydayFixture()
	model.Transactions = append(model.Transactions,
		pricedPendingCharge("unposted-card-purchase", 35, "2026-11-14T12:00:00Z"))

	s := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, statementAmount(t, s, "card-a", "closed", "2026-10-19"), 500)
	assertMoney(t, statementAmount(t, s, "card-b", "closed", "2026-10-19"), 150)
	assertMoney(t, statementAmount(t, s, "card-a", "estimated", "2026-11-19"), 35)
	assertMoney(t, statementAmount(t, s, "card-b", "estimated", "2026-11-19"), 0)
	assertMoney(t, s.StatementReserve, 685)
	assertMoney(t, s.SafeToSpend, 365)
	if slices.Contains(s.Reasons, ReasonStatementEstimateUnavailable) ||
		slices.Contains(s.Reasons, ReasonStatementBalanceUnavailable) {
		t.Fatalf("priced hold still blanked the payoff: %v", s.Reasons)
	}
	for _, bill := range s.Bills {
		if bill.TransactionID != nil && *bill.TransactionID == "unposted-card-purchase" {
			t.Fatalf("card charge entered the cash bill ledger %+v", bill)
		}
	}
}

func buildBeyondHorizon(t *testing.T, hold *types.Transaction) types.SafeSpendingSummary {
	t.Helper()
	model, settings := paydayFixture()
	model.Accounts[1].StatementClosingDay = 30
	if hold != nil {
		model.Transactions = append(model.Transactions, *hold)
	}
	return BuildAtCut(model, settings, domain.DayCloseUnix("2026-11-30"))
}

func TestLatePricedPendingChargeReservesCarryoverWithoutMovingNextIncome(t *testing.T) {
	base := buildBeyondHorizon(t, nil)
	hold := pricedPendingCharge("unposted-card-purchase", 35, "2026-11-30T12:00:00Z")
	s := buildBeyondHorizon(t, &hold)

	assertMoney(t, statementAmount(t, s, "card-a", "closed", "2026-10-30"), 500)
	assertMoney(t, s.StatementReserve, 650)
	// Carryover is the cycle budget with the cash cushion; the cash timing
	// check is separate from the cycle budget.
	assertMoney(t, base.FundingRoom, 1050)
	assertMoney(t, base.NextCycleCarryover, 1050)
	assertMoney(t, base.SafeToSpend, 400)
	assertMoney(t, s.FundingRoom, 1050)
	assertMoney(t, s.NextCycleCarryover, 1050)
	assertMoney(t, s.SafeToSpend, 365)
	assertMoney(t, base.NextCycleIncome, 400)
	assertMoney(t, s.NextCycleIncome, 365)
	if slices.Contains(s.Reasons, ReasonStatementEstimateUnavailable) {
		t.Fatalf("priced beyond-horizon charge blanked the forecast: %v", s.Reasons)
	}
}

func TestUnknownPendingBeyondHorizonRetainsShortfallGate(t *testing.T) {
	hold := unpriced(pricedPendingCharge("unposted-card-purchase", 35, "2026-11-30T12:00:00Z"))
	s := buildBeyondHorizon(t, &hold)

	assertMoney(t, statementAmount(t, s, "card-a", "closed", "2026-10-30"), 500)
	assertMoney(t, s.StatementReserve, 650)
	if s.FundingRoom != nil || s.NextCycleCarryover != nil || s.SafeToSpend != nil ||
		!slices.Contains(s.Reasons, ReasonStatementEstimateUnavailable) {
		t.Fatalf("unpriced beyond-horizon charge lost its shortfall gate: %+v", s)
	}
}

func TestExactLinkedScheduleReplacesPendingEstimate(t *testing.T) {
	model, settings := paydayFixture()
	scheduled := bill("scheduled-card-charge", "2026-11-16", 50)
	scheduled.SourceAccountID = ptr("card-a")
	hold := unpriced(pricedPendingCharge("pending-card-charge", 0, "2026-11-16T12:00:00Z"))
	hold.Claim = &types.TransactionClaim{ScheduleID: "scheduled-card-charge", OccurrenceDate: "2026-11-16"}
	model.Transactions = append(model.Transactions, hold)
	model.Schedules = append(model.Schedules, scheduled)

	s := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, statementAmount(t, s, "card-a", "estimated", "2026-11-19"), 50)
	assertMoney(t, s.StatementReserve, 700)
	if slices.Contains(s.Reasons, ReasonStatementEstimateUnavailable) {
		t.Fatalf("exact claimed occurrence left the payoff unknown: %v", s.Reasons)
	}
}

func TestPendingCardChargePostsAsOneExpense(t *testing.T) {
	model, settings := paydayFixture()
	hold := pricedPendingCharge("card-purchase", 35, "2026-11-14T12:00:00Z")
	model.Transactions = append(model.Transactions, hold)
	before := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, statementAmount(t, before, "card-a", "estimated", "2026-11-19"), 35)

	model.Transactions[0].Pending = false
	model.Transactions[0].PostedTime = stamp("2026-11-14T13:00:00Z")
	after := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, statementAmount(t, after, "card-a", "estimated", "2026-11-19"), 35)
	assertMoney(t, after.StatementReserve, 685)
	assertMoney(t, after.SafeToSpend, 365)
}

func TestPendingClaimAndPostedReplacementCountOnce(t *testing.T) {
	model, settings := paydayFixture()
	scheduled := bill("scheduled-card-charge", "2026-11-16", 50)
	scheduled.SourceAccountID = ptr("card-a")
	hold := pricedPendingCharge("pending-card-charge", 35, "2026-11-16T12:00:00Z")
	hold.Claim = &types.TransactionClaim{ScheduleID: "scheduled-card-charge", OccurrenceDate: "2026-11-16"}
	posted := payment("posted-card-charge", 50, "2026-11-16T12:00:00Z")
	posted.SourceAccountID = ptr("card-a")
	posted.Claim = &types.TransactionClaim{ScheduleID: "scheduled-card-charge", OccurrenceDate: "2026-11-16"}
	model.Transactions = append(model.Transactions, hold, posted)
	model.Schedules = append(model.Schedules, scheduled)

	s := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, statementAmount(t, s, "card-a", "estimated", "2026-11-19"), 50)
	assertMoney(t, s.StatementReserve, 700)
}

func TestUnknownPendingAmountOnlyBlanksAffectedEstimate(t *testing.T) {
	model, settings := paydayFixture()
	model.Transactions = append(model.Transactions,
		unpriced(pricedPendingCharge("unposted-card-purchase", 35, "2026-11-14T12:00:00Z")))

	s := BuildAtCut(model, settings, stamp(paydayCut))
	assertMoney(t, statementAmount(t, s, "card-a", "closed", "2026-10-19"), 500)
	assertMoney(t, statementAmount(t, s, "card-b", "closed", "2026-10-19"), 150)
	assertMoney(t, statementAmount(t, s, "card-b", "estimated", "2026-11-19"), 0)
	if statementAmount(t, s, "card-a", "estimated", "2026-11-19") != nil ||
		s.StatementReserve != nil || s.SafeToSpend != nil ||
		!slices.Contains(s.Reasons, ReasonStatementEstimateUnavailable) {
		t.Fatalf("unknown amount affected more than its own estimate: %+v", s)
	}
}

func TestPendingCardRepaymentIsNotConfirmedCash(t *testing.T) {
	model, settings := paydayFixture()
	repayment := payment("pending-card-repayment", 100, "2026-11-14T12:00:00Z")
	repayment.Destinations = []string{"card-a"}
	repayment.Pending = true
	repayment.PostedTime = 0
	model.Transactions = append(model.Transactions, repayment)

	s := BuildAtCut(model, settings, stamp(paydayCut))
	if statementAmount(t, s, "card-a", "closed", "2026-10-19") != nil ||
		s.StatementReserve != nil || s.SafeToSpend != nil {
		t.Fatalf("unconfirmed repayment reduced the payoff or invented cash: %+v", s)
	}
}
