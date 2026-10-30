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

type blockingAnalysis struct {
	started chan struct{}
	release chan struct{}
}

func (blockingAnalysis) Type() string    { return "blocked" }
func (blockingAnalysis) Version() string { return "v1" }
func (a blockingAnalysis) Analyze(ctx context.Context, _ types.AnalysisSnapshot) ([]types.AnalysisDetection, error) {
	close(a.started)
	select {
	case <-a.release:
		return nil, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func TestWorkerIsIndependentFromSyncAndRecoversSavedInputs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	database, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	scoped, err := database.EnsureUser("owner", "issuer", "owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "bank", Currency: "USD", Balance: "100", BalanceDate: 1785628800, Transactions: []simplefin.Transaction{{ID: "charge", Description: "KLARNA PAY IN 4", Amount: "-25", Posted: 1785628800}}}}}
	plan, err := simplefin.Map(set, map[string]string{"bank": "checking"}, time.Unix(1785628800, 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySyncPlan(nil, simplefin.Reconcile(plan.Pending, plan.Settled, nil, map[string]bool{"checking": true})); err != nil {
		t.Fatal(err)
	}
	runs, _, _ := scoped.ListAnalysisRuns()
	if len(runs) != 0 {
		t.Fatal("sync started an analysis")
	}
	// No request or sync completion callback survives this restart.
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	database, err = sqlite.OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	scoped, err = database.User("owner")
	if err != nil {
		t.Fatal(err)
	}
	blocked := blockingAnalysis{make(chan struct{}), make(chan struct{})}
	runner, err := analysis.NewRunner(database, blocked)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- runner.RunOnce(context.Background()) }()
	<-blocked.started
	// Analysis holds no database transaction while it computes.
	if _, err := scoped.ApplySyncPlan([]store.SyncCheckpoint{{AccountID: "checking", ObservedAt: time.Date(2026, time.August, 2, 23, 59, 59, 0, time.UTC).Unix(), Balance: 200}}, nil); err != nil {
		t.Fatal(err)
	}
	close(blocked.release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	runner, err = analysis.NewRunner(database, analysis.Definitions()...)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := scoped.LoadDocument()
	revision, _ := store.DocumentETag(before)
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	findings, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findings) != 1 {
		t.Fatalf("findings=%+v err=%v", findings, err)
	}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	after, _ := scoped.LoadDocument()
	afterRevision, _ := store.DocumentETag(after)
	if afterRevision != revision || len(after.RecurrenceRules) != 0 {
		t.Fatal("analysis changed financial state")
	}
}
