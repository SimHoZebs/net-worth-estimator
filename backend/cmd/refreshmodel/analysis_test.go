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
	key := store.BankKey{Provider: store.ProviderSimpleFIN, AccountID: "bank", TransactionID: "one"}
	_, err = scoped.ApplySync(nil, []store.BankDirective{{Upsert: &store.BankUpsert{Transaction: types.Transaction{Name: "Klarna", Source: store.SourceBankSync, SourceAccountID: &account, Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "25"}, Inputs: map[string]types.AmountInputBinding{}}, PostedTime: 1785628800, TransactionTime: 1785628800}, Keys: []store.BankKey{key}}}, {Observe: &store.BankObservation{Keys: []store.BankKey{key}, Facts: types.TransactionFacts{Description: "PRIVATE KLARNA PAY IN 4", Amount: "-25", Currency: "USD"}}}})
	if err != nil {
		t.Fatal(err)
	}
	run, input, claimed, err := scoped.ClaimAnalysis("bnpl", "test")
	if err != nil || !claimed {
		t.Fatalf("claim=%v %v", claimed, err)
	}
	if err := scoped.CompleteAnalysis(run, []types.AnalysisDetection{{TransactionID: input.Transactions[0].TransactionID, Kind: "bnpl"}}, ""); err != nil {
		t.Fatal(err)
	}
	for _, account := range []types.Account{{ID: "loan", Name: "Loan", Enabled: true}} {
		if _, err := scoped.CreateAccount(account); err != nil {
			t.Fatal(err)
		}
	}
	legKeys := []store.BankKey{{Provider: store.ProviderSimpleFIN, AccountID: "bank-out", TransactionID: "out-1"}, {Provider: store.ProviderSimpleFIN, AccountID: "bank-in", TransactionID: "in-1"}}
	checking := "checking"
	_, err = scoped.ApplySync(nil, []store.BankDirective{
		{Upsert: &store.BankUpsert{Transaction: types.Transaction{Name: "Card payment", Source: store.SourceBankSync, SourceAccountID: &checking, Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "500"}, Inputs: map[string]types.AmountInputBinding{}}, PostedTime: 1785628800, TransactionTime: 1785628800}, Keys: []store.BankKey{legKeys[0]}}},
		{Observe: &store.BankObservation{Keys: []store.BankKey{legKeys[0]}, Facts: types.TransactionFacts{Description: "CARD PAYMENT", Amount: "-500", Currency: "USD", PostedTime: 1785628800}}},
		{Upsert: &store.BankUpsert{Transaction: types.Transaction{Name: "Payment received", Source: store.SourceBankSync, Destinations: []string{"loan"}, Amount: types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "500"}, Inputs: map[string]types.AmountInputBinding{}}, PostedTime: 1785628800, TransactionTime: 1785628800}, Keys: []store.BankKey{legKeys[1]}}},
		{Observe: &store.BankObservation{Keys: []store.BankKey{legKeys[1]}, Facts: types.TransactionFacts{Description: "PAYMENT RECEIVED", Amount: "500", Currency: "USD", PostedTime: 1785628800}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	bankRows, err := scoped.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	legIDs := map[string]string{}
	for _, row := range bankRows {
		legIDs[row.Transaction.Name] = row.Transaction.ID
	}
	outID, inID := legIDs["Card payment"], legIDs["Payment received"]
	transferRun, _, transferClaimed, err := scoped.ClaimAnalysis("transfer", "test")
	if err != nil || !transferClaimed {
		t.Fatalf("claim=%v %v", transferClaimed, err)
	}
	if err := scoped.CompleteAnalysis(transferRun, []types.AnalysisDetection{
		{TransactionID: outID, Kind: "transfer", Evidence: []types.AnalysisEvidence{{Code: "transfer.exact-leg-match", TransactionIDs: []string{outID, inID}}}},
		{TransactionID: inID, Kind: "transfer", Evidence: []types.AnalysisEvidence{{Code: "transfer.exact-leg-match", TransactionIDs: []string{inID, outID}}}},
	}, ""); err != nil {
		t.Fatal(err)
	}
	transferFindings, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{TransactionIDs: []string{outID}})
	if err != nil || len(transferFindings) != 1 {
		t.Fatalf("findings=%+v err=%v", transferFindings, err)
	}
	if _, err := scoped.ConfirmTransferPair(transferFindings[0].ID, inID, "tester"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if err := refresh(target, source, "other", "owner", false); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"analysis_transfer_links", "analysis_transfer_link_members"} {
		want := "1"
		if table == "analysis_transfer_link_members" {
			want = "2"
		}
		if got := query(t, target, "SELECT COUNT(*) FROM "+table+" WHERE user_id='owner'"); got != want {
			t.Fatalf("private %s=%s", table, got)
		}
	}
	for _, table := range []string{"transaction_source_facts", "analysis_findings"} {
		if got := query(t, target, "SELECT COUNT(*) FROM "+table+" WHERE user_id='owner'"); got != "3" {
			t.Fatalf("private %s=%s", table, got)
		}
	}
	if got := query(t, target, "SELECT COUNT(*) FROM analysis_runs WHERE user_id='owner'"); got != "2" {
		t.Fatalf("private analysis_runs=%s", got)
	}
	if got := query(t, target, "SELECT COUNT(*) FROM analysis_fact_dirty WHERE user_id='owner'"); got != "3" {
		t.Fatalf("private analysis_fact_dirty=%s", got)
	}
	if err := refresh(target, source, "other", "owner", true); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"transaction_source_facts", "analysis_inputs", "analysis_runs", "analysis_findings", "analysis_fact_dirty", "analysis_payment_streams", "analysis_transfer_links", "analysis_transfer_link_members"} {
		if got := query(t, target, "SELECT COUNT(*) FROM "+table+" WHERE user_id='owner'"); got != "0" {
			t.Fatalf("public copied private %s=%s", table, got)
		}
	}
}
