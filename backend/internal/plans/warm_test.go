package plans

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

type warmCall struct {
	id string
}

func stubWarmer(calls *[]warmCall, mu *sync.Mutex, release chan struct{}) warmFunc {
	return func(_ context.Context, _ store.Store, id string) error {
		if release != nil {
			<-release
		}
		mu.Lock()
		*calls = append(*calls, warmCall{id: id})
		mu.Unlock()
		return nil
	}
}

func waitForCalls(t *testing.T, calls *[]warmCall, mu *sync.Mutex, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		mu.Lock()
		got := len(*calls)
		mu.Unlock()
		if got >= want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("warm calls = %d, want %d", got, want)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestWarmerCoalescesBursts(t *testing.T) {
	router, _, _ := newRouter(t, privateID("a"))
	var mu sync.Mutex
	var calls []warmCall
	router.warmer = newWarmer(10*time.Millisecond, stubWarmer(&calls, &mu, nil), router.warmStore)
	id := router.PrimaryID()
	router.MarkDirty(id)
	router.MarkDirty(id)
	router.MarkDirty(id)
	waitForCalls(t, &calls, &mu, 1)
	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 1 || calls[0].id != id {
		t.Fatalf("warm calls = %+v, want one for %q", calls, id)
	}
}

func TestWarmerRerunsWhenMarkedDuringRun(t *testing.T) {
	router, _, _ := newRouter(t, privateID("a"))
	var mu sync.Mutex
	var calls []warmCall
	release := make(chan struct{})
	router.warmer = newWarmer(10*time.Millisecond, stubWarmer(&calls, &mu, release), router.warmStore)
	id := router.PrimaryID()
	router.MarkDirty(id)
	// Let the timer fire so the run blocks on release.
	time.Sleep(30 * time.Millisecond)
	router.MarkDirty(id)
	close(release)
	waitForCalls(t, &calls, &mu, 2)
}

func TestWarmerIgnoresUnknownResources(t *testing.T) {
	router, _, _ := newRouter(t, privateID("a"))
	var mu sync.Mutex
	var calls []warmCall
	router.warmer = newWarmer(10*time.Millisecond, stubWarmer(&calls, &mu, nil), router.warmStore)
	router.MarkDirty("plans/unknown")
	router.MarkDirty("")
	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 0 {
		t.Fatalf("warm calls = %+v, want none", calls)
	}
}

func TestWarmerStopsOnClose(t *testing.T) {
	router, _, _ := newRouter(t, privateID("a"))
	var mu sync.Mutex
	var calls []warmCall
	router.warmer = newWarmer(50*time.Millisecond, stubWarmer(&calls, &mu, nil), router.warmStore)
	router.MarkDirty(router.PrimaryID())
	if err := router.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	time.Sleep(120 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 0 {
		t.Fatalf("warm calls after close = %+v, want none", calls)
	}
}

func TestNoteSyncSkipsDryRuns(t *testing.T) {
	router, _, _ := newRouter(t, privateID("a"))
	var mu sync.Mutex
	var calls []warmCall
	router.warmer = newWarmer(10*time.Millisecond, stubWarmer(&calls, &mu, nil), router.warmStore)
	router.noteSync(router.PrimaryID(), true)
	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	dryCalls := len(calls)
	mu.Unlock()
	router.noteSync(router.PrimaryID(), false)
	waitForCalls(t, &calls, &mu, dryCalls+1)
}

func TestRowWriteMarksPrimaryDirty(t *testing.T) {
	router, _, _ := newRouter(t, privateID("a"))
	var mu sync.Mutex
	var calls []warmCall
	router.warmer = newWarmer(10*time.Millisecond, stubWarmer(&calls, &mu, nil), router.warmStore)
	owner, err := router.handlerFor(authorization.Resource{ID: privateID("a"), Kind: "private"})
	if err != nil {
		t.Fatal(err)
	}
	write := `{"name":"Warm probe","kind":"cash","enabled":true}`
	if w := request(t, owner, "POST", "/v1/accounts", write); w.Code != 200 {
		t.Fatalf("row write=%d %s", w.Code, w.Body.String())
	}
	waitForCalls(t, &calls, &mu, 1)
	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 1 || calls[0].id != privateID("a") {
		t.Fatalf("warm calls = %+v, want one for the primary resource", calls)
	}
}
