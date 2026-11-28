package safespending

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func derivedStatementAt(t *testing.T, statements []types.DerivedStatement, accountID, close string) types.DerivedStatement {
	t.Helper()
	for _, statement := range statements {
		if statement.AccountID == accountID && statement.ClosingDate == close {
			return statement
		}
	}
	t.Fatalf("derived statement %s %s missing from %+v", accountID, close, statements)
	return types.DerivedStatement{}
}

func TestClosedStatementUsesLatestObservationInstantAndPostedActivity(t *testing.T) {
	for _, tc := range []struct {
		name        string
		checkpoints []types.Checkpoint
	}{
		{
			name: "morning inserted first",
			checkpoints: []types.Checkpoint{
				{AccountID: "card-a", Balance: -100, ObservedAt: stamp("2026-10-19T08:00:00Z")},
				{AccountID: "card-a", Balance: -200, ObservedAt: stamp("2026-10-19T20:00:00Z")},
			},
		},
		{
			name: "morning inserted last",
			checkpoints: []types.Checkpoint{
				{AccountID: "card-a", Balance: -200, ObservedAt: stamp("2026-10-19T20:00:00Z")},
				{AccountID: "card-a", Balance: -100, ObservedAt: stamp("2026-10-19T08:00:00Z")},
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			model, settings := paydayFixture()
			settings.AccountIDs = []string{"card-a"}
			model.Checkpoints = model.Checkpoints[:1]
			model.Checkpoints = append(model.Checkpoints, tc.checkpoints...)
			charge := payment("after-check-charge", 25, "2026-10-19T21:00:00Z")
			charge.SourceAccountID, charge.Destinations = ptr("card-a"), nil
			settlement := payment("after-check-payment", 10, "2026-10-19T22:00:00Z")
			settlement.Destinations = []string{"card-a"}
			pending := pricedPendingCharge("pending-after-check", 999, "2026-10-19T23:00:00Z")
			model.Transactions = []types.Transaction{settlement, charge, pending}

			cut := stamp("2026-11-15T12:00:00Z")
			derived := derivedStatementAt(t, DeriveStatements(model, settings, cut), "card-a", "2026-10-19")
			summary := BuildAtCut(model, settings, cut)
			assertMoney(t, derived.Balance, 215)
			assertMoney(t, statementAmount(t, summary, "card-a", "closed", "2026-10-19"), 215)
		})
	}
}

func TestClosedStatementParityAcrossEvidenceShapes(t *testing.T) {
	for _, tc := range []struct {
		name        string
		checkpoints []types.Checkpoint
		activity    []types.Transaction
		want        float64
		unknown     bool
		reserve     float64
	}{
		{
			name: "checkpoint at every close",
			checkpoints: []types.Checkpoint{
				{AccountID: "card-a", Balance: -100, ObservedAt: domain.DayCloseUnix("2026-09-19")},
				{AccountID: "card-a", Balance: -200, ObservedAt: domain.DayCloseUnix("2026-10-19")},
			},
			want:    200,
			reserve: 200,
		},
		{
			name: "gap before current close",
			checkpoints: []types.Checkpoint{
				{AccountID: "card-a", Balance: -100, ObservedAt: domain.DayCloseUnix("2026-09-19")},
			},
			unknown: true,
		},
		{
			name: "intra-cycle payment and post-close payment",
			checkpoints: []types.Checkpoint{
				{AccountID: "card-a", Balance: -200, ObservedAt: stamp("2026-10-01T12:00:00Z")},
			},
			activity: []types.Transaction{
				payment("later-post-close-payment", 40, "2026-11-01T12:00:00Z"),
				payment("intra-cycle-payment", 60, "2026-10-10T12:00:00Z"),
				payment("intra-cycle-charge", 25, "2026-10-15T12:00:00Z"),
			},
			want:    165,
			reserve: 125,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			model, settings := paydayFixture()
			settings.AccountIDs = []string{"card-a"}
			model.Checkpoints = model.Checkpoints[:1]
			model.Checkpoints = append(model.Checkpoints, tc.checkpoints...)
			model.Transactions = append([]types.Transaction(nil), tc.activity...)
			for i := range model.Transactions {
				tx := &model.Transactions[i]
				if tx.ID == "later-post-close-payment" || tx.ID == "intra-cycle-payment" {
					tx.Destinations = []string{"card-a"}
				} else {
					tx.SourceAccountID, tx.Destinations = ptr("card-a"), nil
				}
			}

			cut := stamp("2026-11-15T12:00:00Z")
			derived := derivedStatementAt(t, DeriveStatements(model, settings, cut), "card-a", "2026-10-19")
			summary := BuildAtCut(model, settings, cut)
			safe := statementAmount(t, summary, "card-a", "closed", "2026-10-19")
			if tc.unknown {
				if derived.Kind != "unknown" || derived.Balance != nil || safe != nil {
					t.Fatalf("missing in-cycle check invented a balance: derived=%+v safe=%v", derived, safe)
				}
				if summary.StatementReserve != nil {
					t.Fatalf("unknown closed statement produced reserve %v", *summary.StatementReserve)
				}
				return
			}
			if derived.Kind != "closed" {
				t.Fatalf("derived kind = %q, want closed", derived.Kind)
			}
			assertMoney(t, derived.Balance, tc.want)
			assertMoney(t, safe, tc.want)
			assertMoney(t, summary.StatementReserve, tc.reserve)
		})
	}
}

func TestClosedStatementReplayUsesCanonicalExactTimeChronology(t *testing.T) {
	model, settings := paydayFixture()
	settings.AccountIDs = []string{"card-a"}
	model.Checkpoints = append(model.Checkpoints[:1], types.Checkpoint{AccountID: "card-a", Balance: -100, ObservedAt: stamp("2026-10-19T18:00:00Z")})
	first := payment("first", 10, "2026-10-19T19:00:00Z")
	first.SourceAccountID, first.Destinations, first.ExecutionOrder = ptr("card-a"), nil, 1
	second := payment("second", 0, "2026-10-19T19:00:00Z")
	second.SourceAccountID, second.Destinations, second.ExecutionOrder = ptr("card-a"), nil, 2
	second.Amount = types.TransactionAmountResolution{
		Resolver: "expression",
		Config:   map[string]any{"expression": "first * 2"},
		Inputs: map[string]types.AmountInputBinding{
			"first": {Source: "provider", Provider: "model-value", Arguments: map[string]any{"id": "first"}},
		},
	}
	model.Transactions = []types.Transaction{second, first}

	cut := stamp("2026-11-15T12:00:00Z")
	derived := derivedStatementAt(t, DeriveStatements(model, settings, cut), "card-a", "2026-10-19")
	summary := BuildAtCut(model, settings, cut)
	assertMoney(t, derived.Balance, 130)
	assertMoney(t, statementAmount(t, summary, "card-a", "closed", "2026-10-19"), 130)
}

func TestConfirmedTransferSuggestionsUseCorrectedClosedBalance(t *testing.T) {
	model, settings := paydayFixture()
	settings.AccountIDs = []string{"card-a"}
	model.Checkpoints = append(model.Checkpoints[:1],
		types.Checkpoint{AccountID: "card-a", Balance: -100, ObservedAt: stamp("2026-10-19T08:00:00Z")},
		types.Checkpoint{AccountID: "card-a", Balance: -200, ObservedAt: stamp("2026-10-19T20:00:00Z")},
	)
	outflow := payment("linked-outflow", 200, "2026-11-01T12:00:00Z")
	outflow.Destinations = nil
	inflow := payment("linked-inflow", 200, "2026-11-02T12:00:00Z")
	inflow.SourceAccountID, inflow.Destinations = nil, []string{"card-a"}
	model.Transactions = []types.Transaction{outflow, inflow}

	statement := derivedStatementAt(t, DeriveStatements(model, settings, stamp("2026-11-15T12:00:00Z")), "card-a", "2026-10-19")
	assertMoney(t, statement.Balance, 200)
	reads := []types.StatementAllocationRead{{Statement: statement, Remaining: *statement.Balance}}
	matches, canonicalID := domain.StatementPaymentSuggestions(model, []types.TransferLink{{LegA: outflow.ID, LegB: inflow.ID}}, outflow.ID, reads, nil)
	if canonicalID != outflow.ID || len(matches) != 1 {
		t.Fatalf("linked payment suggestions = %+v canonical=%q", matches, canonicalID)
	}
	if matches[0].Payment.AmountDelta != 0 {
		t.Fatalf("suggestion used uncorrected statement balance: %+v", matches[0])
	}
	foundExact := false
	for _, evidence := range matches[0].Payment.Evidence {
		foundExact = foundExact || evidence.Code == "amount-exact"
	}
	if !foundExact {
		t.Fatalf("corrected balance did not produce exact amount evidence: %+v", matches[0].Payment.Evidence)
	}
}

func TestClosedStatementCutoffExcludesLaterCheckpointAndActivity(t *testing.T) {
	model, settings := paydayFixture()
	settings.AccountIDs = []string{"card-a"}
	model.Checkpoints = append(model.Checkpoints[:1],
		types.Checkpoint{AccountID: "card-a", Balance: -100, ObservedAt: stamp("2026-10-18T12:00:00Z")},
		types.Checkpoint{AccountID: "card-a", Balance: -999, ObservedAt: stamp("2026-10-20T01:00:00Z")},
	)
	beforeClose := payment("before-close", 50, "2026-10-19T20:00:00Z")
	beforeClose.SourceAccountID, beforeClose.Destinations = ptr("card-a"), nil
	afterClose := payment("after-close", 70, "2026-10-20T02:00:00Z")
	afterClose.SourceAccountID, afterClose.Destinations = ptr("card-a"), nil
	model.Transactions = []types.Transaction{afterClose, beforeClose}

	cut := stamp("2026-10-20T12:00:00Z")
	derived := derivedStatementAt(t, DeriveStatements(model, settings, cut), "card-a", "2026-10-19")
	summary := BuildAtCut(model, settings, cut)
	assertMoney(t, derived.Balance, 150)
	assertMoney(t, statementAmount(t, summary, "card-a", "closed", "2026-10-19"), 150)
}
