package evaluationworker_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/evaluationworker"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func setupDB(t *testing.T) *sqlite.Database {
	t.Helper()
	path := filepath.Join(t.TempDir(), "app.db")
	database, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func ensureModel(t *testing.T, database *sqlite.Database) {
	t.Helper()
	scoped, err := database.EnsureUser("owner", "issuer", "owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	// Ensure projection state row exists so discovery + claim work.
	if _, err := scoped.GetProjectionState(); err != nil {
		t.Fatal(err)
	}
}

func TestRunOnceClaimsAndCompletes(t *testing.T) {
	database := setupDB(t)
	ensureModel(t, database)
	r, err := evaluationworker.NewRunner(database)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	scoped, _ := database.User("owner")
	runs, _, _, err := scoped.ListEvaluationWorkerRuns()
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].State != "succeeded" {
		t.Fatalf("runs=%+v want one succeeded", runs)
	}
	// Second run is a no-op (same fingerprint): still one run.
	if err := r.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	runs, _, _, _ = scoped.ListEvaluationWorkerRuns()
	if len(runs) != 1 {
		t.Fatalf("second run should be skipped, runs=%+v", runs)
	}
}

func TestRunOnceNilModelDoesNotFail(t *testing.T) {
	database := setupDB(t)
	scoped, err := database.EnsureUser("owner", "issuer", "owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.GetProjectionState(); err != nil {
		t.Fatal(err)
	}
	// No model initialized → LoadModel nil → clean succeed, no error.
	r, _ := evaluationworker.NewRunner(database)
	if err := r.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	runs, _, _, _ := scoped.ListEvaluationWorkerRuns()
	if len(runs) != 1 || runs[0].State != "succeeded" {
		t.Fatalf("nil model should succeed, runs=%+v", runs)
	}
}

func TestRunOnceNoProjectionStateSkips(t *testing.T) {
	database := setupDB(t)
	if _, err := database.EnsureUser("owner", "issuer", "owner"); err != nil {
		t.Fatal(err)
	}
	// Without projection state row, discovery returns no users → no runs.
	r, _ := evaluationworker.NewRunner(database)
	if err := r.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	scoped, _ := database.User("owner")
	runs, _, _, _ := scoped.ListEvaluationWorkerRuns()
	if len(runs) != 0 {
		t.Fatalf("without projection state, runs=%+v want 0", runs)
	}
}

func TestNewRunnerRejectsNil(t *testing.T) {
	if _, err := evaluationworker.NewRunner(nil); err == nil {
		t.Fatal("nil db should error")
	}
}

func TestRunOnceCancelledContext(t *testing.T) {
	database := setupDB(t)
	ensureModel(t, database)
	r, _ := evaluationworker.NewRunner(database)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := r.RunOnce(ctx); err == nil {
		t.Fatal("cancelled context should error or no-op without panic")
	}
}

func TestStartCancel(t *testing.T) {
	database := setupDB(t)
	ensureModel(t, database)
	r, _ := evaluationworker.NewRunner(database)
	stop := r.Start(context.Background(), time.Millisecond*10, func(error) {})
	// Let at least one tick run.
	time.Sleep(30 * time.Millisecond)
	stop()
	scoped, _ := database.User("owner")
	runs, _, _, _ := scoped.ListEvaluationWorkerRuns()
	if len(runs) == 0 {
		t.Fatalf("expected at least one run after start, got 0")
	}
}
