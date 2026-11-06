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

// stubClaims is a test-only second producer. It proves one transaction can
// hold independent claims from separate Analysis definitions without creating
// a parallel classifier. Production recurring, transfer, and receipt producers
// arrive with FIN-01, VIS-03, and INT-03; this stub sets no vocabulary for them.
type stubClaims struct{}

func (stubClaims) Type() string    { return "stub-claims" }
func (stubClaims) Version() string { return "v1" }

func (stubClaims) Analyze(_ context.Context, input types.AnalysisSnapshot) ([]types.AnalysisDetection, error) {
	findings := []types.AnalysisDetection{}
	for _, transaction := range input.Transactions {
		if transaction.Pending || transaction.Void {
			continue
		}
		findings = append(findings, types.AnalysisDetection{
			TransactionID: transaction.TransactionID,
			Kind:          "stub-claim",
			Strength:      "moderate",
			Evidence:      []types.AnalysisEvidence{{Code: "stub.independent-claim", Reason: "A second independent producer observed the same transaction.", TransactionIDs: []string{transaction.TransactionID}}},
		})
	}
	return findings, nil
}

func TestWorkerKeepsIndependentClaimsForOneTransaction(t *testing.T) {
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
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "bank", ConnID: "test-conn", Currency: "USD", Balance: "100", BalanceDate: 1785628800, Transactions: []simplefin.Transaction{{ID: "charge", Description: "KLARNA PAY IN 4", Amount: "-25", Posted: 1785628800}}}}}
	translation, err := simplefin.Translate(set, map[string]string{simplefin.AccountKey("test-conn", "bank"): "checking"}, time.Unix(1785628800, 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{"checking": true})); err != nil {
		t.Fatal(err)
	}
	runner, err := analysis.NewRunner(database, analysis.BNPL{}, stubClaims{})
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
	if len(findings) != 2 {
		t.Fatalf("one transaction holds %d claims, want BNPL plus the independent claim: %+v", len(findings), findings)
	}
	seen := map[string]bool{}
	for _, item := range findings {
		if item.Status != "active" || item.Stale || len(item.Evidence) == 0 {
			t.Fatalf("claim without active evidence-backed standing: %+v", item)
		}
		seen[item.AnalysisType+"/"+item.Kind] = true
		if findings[0].TransactionID != item.TransactionID {
			t.Fatalf("claims split across transactions: %+v", findings)
		}
	}
	if !seen["bnpl/bnpl"] || !seen["stub-claims/stub-claim"] {
		t.Fatalf("producers=%v", seen)
	}
	before, _ := scoped.LoadModel()
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	after, _ := scoped.LoadModel()
	beforeRevision, _ := store.ModelETag(before)
	afterRevision, _ := store.ModelETag(after)
	if beforeRevision != afterRevision || len(after.Schedules) != 0 {
		t.Fatal("analysis changed financial state")
	}
}
