package storetest

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func testAnalysisConformance(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	s := newStore(t)
	if _, err := s.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	account := "checking"
	key := store.BankKey{Provider: "bank-provider", AccountID: "bank", TransactionID: "charge"}
	facts := types.TransactionFacts{Description: "Provider installment", Amount: "-25", Currency: "USD"}
	_, err := s.ApplySyncPlan(nil, []store.BankDirective{
		{Upsert: &store.BankUpsert{Keys: []store.BankKey{key}, Posting: types.Posting{Name: "Display label", Source: "bank-provider", SourceAccountID: &account, PostedTime: 1785628800, TransactionTime: 1785628800, Amount: types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "25"}, Inputs: map[string]types.AmountInputBinding{}}}}},
		{Observe: &store.BankObservation{Keys: []store.BankKey{key}, Facts: facts}},
	})
	if err != nil {
		t.Fatal(err)
	}
	model, err := s.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	revision, err := store.ModelETag(model)
	if err != nil {
		t.Fatal(err)
	}
	run, input, claimed, err := s.ClaimAnalysis("test", "v1")
	if err != nil || !claimed || len(input.Transactions) != 1 || input.Transactions[0].Facts.Description != facts.Description {
		t.Fatalf("claim=%v input=%+v err=%v", claimed, input, err)
	}
	detection := types.AnalysisDetection{PostingID: input.Transactions[0].PostingID, Kind: "test", Strength: "moderate"}
	if err := s.CompleteAnalysis(run, []types.AnalysisDetection{detection}, ""); err != nil {
		t.Fatal(err)
	}
	findings, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{PostingIDs: []string{detection.PostingID}})
	if err != nil || len(findings) != 1 || findings[0].Stale || findings[0].Status != "active" {
		t.Fatalf("findings=%+v err=%v", findings, err)
	}
	if err := s.DismissAnalysisFinding(findings[0].ID, true, ""); err != nil {
		t.Fatal(err)
	}
	if _, _, claimed, err := s.ClaimAnalysis("test", "v1"); err != nil || claimed {
		t.Fatalf("duplicate run claimed=%v err=%v", claimed, err)
	}
	after, err := s.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	afterRevision, err := store.ModelETag(after)
	if err != nil || afterRevision != revision {
		t.Fatal("analysis changed the financial model")
	}
}
