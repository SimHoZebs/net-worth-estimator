package safespending

import (
	"slices"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestClaimStateIndexPostedBeatsPendingRegardlessOfOrder(t *testing.T) {
	for _, postedFirst := range []bool{false, true} {
		t.Run(map[bool]string{false: "pending first", true: "posted first"}[postedFirst], func(t *testing.T) {
			model, _ := paydayFixture()
			claim := types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-11-20"}
			pending := payment("pending-rent", 250, "2026-11-14T18:00:00Z")
			pending.Pending, pending.PostedTime, pending.Enabled = true, 0, false
			pending.Claim = &claim
			posted := payment("posted-rent", 250, "2026-11-14T19:00:00Z")
			posted.Claim = &claim
			if postedFirst {
				model.Transactions = []types.Transaction{posted, pending}
			} else {
				model.Transactions = []types.Transaction{pending, posted}
			}

			state := claimState(model, stamp(paydayCut))
			winner := state.byClaim[claim]
			if winner == nil || winner.ID != posted.ID {
				t.Fatalf("winning claim = %+v, want posted transaction", winner)
			}
			if !state.settled[claim] || state.pending[claim] {
				t.Fatalf("claim sets disagree with winner: %+v", state)
			}
		})
	}
}

func TestSharedClaimStateDrivesObligationsPaydaysAndStatements(t *testing.T) {
	t.Run("obligations use posted winner", func(t *testing.T) {
		model, settings := paydayFixture()
		claim := types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-11-20"}
		pending := payment("pending-rent", 250, "2026-11-14T18:00:00Z")
		pending.Pending, pending.PostedTime, pending.Enabled = true, 0, false
		pending.Claim = &claim
		posted := payment("posted-rent", 250, "2026-11-14T19:00:00Z")
		posted.Claim = &claim
		model.Transactions = []types.Transaction{pending, posted}

		summary := BuildAtCut(model, settings, stamp(paydayCut))
		if len(summary.Bills) != 1 || summary.Bills[0].Status != "paid" || summary.Bills[0].TransactionID == nil || *summary.Bills[0].TransactionID != posted.ID {
			t.Fatalf("obligation did not use posted claim winner: %+v", summary.Bills)
		}
	})

	t.Run("paydays use posted winner", func(t *testing.T) {
		model, settings := paydayFixture()
		claim := types.TransactionClaim{ScheduleID: "salary", OccurrenceDate: "2026-11-30"}
		pending := payment("pending-salary", 400, "2026-11-30T08:00:00Z")
		pending.SourceAccountID, pending.Destinations = nil, []string{"checking"}
		pending.Pending, pending.PostedTime, pending.Enabled = true, 0, false
		pending.Claim = &claim
		posted := payment("posted-salary", 400, "2026-11-30T09:00:00Z")
		posted.SourceAccountID, posted.Destinations = nil, []string{"checking"}
		posted.Claim = &claim
		model.Transactions = []types.Transaction{pending, posted}

		st := cashEvidence(model, settings, domain.DayCloseUnix("2026-11-30"))
		forecasts, known := forecastPaydays(st, "2026-11-30", "2026-12-30")
		if !known || len(forecasts) == 0 {
			t.Fatalf("payday forecast unavailable: %+v known=%v", forecasts, known)
		}
		if slices.ContainsFunc(forecasts, func(row paydayForecast) bool { return row.date == "2026-11-30" }) {
			t.Fatalf("posted payday remained forecast: %+v", forecasts)
		}
		if forecasts[0].date != "2026-12-30" {
			t.Fatalf("next payday = %q, want 2026-12-30", forecasts[0].date)
		}
		assertMoney(t, forecasts[0].income, 400)
	})

	t.Run("statements use posted winner", func(t *testing.T) {
		model, settings := paydayFixture()
		settings.AccountIDs = []string{"card-a"}
		scheduled := bill("scheduled-card-charge", "2026-11-16", 50)
		scheduled.SourceAccountID = ptr("card-a")
		claim := types.TransactionClaim{ScheduleID: scheduled.ID, OccurrenceDate: "2026-11-16"}
		pending := pricedPendingCharge("pending-card-charge", 35, "2026-11-16T12:00:00Z")
		pending.Claim = &claim
		posted := payment("posted-card-charge", 50, "2026-11-16T13:00:00Z")
		posted.SourceAccountID, posted.Destinations = ptr("card-a"), nil
		posted.Claim = &claim
		model.Schedules = append(model.Schedules, scheduled)
		model.Transactions = []types.Transaction{pending, posted}

		summary := BuildAtCut(model, settings, stamp(paydayCut))
		assertMoney(t, statementAmount(t, summary, "card-a", "estimated", "2026-11-19"), 50)
	})
}
