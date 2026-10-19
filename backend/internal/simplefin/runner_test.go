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

// seedRunnerAccounts creates the model accounts a sync targets plus the
// links the removed env map used to provide.
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
	for _, link := range []store.AccountLink{
		{BridgeAccountID: "mock-checking", ModelAccountID: "checking", Origin: store.LinkOriginManual},
		{BridgeAccountID: "mock-prime", ModelAccountID: "prime_card", Origin: store.LinkOriginManual},
	} {
		if _, err := database.SaveAccountLink(link); err != nil {
			t.Fatalf("seed link %s: %v", link.BridgeAccountID, err)
		}
	}
}

func TestSyncProvisionsUnmappedBridgeAccounts(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	runner := NewRunner(database, Config{}, nil)
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
	if err != nil || len(links) != 3 {
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
		DryRun: true,
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
		DryRun: true,
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
		DryRun: true,
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

func TestSyncRecordsLastSyncTime(t *testing.T) {
	database := openRunnerStore(t)
	runner := NewRunner(database, Config{}, nil)
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		return &AccountSet{}, nil
	}
	if _, err := runner.Sync(context.Background()); err != nil {
		t.Fatalf("sync: %v", err)
	}
	stamped, err := database.GetLastSyncTime()
	if err != nil || stamped == "" {
		t.Fatalf("last sync = %q, err %v, want recorded time", stamped, err)
	}
	if _, err := time.Parse(time.RFC3339, stamped); err != nil {
		t.Fatalf("last sync %q is not RFC3339: %v", stamped, err)
	}
}

func TestDryRunAndFailedSyncsDoNotRecordSyncTime(t *testing.T) {
	dryRunStore := openRunnerStore(t)
	dryRunner := NewRunner(dryRunStore, Config{DryRun: true}, nil)
	dryRunner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		return &AccountSet{}, nil
	}
	if _, err := dryRunner.Sync(context.Background()); err != nil {
		t.Fatalf("dry-run sync: %v", err)
	}
	if got, err := dryRunStore.GetLastSyncTime(); err != nil || got != "" {
		t.Fatalf("dry-run last sync = %q, err %v, want empty", got, err)
	}

	failedStore := openRunnerStore(t)
	failedRunner := NewRunner(failedStore, Config{}, nil)
	failedRunner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		return nil, errBridgeDown
	}
	if _, err := failedRunner.Sync(context.Background()); err == nil {
		t.Fatal("expected failed sync to fail")
	}
	if got, err := failedStore.GetLastSyncTime(); err != nil || got != "" {
		t.Fatalf("failed last sync = %q, err %v, want empty", got, err)
	}
}

func TestParsePositiveDuration(t *testing.T) {
	if got, err := ParsePositiveDuration("", MinTriggerInterval); err != nil || got != MinTriggerInterval {
		t.Fatalf("empty = %v, %v, want fallback", got, err)
	}
	if got, err := ParsePositiveDuration("90m", MinTriggerInterval); err != nil || got != 90*time.Minute {
		t.Fatalf("90m = %v, %v, want 90m", got, err)
	}
	for _, value := range []string{"banana", "0", "-1h", "0s"} {
		if _, err := ParsePositiveDuration(value, MinTriggerInterval); err == nil {
			t.Fatalf("ParsePositiveDuration(%q) succeeded, want error", value)
		}
	}
}

func TestTriggerHonorsConfiguredInterval(t *testing.T) {
	database := openRunnerStore(t)
	calls := 0
	runner := NewRunner(database, Config{
		DryRun:             true,
		MinTriggerInterval: time.Hour,
	}, nil)
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		calls++
		return &AccountSet{}, nil
	}
	if _, err := runner.Trigger(context.Background()); err != nil {
		t.Fatalf("first trigger: %v", err)
	}
	start := time.Now()
	runner.now = func() time.Time { return start }
	// Re-stamp lastTrigger against the controlled clock so the interval math
	// is deterministic.
	runner.mu.Lock()
	runner.lastTrigger = start
	runner.mu.Unlock()
	if _, err := runner.Trigger(context.Background()); err == nil {
		t.Fatal("expected configured interval to refuse second trigger")
	} else {
		var tooSoon *TooSoonError
		if !errors.As(err, &tooSoon) {
			t.Fatalf("second trigger error = %T, want TooSoonError", err)
		}
		if tooSoon.RetryAfter <= 59*time.Minute || tooSoon.RetryAfter > time.Hour {
			t.Fatalf("retry after = %v, want ~1h", tooSoon.RetryAfter)
		}
	}
	if calls != 1 {
		t.Fatalf("fetch calls = %d, want 1", calls)
	}
}

func TestTriggerBacksOffAfterBridgeRateLimit(t *testing.T) {
	database := openRunnerStore(t)
	calls := 0
	runner := NewRunner(database, Config{
		DryRun:             true,
		MinTriggerInterval: time.Millisecond,
		RateLimitCooldown:  200 * time.Millisecond,
	}, nil)
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		calls++
		if calls == 1 {
			return nil, &RateLimitedError{Message: "too many requests"}
		}
		return &AccountSet{}, nil
	}
	if _, err := runner.Trigger(context.Background()); err == nil {
		t.Fatal("expected rate-limited trigger to fail")
	} else {
		var tooSoon *TooSoonError
		if !errors.As(err, &tooSoon) {
			t.Fatalf("rate-limited error = %T, want TooSoonError", err)
		}
	}
	if _, err := runner.Trigger(context.Background()); err == nil {
		t.Fatal("expected blackout to refuse second trigger without a fetch")
	} else if _, ok := err.(*TooSoonError); !ok {
		// errors.As unwraps huma-style wrappers; direct type assert keeps
		// this unit test independent of the API mapping.
		var tooSoon *TooSoonError
		if !errors.As(err, &tooSoon) {
			t.Fatalf("blackout error = %T, want TooSoonError", err)
		}
	}
	if calls != 1 {
		t.Fatalf("fetch calls = %d, want 1 during blackout", calls)
	}
	time.Sleep(250 * time.Millisecond)
	if _, err := runner.Trigger(context.Background()); err != nil {
		t.Fatalf("trigger after cooldown: %v", err)
	}
	if calls != 2 {
		t.Fatalf("fetch calls = %d, want 2 after cooldown", calls)
	}
}

func TestSyncSharesSingleflightWithTrigger(t *testing.T) {
	database := openRunnerStore(t)
	release := make(chan struct{})
	entered := make(chan struct{})
	runner := NewRunner(database, Config{DryRun: true}, nil)
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
	if _, err := runner.Sync(context.Background()); err == nil {
		t.Fatal("expected scheduler Sync during manual Trigger to be refused")
	} else if _, ok := err.(*InProgressError); !ok {
		t.Fatalf("concurrent Sync error = %T, want InProgressError", err)
	}
	close(release)
	if err := <-firstDone; err != nil {
		t.Fatalf("first trigger: %v", err)
	}
}

func TestSyncHonorsRateLimitBlackout(t *testing.T) {
	database := openRunnerStore(t)
	calls := 0
	runner := NewRunner(database, Config{
		DryRun:             true,
		MinTriggerInterval: time.Millisecond,
		RateLimitCooldown:  time.Hour,
	}, nil)
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		calls++
		return nil, &RateLimitedError{Message: "too many requests"}
	}
	if _, err := runner.Trigger(context.Background()); err == nil {
		t.Fatal("expected rate-limited trigger to fail")
	}
	if _, err := runner.Sync(context.Background()); err == nil {
		t.Fatal("expected scheduler Sync during blackout to be refused")
	} else {
		var tooSoon *TooSoonError
		if !errors.As(err, &tooSoon) {
			t.Fatalf("blackout Sync error = %T, want TooSoonError", err)
		}
	}
	if calls != 1 {
		t.Fatalf("fetch calls = %d, want 1", calls)
	}
}
