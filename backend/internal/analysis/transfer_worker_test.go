package analysis_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestWorkerPairsCreditCardPaymentLegs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	database, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	scoped, err := database.EnsureUser("owner", "issuer", "owner")
	if err != nil {
		t.Fatal(err)
	}
	for _, account := range []types.Account{
		{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true},
		{ID: "card", Name: "Card", Kind: types.AccountKindCash, Enabled: true},
	} {
		if _, err := scoped.CreateAccount(account); err != nil {
			t.Fatal(err)
		}
	}
	arrival := time.Unix(1785628800, 0)
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{
		{ID: "bridge-checking", ConnID: "test-conn", Currency: "USD", Balance: "1000", BalanceDate: 1785628800, Transactions: []simplefin.Transaction{{ID: "pay", Description: "CREDIT CARD PAYMENT", Amount: "-500.00", Posted: 1785628800}}},
		{ID: "bridge-card", ConnID: "test-conn", Currency: "USD", Balance: "200", BalanceDate: 1785715200, Transactions: []simplefin.Transaction{{ID: "receive", Description: "PAYMENT RECEIVED", Amount: "500.00", Posted: 1785715200}}},
	}}
	translation, err := simplefin.Translate(set, map[string]string{simplefin.AccountKey("test-conn", "bridge-checking"): "checking", simplefin.AccountKey("test-conn", "bridge-card"): "card"}, arrival)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{"checking": true, "card": true})); err != nil {
		t.Fatal(err)
	}
	runner, err := analysis.NewRunner(database, analysis.Definitions()...)
	if err != nil {
		t.Fatal(err)
	}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	findings, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil {
		t.Fatal(err)
	}
	transfers := []types.AnalysisFinding{}
	for _, item := range findings {
		if item.AnalysisType == "transfer" {
			transfers = append(transfers, item)
		}
	}
	if len(transfers) != 2 {
		t.Fatalf("transfer findings=%+v", findings)
	}
	for _, item := range transfers {
		if item.Strength != "strong" || len(item.Evidence) != 1 || len(item.Evidence[0].TransactionIDs) != 2 {
			t.Fatalf("pair=%+v", item)
		}
	}
	before := transfers[0].ID
	// A repeated run over unchanged evidence claims nothing and keeps identity.
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	again, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(again) != len(findings) {
		t.Fatalf("rerun findings=%+v err=%v", again, err)
	}
	for _, item := range again {
		if item.AnalysisType == "transfer" && item.TransactionID == transfers[0].TransactionID && item.ID != before {
			t.Fatalf("rerun rewrote finding identity: %+v", item)
		}
	}
	model, _ := scoped.LoadModel()
	if revision, _ := store.ModelETag(model); revision == "" {
		t.Fatal("missing model")
	}
	if len(model.Schedules) != 0 {
		t.Fatal("analysis changed financial state")
	}
}
