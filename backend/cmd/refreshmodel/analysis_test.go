package main

import (
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPrivateAnalysisEvidenceIsExcludedFromPublicCopy(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "target.db")
	seed(t, source)
	seed(t, target)
	db, err := sqlite.OpenDatabase(source)
	if err != nil {
		t.Fatal(err)
	}
	scoped, err := db.User("other")
	if err != nil {
		t.Fatal(err)
	}
	account := "checking"
	key := store.BankKey{Provider: store.SourceSimpleFIN, AccountID: "bank", TransactionID: "one"}
	_, err = scoped.ApplySyncPlan(nil, []store.BankDirective{{Upsert: &store.BankUpsert{Posting: types.Posting{Name: "Klarna", Source: store.SourceSimpleFIN, SourceAccountID: &account, Amount: types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "25"}, Inputs: map[string]types.AmountInputBinding{}}, PostedTime: 1785628800, TransactionTime: 1785628800}, Keys: []store.BankKey{key}}}, {Observe: &store.BankObservation{Keys: []store.BankKey{key}, Facts: types.TransactionFacts{Description: "PRIVATE KLARNA PAY IN 4", Amount: "-25", Currency: "USD"}}}})
	if err != nil {
		t.Fatal(err)
	}
	run, input, claimed, err := scoped.ClaimAnalysis("bnpl", "test")
	if err != nil || !claimed {
		t.Fatalf("claim=%v %v", claimed, err)
	}
	if err := scoped.CompleteAnalysis(run, []types.AnalysisDetection{{PostingID: input.Transactions[0].PostingID, Kind: "bnpl"}}, ""); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if err := refresh(target, source, "other", "owner", false); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"transaction_source_facts", "analysis_runs", "analysis_findings"} {
		if got := query(t, target, "SELECT COUNT(*) FROM "+table+" WHERE user_id='owner'"); got != "1" {
			t.Fatalf("private %s=%s", table, got)
		}
	}
	if err := refresh(target, source, "other", "owner", true); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"transaction_source_facts", "analysis_inputs", "analysis_runs", "analysis_findings"} {
		if got := query(t, target, "SELECT COUNT(*) FROM "+table+" WHERE user_id='owner'"); got != "0" {
			t.Fatalf("public copied private %s=%s", table, got)
		}
	}
}
