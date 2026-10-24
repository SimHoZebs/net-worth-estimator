package authorization

import (
	"context"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Concurrent Resolve calls for one subject share one provider call and
// receive the same fresh decision. Sequential calls always recheck.
func TestConcurrentResolveSharesOneProviderCall(t *testing.T) {
	var calls atomic.Int64
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		// Hold the handler so all goroutines overlap in flight.
		time.Sleep(100 * time.Millisecond)
		result(w, []bool{true, true, true})
	})
	const workers = 8
	scopes := make([]Scope, workers)
	errs := make([]error, workers)
	var group sync.WaitGroup
	for i := 0; i < workers; i++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			scopes[index], errs[index] = client.Resolve(context.Background(), "alice")
		}(i)
	}
	group.Wait()
	for i := range errs {
		if errs[i] != nil {
			t.Fatalf("worker %d: %v", i, errs[i])
		}
		if len(scopes[i].Permissions) != 3 {
			t.Fatalf("worker %d: unexpected scope %+v", i, scopes[i])
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("concurrent resolve contacted provider %d times, want 1", got)
	}
}
