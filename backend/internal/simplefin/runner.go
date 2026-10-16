package simplefin

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Summary describes one sync run for logs and the trigger endpoint.
type Summary struct {
	CheckpointsInserted int            `json:"checkpointsInserted"`
	CheckpointsUpdated  int            `json:"checkpointsUpdated"`
	CheckpointsSkipped  int            `json:"checkpointsSkipped"`
	PendingDeleted      int            `json:"pendingDeleted"`
	PendingInserted     int            `json:"pendingInserted"`
	AccountsProvisioned int            `json:"accountsProvisioned"`
	Skipped             map[string]int `json:"skipped"`
	DryRun              bool           `json:"dryRun"`
}

// MinTriggerInterval spaces manual trigger runs.
const MinTriggerInterval = 20 * time.Hour

// ErrTooSoon reports a trigger refused by the interval guard.
type TooSoonError struct {
	RetryAfter time.Duration
}

func (e *TooSoonError) Error() string {
	return fmt.Sprintf("sync ran recently; retry after %s", e.RetryAfter.Round(time.Minute))
}

// InProgressError reports a trigger refused because a sync is running.
type InProgressError struct{}

func (e *InProgressError) Error() string {
	return "sync already in progress"
}

// Runner orchestrates fetch, map, and apply. The zero value is unusable;
// construct with NewRunner.
type Runner struct {
	store  store.Store
	config Config
	fetch  func(ctx context.Context, start, end time.Time) (*AccountSet, error)
	now    func() time.Time

	mu          sync.Mutex
	lastTrigger time.Time
	inFlight    bool
}

// NewRunner builds a runner. client may be nil only when Fetch is stubbed.
func NewRunner(database store.Store, config Config, client *Client) *Runner {
	fetch := func(ctx context.Context, start, end time.Time) (*AccountSet, error) {
		return client.Fetch(ctx, start, end)
	}
	return &Runner{store: database, config: config, fetch: fetch, now: time.Now}
}

// Sync runs fetch, link resolution, provisioning, map, and apply.
// Scheduler and first-live-run flows call it directly; manual triggers go
// through Trigger for interval guarding.
func (r *Runner) Sync(ctx context.Context) (*Summary, error) {
	now := r.now()
	end := now.Add(24 * time.Hour)
	start := now.Add(-90 * 24 * time.Hour)
	set, err := r.fetch(ctx, start, end)
	if err != nil {
		return nil, err
	}
	resolved := map[string]string{}
	links, err := r.store.ListAccountLinks()
	if err != nil {
		return nil, err
	}
	for _, link := range links {
		resolved[link.BridgeAccountID] = link.ModelAccountID
	}
	plan, err := Map(set, r.config, resolved, now)
	if err != nil {
		return nil, err
	}
	provisions := make([]store.SyncProvision, 0, len(set.Accounts))
	for _, account := range set.Accounts {
		provisions = append(provisions, store.SyncProvision{
			BridgeID: account.ID,
			Name:     account.Name,
			Currency: account.Currency,
			Kind:     types.AccountKind(provisionKind(account)),
		})
	}
	resolved, provisioned, stale, err := r.store.ProvisionSyncAccounts(provisions, r.config.DryRun)
	if err != nil {
		return nil, err
	}
	if len(stale) > 0 {
		plan.Skipped[SkipStaleLink] += len(stale)
	}
	// Re-resolve every checkpoint against post-provisioning truth. A
	// stale link (model account deleted) resolves to nothing and its
	// checkpoint is dropped: counted, never written.
	kept := plan.Checkpoints[:0]
	for _, checkpoint := range plan.Checkpoints {
		modelID, ok := resolved[checkpoint.BridgeID]
		if !ok {
			continue
		}
		checkpoint.AccountID = modelID
		kept = append(kept, checkpoint)
	}
	plan.Checkpoints = kept
	checkpoints := make([]store.SyncCheckpoint, 0, len(plan.Checkpoints))
	for _, checkpoint := range plan.Checkpoints {
		checkpoints = append(checkpoints, store.SyncCheckpoint{
			AccountID: checkpoint.AccountID,
			Date:      checkpoint.Date,
			Balance:   checkpoint.Balance,
		})
	}
	cards := make([]string, 0, len(r.config.CardAccounts))
	for accountID := range r.config.CardAccounts {
		cards = append(cards, accountID)
	}
	applied, err := r.store.ApplySyncPlan(checkpoints, plan.Pending, cards, r.config.DryRun)
	if err != nil {
		return nil, err
	}
	skipped := map[string]int{}
	for reason, count := range plan.Skipped {
		skipped[string(reason)] = count
	}
	return &Summary{
		CheckpointsInserted: applied.CheckpointsInserted,
		CheckpointsUpdated:  applied.CheckpointsUpdated,
		CheckpointsSkipped:  applied.CheckpointsSkipped,
		PendingDeleted:      applied.PendingDeleted,
		PendingInserted:     applied.PendingInserted,
		AccountsProvisioned: provisioned,
		Skipped:             skipped,
		DryRun:              applied.DryRun,
	}, nil
}

// Trigger runs Sync unless a sync is in flight or a trigger ran within
// MinTriggerInterval. The guard stamps only successful runs so a failed
// attempt stays retryable.
func (r *Runner) Trigger(ctx context.Context) (*Summary, error) {
	r.mu.Lock()
	if r.inFlight {
		r.mu.Unlock()
		return nil, &InProgressError{}
	}
	if !r.lastTrigger.IsZero() && r.now().Sub(r.lastTrigger) < MinTriggerInterval {
		retryAfter := MinTriggerInterval - r.now().Sub(r.lastTrigger)
		r.mu.Unlock()
		return nil, &TooSoonError{RetryAfter: retryAfter}
	}
	r.inFlight = true
	r.mu.Unlock()
	summary, err := r.Sync(ctx)
	r.mu.Lock()
	r.inFlight = false
	if err == nil {
		r.lastTrigger = r.now()
	}
	r.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return summary, nil
}
