package simplefin

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"testing"
	"time"
)

func stubSleep(record *[]time.Duration) func(context.Context, time.Duration) error {
	return func(ctx context.Context, d time.Duration) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		*record = append(*record, d)
		return nil
	}
}

func timeoutFetchError() error {
	return fmt.Errorf("simplefin fetch from bridge.example: %w", &url.Error{
		Op:  "Get",
		URL: "https://bridge.example/simplefin/accounts",
		Err: context.DeadlineExceeded,
	})
}

func TestFetchRetrySucceedsAfterTimeout(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	calls := 0
	runner := NewRunner(database, Config{}, nil)
	var slept []time.Duration
	runner.sleep = stubSleep(&slept)
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		calls++
		if calls < 3 {
			return nil, timeoutFetchError()
		}
		return &AccountSet{}, nil
	}
	if _, err := runner.Sync(context.Background()); err != nil {
		t.Fatalf("sync after retries: %v", err)
	}
	if calls != 3 {
		t.Fatalf("fetch calls = %d, want 3", calls)
	}
	if len(slept) != 2 {
		t.Fatalf("sleeps = %d, want 2", len(slept))
	}
	for _, d := range slept {
		if d != DefaultFetchRetryDelay {
			t.Fatalf("sleep = %v, want %v", d, DefaultFetchRetryDelay)
		}
	}
	if stamped, err := database.GetLastSyncTime(); err != nil || stamped == "" {
		t.Fatalf("last sync = %q, err %v, want stamped after retry success", stamped, err)
	}
}

func TestFetchRetryExhaustsBudget(t *testing.T) {
	database := openRunnerStore(t)
	runner := NewRunner(database, Config{}, nil)
	calls := 0
	var slept []time.Duration
	runner.sleep = stubSleep(&slept)
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		calls++
		return nil, timeoutFetchError()
	}
	if _, err := runner.Sync(context.Background()); err == nil {
		t.Fatal("expected exhausted retry to fail")
	}
	if calls != DefaultFetchMaxAttempts {
		t.Fatalf("fetch calls = %d, want %d", calls, DefaultFetchMaxAttempts)
	}
	if len(slept) != DefaultFetchMaxAttempts-1 {
		t.Fatalf("sleeps = %d, want %d", len(slept), DefaultFetchMaxAttempts-1)
	}
	if stamped, err := database.GetLastSyncTime(); err != nil || stamped != "" {
		t.Fatalf("last sync = %q, err %v, want empty after exhausted retry", stamped, err)
	}
}

func TestFetchDoesNotRetryPermanentErrors(t *testing.T) {
	cases := map[string]error{
		"generic":      errBridgeDown,
		"bad request":  &StatusError{Host: "bridge.example", StatusCode: 400},
		"unauthorized": &StatusError{Host: "bridge.example", StatusCode: 401},
		"forbidden":    &StatusError{Host: "bridge.example", StatusCode: 403},
		"rate limited": &RateLimitedError{Message: "too many requests"},
		"unconfigured": &NotConfiguredError{},
	}
	for name, fetchErr := range cases {
		t.Run(name, func(t *testing.T) {
			database := openRunnerStore(t)
			runner := NewRunner(database, Config{}, nil)
			calls := 0
			var slept []time.Duration
			runner.sleep = stubSleep(&slept)
			runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
				calls++
				return nil, fetchErr
			}
			if _, err := runner.Sync(context.Background()); err == nil {
				t.Fatal("expected permanent failure to fail")
			}
			if calls != 1 {
				t.Fatalf("fetch calls = %d, want 1 (no retry)", calls)
			}
			if len(slept) != 0 {
				t.Fatalf("sleeps = %d, want 0 (no retry)", len(slept))
			}
		})
	}
}

func TestFetchRetriesServerErrors(t *testing.T) {
	database := openRunnerStore(t)
	runner := NewRunner(database, Config{}, nil)
	calls := 0
	var slept []time.Duration
	runner.sleep = stubSleep(&slept)
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		calls++
		if calls == 1 {
			return nil, &StatusError{Host: "bridge.example", StatusCode: 502}
		}
		return &AccountSet{}, nil
	}
	if _, err := runner.Sync(context.Background()); err != nil {
		t.Fatalf("sync after 5xx retry: %v", err)
	}
	if calls != 2 {
		t.Fatalf("fetch calls = %d, want 2", calls)
	}
}

func TestFetchRetryStopsWhenCallerCancels(t *testing.T) {
	database := openRunnerStore(t)
	runner := NewRunner(database, Config{}, nil)
	calls := 0
	runner.sleep = func(ctx context.Context, d time.Duration) error {
		_ = d
		return ctx.Err()
	}
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		calls++
		return nil, timeoutFetchError()
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := runner.Sync(ctx); err == nil {
		t.Fatal("expected canceled retry to fail")
	}
	if calls != 1 {
		t.Fatalf("fetch calls = %d, want 1 (no retry after cancel)", calls)
	}
}

func TestStatusErrorMessage(t *testing.T) {
	err := &StatusError{Host: "bridge.example", StatusCode: 500}
	if got, want := err.Error(), "simplefin fetch from bridge.example: status 500"; got != want {
		t.Fatalf("status error = %q, want %q", got, want)
	}
	var status *StatusError
	if !errors.As(err, &status) || status.StatusCode != 500 {
		t.Fatalf("errors.As = %v, want StatusError 500", err)
	}
}

func TestFetchDoesNotCountUnconfigured(t *testing.T) {
	database := openRunnerStore(t)
	runner := NewRunner(database, Config{}, nil)
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		return nil, &NotConfiguredError{}
	}
	if _, err := runner.Sync(context.Background()); err == nil {
		t.Fatal("expected unconfigured sync to fail")
	}
	if used, _ := runner.QuotaUsage(); used != 0 {
		t.Fatalf("quota after unconfigured sync = %d, want 0", used)
	}
}

func TestQuotaUsageCountsBridgeHits(t *testing.T) {
	var nilRunner *Runner
	if used, limit := nilRunner.QuotaUsage(); used != 0 || limit != 0 {
		t.Fatalf("nil quota = %d/%d, want 0/0", used, limit)
	}
	database := openRunnerStore(t)
	runner := NewRunner(database, Config{}, nil)
	runner.sleep = stubSleep(&[]time.Duration{})
	if used, limit := runner.QuotaUsage(); used != 0 || limit != BridgeDailyQuota {
		t.Fatalf("fresh quota = %d/%d, want 0/%d", used, limit, BridgeDailyQuota)
	}
	start := time.Now()
	runner.now = func() time.Time { return start }
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		return nil, timeoutFetchError()
	}
	_, _ = runner.Sync(context.Background())
	// Default policy retries timeouts: 3 attempts, one sync.
	if used, _ := runner.QuotaUsage(); used != 3 {
		t.Fatalf("quota after failed sync = %d, want 3", used)
	}
	// Local refusals never reach the Bridge and must not count. Arm the
	// manual interval, then trigger twice: first succeeds without a fetch
	// only if... instead use a fresh runner with a counting fetch and a
	// throttled second trigger.
	throttled := NewRunner(database, Config{}, nil)
	calls := 0
	throttled.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		calls++
		return &AccountSet{}, nil
	}
	if _, err := throttled.Trigger(context.Background()); err != nil {
		t.Fatalf("first trigger: %v", err)
	}
	if _, err := throttled.Trigger(context.Background()); err == nil {
		t.Fatal("expected throttled trigger to be refused")
	}
	if calls != 1 {
		t.Fatalf("fetch calls = %d, want 1", calls)
	}
	if used, _ := throttled.QuotaUsage(); used != 1 {
		t.Fatalf("quota after throttled trigger = %d, want 1", used)
	}
	// Entries older than 24 hours drop out of the window.
	runner.now = func() time.Time { return start.Add(25 * time.Hour) }
	if used, _ := runner.QuotaUsage(); used != 0 {
		t.Fatalf("quota after 25h = %d, want 0", used)
	}
}
