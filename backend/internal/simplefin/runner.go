package simplefin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// rateLimitedCause unwraps err to a Bridge RateLimitedError, if any.
func rateLimitedCause(err error) *RateLimitedError {
	var rateLimited *RateLimitedError
	if err == nil || !errors.As(err, &rateLimited) {
		return nil
	}
	return rateLimited
}

// Summary describes one sync run for logs and the trigger endpoint.
type Summary struct {
	CheckpointsInserted int            `json:"checkpointsInserted"`
	CheckpointsUpdated  int            `json:"checkpointsUpdated"`
	CheckpointsSkipped  int            `json:"checkpointsSkipped"`
	PendingDeleted      int            `json:"pendingDeleted"`
	PendingInserted     int            `json:"pendingInserted"`
	PendingUpdated      int            `json:"pendingUpdated"`
	SettledConverted    int            `json:"settledConverted"`
	AccountsProvisioned int            `json:"accountsProvisioned"`
	Skipped             map[string]int `json:"skipped"`
}

// MinTriggerInterval is the default spacing for successful manual trigger
// runs. The Bridge expects 24 requests or fewer per day with quotas
// replenished throughout the day; scheduled runs every 6 hours plus one
// manual run per 6 hours stay well under that quota while keeping balances
// fresh. Override per runner with Config.MinTriggerInterval.
const MinTriggerInterval = 6 * time.Hour

// DefaultRateLimitCooldown is the default Bridge-fetch blackout after the
// Bridge reports quota exhaustion. Override with Config.RateLimitCooldown.
const DefaultRateLimitCooldown = time.Hour

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

// NotConfiguredError reports a sync attempt with no Bridge credential.
// The runner is always constructed; configuration is per-plan data.
type NotConfiguredError struct{}

func (e *NotConfiguredError) Error() string {
	return "simplefin sync is not configured"
}

// CredentialProvider resolves the current per-plan Bridge credential from
// the database: the access URL plus the card selection. Connecting,
// rotating, or disconnecting a key takes effect on the next run with no
// restart.
type CredentialProvider func() (accessURL string, cards map[string]struct{})

// Runner orchestrates fetch, map, and apply. The zero value is unusable;
// construct with NewRunner.
type Runner struct {
	store      store.Store
	config     Config
	fetch      func(ctx context.Context, start, end time.Time) (*AccountSet, error)
	credential CredentialProvider
	httpClient *http.Client
	now        func() time.Time

	mu sync.Mutex
	// lastTrigger stamps the last successful manual trigger; scheduler runs
	// do not stamp it so scheduled runs plus one manual run per interval
	// stays under the Bridge 24/day quota.
	lastTrigger time.Time
	// limitedUntil blocks Bridge fetches after the Bridge reports quota
	// exhaustion, so a frontend burst degrades to local 429s instead of
	// further Bridge hits.
	limitedUntil time.Time
	inFlight     bool

	sleep func(ctx context.Context, d time.Duration) error
	// fetchAttempts logs each Bridge hit (UTC) for the 24-hour quota
	// display. Guarded by mu with the other throttle state; pruned on
	// record and read so a long run stays bounded.
	fetchAttempts []time.Time
}

// effectiveTriggerInterval returns the configured manual-trigger spacing,
// defaulting to MinTriggerInterval.
func (r *Runner) effectiveTriggerInterval() time.Duration {
	if r.config.MinTriggerInterval > 0 {
		return r.config.MinTriggerInterval
	}
	return MinTriggerInterval
}

// effectiveRateLimitCooldown returns the configured post-429 blackout,
// defaulting to DefaultRateLimitCooldown.
func (r *Runner) effectiveRateLimitCooldown() time.Duration {
	if r.config.RateLimitCooldown > 0 {
		return r.config.RateLimitCooldown
	}
	return DefaultRateLimitCooldown
}

// rateLimitWait resolves how long to black out Bridge fetches: the Bridge
// Retry-After when present, otherwise the configured cooldown.
func (r *Runner) rateLimitWait(rateLimited *RateLimitedError) time.Duration {
	if rateLimited != nil && rateLimited.RetryAfter > 0 {
		return rateLimited.RetryAfter
	}
	return r.effectiveRateLimitCooldown()
}

// NewRunner builds a runner. client may be nil only when Fetch is stubbed.
// When client is non-nil the provider resolves its AccessURL so status and
// fetch never disagree.
func NewRunner(database store.Store, config Config, client *Client) *Runner {
	var provider CredentialProvider
	if client != nil {
		accessURL := client.AccessURL
		provider = func() (string, map[string]struct{}) { return accessURL, nil }
	}
	runner := &Runner{store: database, config: config, credential: provider, now: time.Now, sleep: sleepContext}
	if client != nil {
		httpClient := client.HTTPClient
		runner.httpClient = httpClient
		accessURL := client.AccessURL
		runner.fetch = func(ctx context.Context, start, end time.Time) (*AccountSet, error) {
			return (&Client{AccessURL: accessURL, HTTPClient: httpClient}).Fetch(ctx, start, end)
		}
	}
	if runner.fetch == nil {
		runner.fetch = runner.fetchWithCredential
	}
	return runner
}

// NewRunnerWithProvider builds a runner whose Bridge credential resolves per
// run from the provider (database credential).
func NewRunnerWithProvider(database store.Store, config Config, provider CredentialProvider, httpClient *http.Client) *Runner {
	runner := &Runner{store: database, config: config, credential: provider, httpClient: httpClient, now: time.Now, sleep: sleepContext}
	runner.fetch = runner.fetchWithCredential
	return runner
}

// fetchWithCredential resolves the current access URL at call time so a
// newly connected key takes effect without a restart.
func (r *Runner) fetchWithCredential(ctx context.Context, start, end time.Time) (*AccountSet, error) {
	accessURL, _ := r.resolveCredential()
	if accessURL == "" {
		return nil, &NotConfiguredError{}
	}
	return (&Client{AccessURL: accessURL, HTTPClient: r.httpClient}).Fetch(ctx, start, end)
}

// resolveCredential returns the current access URL and card set from the
// provider, or empty values when no provider is set.
func (r *Runner) resolveCredential() (string, map[string]struct{}) {
	if r.credential != nil {
		return r.credential()
	}
	return "", nil
}

// IsConfigured reports whether a Bridge credential is available.
func (r *Runner) IsConfigured() bool {
	if r == nil {
		return false
	}
	accessURL, _ := r.resolveCredential()
	return accessURL != "" && r.store != nil
}

// BridgeHost reports the host of the current access URL for display.
func (r *Runner) BridgeHost() string {
	if r == nil {
		return ""
	}
	accessURL, _ := r.resolveCredential()
	return BridgeHost(accessURL)
}

// effectiveCards returns the credential-provided per-plan card set.
func (r *Runner) effectiveCards() map[string]struct{} {
	merged := map[string]struct{}{}
	if _, cards := r.resolveCredential(); cards != nil {
		for id := range cards {
			merged[id] = struct{}{}
		}
	}
	return merged
}

// Sync runs fetch, link resolution, provisioning, map, and apply.
// Scheduler and first-live-run flows call it directly; manual triggers go
// through Trigger for interval guarding. Sync shares the singleflight guard
// with Trigger so a scheduled run and a manual trigger never hit the Bridge
// concurrently, and it honors the post-429 blackout without touching the
// Bridge.
func (r *Runner) Sync(ctx context.Context) (*Summary, error) {
	r.mu.Lock()
	if r.inFlight {
		r.mu.Unlock()
		return nil, &InProgressError{}
	}
	if now := r.now(); now.Before(r.limitedUntil) {
		retryAfter := r.limitedUntil.Sub(now)
		r.mu.Unlock()
		return nil, &TooSoonError{RetryAfter: retryAfter}
	}
	r.inFlight = true
	r.mu.Unlock()

	summary, err := r.fetchAndApply(ctx)

	r.mu.Lock()
	r.inFlight = false
	if rateLimited := rateLimitedCause(err); rateLimited != nil {
		wait := r.rateLimitWait(rateLimited)
		r.limitedUntil = r.now().Add(wait)
		r.mu.Unlock()
		return nil, &TooSoonError{RetryAfter: wait}
	}
	r.mu.Unlock()
	return summary, err
}

// fetchAndApply runs one Bridge fetch through map and apply with no guard
// checks. Callers own singleflight and blackout handling.
func (r *Runner) fetchAndApply(ctx context.Context) (*Summary, error) {
	now := r.now()
	end := now.Add(24 * time.Hour)
	start := now.Add(-90 * 24 * time.Hour)
	set, err := r.fetchWithRetry(ctx, start, end)
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
	cardsByID := r.effectiveCards()
	plan, err := Map(set, cardsByID, resolved, now)
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
	resolved, provisioned, stale, err := r.store.ProvisionSyncAccounts(provisions)
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
	cards := make([]string, 0, len(cardsByID))
	for accountID := range cardsByID {
		cards = append(cards, accountID)
	}
	applied, err := r.store.ApplySyncPlan(checkpoints, plan.Pending, plan.Settled, cards)
	if err != nil {
		return nil, err
	}
	// Stamp successful runs so /v1/status can report the last
	// sync time. Failed runs return above unstamped and stay retryable.
	if err := r.store.SetLastSyncTime(r.now().UTC().Format(time.RFC3339)); err != nil {
		return nil, fmt.Errorf("record sync time: %w", err)
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
		PendingUpdated:      applied.PendingUpdated,
		SettledConverted:    applied.SettledConverted,
		AccountsProvisioned: provisioned,
		Skipped:             skipped,
	}, nil
}

// Trigger runs fetchAndApply unless a sync is in flight, a trigger ran
// within the configured interval, or the Bridge rate-limit blackout is
// active. The success guard stamps only successful runs so a generic failed
// attempt stays retryable; upstream 429s instead arm the blackout and return
// TooSoon so the frontend backs off without another Bridge hit.
func (r *Runner) Trigger(ctx context.Context) (*Summary, error) {
	r.mu.Lock()
	if r.inFlight {
		r.mu.Unlock()
		return nil, &InProgressError{}
	}
	now := r.now()
	if now.Before(r.limitedUntil) {
		retryAfter := r.limitedUntil.Sub(now)
		r.mu.Unlock()
		return nil, &TooSoonError{RetryAfter: retryAfter}
	}
	interval := r.effectiveTriggerInterval()
	if !r.lastTrigger.IsZero() && now.Sub(r.lastTrigger) < interval {
		retryAfter := interval - now.Sub(r.lastTrigger)
		r.mu.Unlock()
		return nil, &TooSoonError{RetryAfter: retryAfter}
	}
	r.inFlight = true
	r.mu.Unlock()

	summary, err := r.fetchAndApply(ctx)

	r.mu.Lock()
	r.inFlight = false
	if err == nil {
		r.lastTrigger = r.now()
		r.mu.Unlock()
		return summary, nil
	}
	if rateLimited := rateLimitedCause(err); rateLimited != nil {
		wait := r.rateLimitWait(rateLimited)
		r.limitedUntil = r.now().Add(wait)
		r.mu.Unlock()
		return nil, &TooSoonError{RetryAfter: wait}
	}
	r.mu.Unlock()
	return nil, err
}
