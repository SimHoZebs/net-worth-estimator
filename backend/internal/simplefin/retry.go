package simplefin

import (
	"context"
	"errors"
	"net"
	"net/url"
	"os"
	"time"
)

// BridgeDailyQuota is the SimpleFIN daily-update allowance the sync stays
// under: 24 Bridge requests or fewer per day, quotas replenished throughout
// the day. The status endpoint reports usage against this limit.
const BridgeDailyQuota = 24

// effectiveFetchMaxAttempts returns the configured transient-fetch retry
// budget, defaulting to DefaultFetchMaxAttempts. Only 1 means no retry.
func (r *Runner) effectiveFetchMaxAttempts() int {
	if r.config.FetchMaxAttempts > 0 {
		return r.config.FetchMaxAttempts
	}
	return DefaultFetchMaxAttempts
}

// effectiveFetchRetryDelay returns the wait between transient fetch
// attempts, defaulting to DefaultFetchRetryDelay.
func (r *Runner) effectiveFetchRetryDelay() time.Duration {
	if r.config.FetchRetryDelay > 0 {
		return r.config.FetchRetryDelay
	}
	return DefaultFetchRetryDelay
}

// sleepContext waits for d or until ctx ends, so retries never outlive the
// caller.
func sleepContext(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			return nil
		}
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// isTransientFetchError reports whether a fetch failure is worth one more
// Bridge hit: timeouts and 5xx only. Quota (RateLimited), auth/4xx
// (StatusError below 500), missing credential, and caller cancellation are
// permanent for this attempt and must not retry.
func isTransientFetchError(ctx context.Context, err error) bool {
	if err == nil {
		return false
	}
	var rateLimited *RateLimitedError
	if errors.As(err, &rateLimited) {
		return false
	}
	var notConfigured *NotConfiguredError
	if errors.As(err, &notConfigured) {
		return false
	}
	var status *StatusError
	if errors.As(err, &status) {
		return status.StatusCode >= 500 && status.StatusCode < 600
	}
	if errors.Is(err, context.Canceled) {
		return false
	}
	if ctx != nil && ctx.Err() != nil {
		return false
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) && urlErr.Timeout() {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	if errors.Is(err, os.ErrDeadlineExceeded) {
		return true
	}
	return false
}

// sleepCtx waits between attempts using the injected sleeper, falling back
// to sleepContext for zero-value runners.
func (r *Runner) sleepCtx(ctx context.Context, d time.Duration) error {
	if r.sleep != nil {
		return r.sleep(ctx, d)
	}
	return sleepContext(ctx, d)
}

// QuotaUsage reports Bridge hits in the trailing 24 hours against
// BridgeDailyQuota. Nil-safe: a nil runner (sample plans, unconfigured
// server) reports zero usage. Local refusals (interval guard, blackout,
// in-flight, missing credential) never reach the Bridge and are not
// counted; each attempted fetch that leaves the host counts, including
// retries.
func (r *Runner) QuotaUsage() (used, limit int) {
	if r == nil {
		return 0, 0
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	cutoff := r.now().Add(-24 * time.Hour)
	kept := r.fetchAttempts[:0]
	for _, at := range r.fetchAttempts {
		if !at.Before(cutoff) {
			kept = append(kept, at)
		}
	}
	r.fetchAttempts = kept
	return len(r.fetchAttempts), BridgeDailyQuota
}

// recordBridgeHit logs one Bridge fetch attempt (UTC), pruning entries
// older than 24 hours.
func (r *Runner) recordBridgeHit(at time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	at = at.UTC()
	r.fetchAttempts = append(r.fetchAttempts, at)
	cutoff := at.Add(-24 * time.Hour)
	kept := r.fetchAttempts[:0]
	for _, ts := range r.fetchAttempts {
		if !ts.Before(cutoff) {
			kept = append(kept, ts)
		}
	}
	r.fetchAttempts = kept
}

// fetchWithRetry runs one Bridge fetch, retrying transient failures (timeout,
// 5xx) until the attempt budget is spent. Permanent failures return at once.
// The wait respects ctx so a canceled trigger or shutdown stops the retry.
func (r *Runner) fetchWithRetry(ctx context.Context, start, end time.Time) (*AccountSet, error) {
	attempts := r.effectiveFetchMaxAttempts()
	if attempts < 1 {
		attempts = 1
	}
	delay := r.effectiveFetchRetryDelay()
	var err error
	var set *AccountSet
	for attempt := 1; attempt <= attempts; attempt++ {
		set, err = r.fetch(ctx, start, end)
		// Count the hit only when the attempt could have left the host.
		// A missing credential fails before any HTTP request.
		var notConfigured *NotConfiguredError
		if !errors.As(err, &notConfigured) {
			r.recordBridgeHit(r.now())
		}
		if err == nil {
			return set, nil
		}
		if attempt >= attempts {
			break
		}
		if !isTransientFetchError(ctx, err) {
			return nil, err
		}
		if sleepErr := r.sleepCtx(ctx, delay); sleepErr != nil {
			return nil, err
		}
	}
	return nil, err
}
