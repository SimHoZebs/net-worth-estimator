package main

import (
	"context"
	"log"
	"math/rand/v2"
	"os"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

// ownerSyncStore returns the owner account's store when it exists, or nil when
// the account has not been provisioned yet (before first login). It never fails
// for a missing account and never provisions one, so a fresh deployment
// starts unconfigured and picks up a stored key once the owner connects.
// The Bridge credential lives only in that account's database rows, never in
// the environment.
func ownerSyncStore(database *sqlite.Database, issuer, subject string) (store.Store, error) {
	if subject == "" {
		return nil, nil
	}
	accountID := authorization.ResourceFor(issuer, subject).ID
	exists, err := database.HasPlan(accountID)
	if err != nil || !exists {
		return nil, err
	}
	return database.Plan(accountID)
}

// configureSync builds the SimpleFIN runner on the owner account's scoped
// store. The credential and card selection come only from that account's
// database rows: an empty credential leaves the runner unconfigured and
// the trigger returns 503. A nil store (no owner account provisioned yet at
// boot) disables the sync the same way. After first login provisions the
// account and the key is connected, restart once so startup can scope the
// runner.
//
// Throttling matches the Bridge daily-update quota (24 requests or fewer
// per day, replenished throughout the day): the scheduler runs every 6
// hours (four runs per day), successful manual triggers are spaced by
// MIN_TRIGGER_INTERVAL (default 6h), concurrent scheduler and
// trigger runs share one singleflight guard, and an upstream 429 arms a
// RATE_LIMIT_COOLDOWN blackout (default 1h) so frontend bursts degrade to
// local 429s with Retry-After instead of further Bridge hits.
func configureSync(database store.Store) (*simplefin.Runner, func()) {
	triggerInterval, err := simplefin.ParsePositiveDuration(
		os.Getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_MIN_TRIGGER_INTERVAL"),
		simplefin.MinTriggerInterval,
	)
	if err != nil {
		log.Fatalf("invalid simplefin trigger interval: %v", err)
	}
	rateLimitCooldown, err := simplefin.ParsePositiveDuration(
		os.Getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_RATE_LIMIT_COOLDOWN"),
		simplefin.DefaultRateLimitCooldown,
	)
	if err != nil {
		log.Fatalf("invalid simplefin rate-limit cooldown: %v", err)
	}
	if database == nil {
		log.Print("simplefin sync is not configured: no owner plan provisioned yet")
		return nil, func() {}
	}
	config := simplefin.Config{
		MinTriggerInterval: triggerInterval,
		RateLimitCooldown:  rateLimitCooldown,
	}
	runner := newDynamicRunner(database, config)
	stop := startSyncScheduler(runner)
	return runner, stop
}

// newDynamicRunner builds a runner whose credential and card selection
// resolve per run from the account's stored BYOK rows, so connecting,
// rotating, or disconnecting a key takes effect without a restart.
func newDynamicRunner(database store.Store, config simplefin.Config) *simplefin.Runner {
	provider := func() (string, map[string]struct{}) {
		stored, err := database.GetSyncCredential()
		if err != nil {
			// A transient store failure must not trigger a Bridge fetch
			// with an empty key; report unconfigured until the next run.
			log.Printf("simplefin credential read failed: %v", err)
			return "", nil
		}
		if stored.AccessURL == "" {
			return "", nil
		}
		cards := map[string]struct{}{}
		for _, id := range stored.CardAccounts {
			if id != "" {
				cards[id] = struct{}{}
			}
		}
		return stored.AccessURL, cards
	}
	return simplefin.NewRunnerWithProvider(database, config, provider, nil)
}

// syncInterval is the fixed scheduler cadence: four Bridge hits per day,
// well under the Bridge daily-update quota (24 requests or fewer per day).
const syncInterval = 6 * time.Hour

// nextSyncDelay returns the wait until the next 6-hour boundary (00, 06,
// 12, 18 local) plus a random sub-hour offset, spreading Bridge load off
// the top of the hour.
func nextSyncDelay(now time.Time, randMinute int) time.Duration {
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	for _, hour := range []int{0, 6, 12, 18, 24} {
		candidate := midnight.Add(time.Duration(hour) * time.Hour)
		if now.After(candidate) {
			continue
		}
		return candidate.Sub(now) + time.Duration(randMinute)*time.Minute
	}
	return syncInterval + time.Duration(randMinute)*time.Minute
}

func startSyncScheduler(runner *simplefin.Runner) func() {
	stop := make(chan struct{})
	go func() {
		timer := time.NewTimer(nextSyncDelay(time.Now(), rand.N(60)))
		defer timer.Stop()
		for {
			select {
			case <-stop:
				return
			case <-timer.C:
				if !runner.IsConfigured() {
					timer.Reset(syncInterval)
					continue
				}
				summary, err := runner.Sync(context.Background())
				if err != nil {
					log.Printf("simplefin scheduled sync failed: %v", err)
				} else {
					log.Printf("simplefin scheduled sync: %+v", summary)
				}
				timer.Reset(syncInterval)
			}
		}
	}()
	return func() { close(stop) }
}
