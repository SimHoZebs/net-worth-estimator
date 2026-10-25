package main

import (
	"context"
	"fmt"
	"log"
	"math/rand/v2"
	"os"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// configureSync builds the SimpleFIN runner from environment. An empty
// access URL disables the sync (nil runner, trigger returns 503), unless
// mock mode fabricates Bridge responses for local development.
// Account links live in the database: unmapped bridge accounts are
// auto-provisioned, and disaster recovery is a database backup, never an
// env map. Mock and real sources are mutually exclusive: mock rows are
// intentionally identical to real sync rows, so cutover is a documented
// DB purge (backend/scripts/purge-simplefin-sync.sql), never a code branch.
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
	mockMode := simplefin.ParseMockMode(os.Getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK"))
	mockFile := strings.TrimSpace(os.Getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK_FILE"))
	accessURL := os.Getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCESS_URL")
	if mockMode && accessURL != "" {
		log.Fatalf("simplefin mock and access URL are mutually exclusive: unset one")
	}
	if !mockMode && mockFile != "" {
		log.Fatalf("simplefin mock file requires NET_WORTH_ESTIMATOR_SIMPLEFIN_MOCK=1")
	}
	if mockMode {
		config := simplefin.Config{
			CardAccounts:       simplefin.ParseCardAccounts(os.Getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_CARDS")),
			DryRun:             simplefin.ParseDryRun(os.Getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_DRY_RUN")),
			MinTriggerInterval: triggerInterval,
			RateLimitCooldown:  rateLimitCooldown,
		}
		var runner *simplefin.Runner
		if mockFile != "" {
			runner = simplefin.NewMockRunnerFromFile(database, config, mockFile)
		} else {
			runner = simplefin.NewMockRunner(database, config)
		}
		stop := startSyncScheduler(runner)
		fmt.Println("simplefin sync in MOCK mode [simplefin-mock]: responses are fabricated, nothing talks to the Bridge")
		if config.DryRun {
			fmt.Println("simplefin sync in dry-run mode: planned writes are logged, nothing is stored")
		}
		return runner, stop
	}
	if accessURL == "" {
		return nil, func() {}
	}
	config := simplefin.Config{
		AccessURL:          accessURL,
		CardAccounts:       simplefin.ParseCardAccounts(os.Getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_CARDS")),
		DryRun:             simplefin.ParseDryRun(os.Getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_DRY_RUN")),
		MinTriggerInterval: triggerInterval,
		RateLimitCooldown:  rateLimitCooldown,
	}
	runner := simplefin.NewRunner(database, config, &simplefin.Client{AccessURL: accessURL})
	stop := startSyncScheduler(runner)
	if config.DryRun {
		fmt.Println("simplefin sync in dry-run mode: planned writes are logged, nothing is stored")
	}
	return runner, stop
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
