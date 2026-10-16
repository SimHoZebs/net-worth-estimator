package simplefin

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

var errBridgeDown = errors.New("bridge down")

func openRunnerStore(t *testing.T) store.Store {
	t.Helper()
	database, err := store.Open(filepath.Join(t.TempDir(), "runner.db"))
	if err != nil {
		t.Fatalf("open runner store: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

// seedRunnerAccounts creates the model accounts a sync map targets.
// Like production (seeded DB), sync bootstrap validates manual targets.
func seedRunnerAccounts(t *testing.T, database store.Store) {
	t.Helper()
	for _, account := range []types.Account{
		{ID: "checking", Name: "Checking"},
		{ID: "prime_card", Name: "Prime"},
	} {
		if _, err := database.CreateAccount(account); err != nil {
			t.Fatalf("seed account %s: %v", account.ID, err)
		}
	}
}

func TestSyncProvisionsUnmappedBridgeAccounts(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	runner := NewRunner(database, Config{
		AccountMap: map[string]string{"mock-checking": "checking"},
	}, nil)
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		return &AccountSet{Accounts: []Account{
			{ID: "mock-checking", Name: "Checking", Currency: "USD", Balance: "100.00"},
			{ID: "mock-new", Name: "New Savings", Currency: "USD", Balance: "10.00"},
		}}, nil
	}
	summary, err := runner.Sync(context.Background())
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if summary.AccountsProvisioned != 1 || summary.CheckpointsInserted != 2 {
		t.Fatalf("summary = %+v, want 1 provisioned + 2 checkpoints", summary)
	}
	links, err := database.ListAccountLinks()
	if err != nil || len(links) != 2 {
		t.Fatalf("links = %+v, err %v", links, err)
	}
	for _, link := range links {
		if link.BridgeAccountID == "mock-new" && link.Origin != "auto" {
			t.Fatalf("provisioned link = %+v, want auto origin", link)
		}
	}
}

func TestSyncSkipsStaleLinksWithoutWriting(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	if _, err := database.CreateAccount(types.Account{ID: "ghost", Name: "Ghost"}); err != nil {
		t.Fatalf("create ghost: %v", err)
	}
	if _, err := database.SaveAccountLink(store.AccountLink{BridgeAccountID: "mock-old", ModelAccountID: "ghost", BridgeName: "Old"}); err != nil {
		t.Fatalf("save link: %v", err)
	}
	if err := database.DeleteAccount("ghost"); err != nil {
		t.Fatalf("delete ghost: %v", err)
	}
	runner := NewRunner(database, Config{}, nil)
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		return &AccountSet{Accounts: []Account{
			{ID: "mock-old", Name: "Old", Currency: "USD", Balance: "10.00"},
		}}, nil
	}
	summary, err := runner.Sync(context.Background())
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	if summary.Skipped["linked-account-missing"] != 1 || summary.CheckpointsInserted != 0 {
		t.Fatalf("summary = %+v, want 1 stale skip and no checkpoints", summary)
	}
}

func TestTriggerGuardsInterval(t *testing.T) {
	database := openRunnerStore(t)
	calls := 0
	runner := NewRunner(database, Config{
		AccountMap: map[string]string{},
		DryRun:     true,
	}, nil)
	runner.fetch = func(ctx context.Context, start, end time.Time) (*AccountSet, error) {
		calls++
		return &AccountSet{}, nil
	}

	if _, err := runner.Trigger(context.Background()); err != nil {
		t.Fatalf("first trigger: %v", err)
	}
	if _, err := runner.Trigger(context.Background()); err == nil {
		t.Fatal("expected second trigger to be refused")
	} else if _, ok := err.(*TooSoonError); !ok {
		t.Fatalf("second trigger error = %T, want TooSoonError", err)
	}
	if calls != 1 {
		t.Fatalf("fetch calls = %d, want 1", calls)
	}
}

func TestTriggerRetriesAfterFailure(t *testing.T) {
	database := openRunnerStore(t)
	calls := 0
	runner := NewRunner(database, Config{
		AccountMap: map[string]string{},
		DryRun:     true,
	}, nil)
	runner.fetch = func(ctx context.Context, start, end time.Time) (*AccountSet, error) {
		calls++
		if calls == 1 {
			return nil, errBridgeDown
		}
		return &AccountSet{}, nil
	}

	if _, err := runner.Trigger(context.Background()); err == nil {
		t.Fatal("expected first trigger to fail")
	}
	if _, err := runner.Trigger(context.Background()); err != nil {
		t.Fatalf("retry after failure: %v", err)
	}
	if calls != 2 {
		t.Fatalf("fetch calls = %d, want 2", calls)
	}
}

func TestTriggerRefusesConcurrentRun(t *testing.T) {
	database := openRunnerStore(t)
	release := make(chan struct{})
	entered := make(chan struct{})
	runner := NewRunner(database, Config{
		AccountMap: map[string]string{},
		DryRun:     true,
	}, nil)
	runner.fetch = func(ctx context.Context, start, end time.Time) (*AccountSet, error) {
		close(entered)
		select {
		case <-release:
			return &AccountSet{}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	firstDone := make(chan error, 1)
	go func() {
		_, err := runner.Trigger(context.Background())
		firstDone <- err
	}()
	<-entered
	if _, err := runner.Trigger(context.Background()); err == nil {
		t.Fatal("expected concurrent trigger to be refused")
	} else if _, ok := err.(*InProgressError); !ok {
		t.Fatalf("concurrent trigger error = %T, want InProgressError", err)
	}
	close(release)
	if err := <-firstDone; err != nil {
		t.Fatalf("first trigger: %v", err)
	}
}
