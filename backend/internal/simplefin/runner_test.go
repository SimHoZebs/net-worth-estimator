package simplefin

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"path/filepath"
)

var errBridgeDown = errors.New("bridge down")

func openRunnerStore(t *testing.T) *store.Store {
	t.Helper()
	database, err := store.Open(filepath.Join(t.TempDir(), "runner.db"))
	if err != nil {
		t.Fatalf("open runner store: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
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
