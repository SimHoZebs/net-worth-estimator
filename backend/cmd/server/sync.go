package main

import (
	"context"
	"fmt"
	"log"
	"math/rand/v2"
	"os"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// configureSync builds the SimpleFIN runner from environment. An empty
// access URL disables the sync (nil runner, trigger returns 503). An
// unparseable account map is fatal: a half-configured sync must not run.
func configureSync(database *store.Store) (*simplefin.Runner, func()) {
	accessURL := os.Getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCESS_URL")
	if accessURL == "" {
		return nil, func() {}
	}
	accountMap, err := simplefin.ParseAccountMap(os.Getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCOUNTS"))
	if err != nil {
		log.Fatalf("configure simplefin account map: %v", err)
	}
	config := simplefin.Config{
		AccessURL:    accessURL,
		AccountMap:   accountMap,
		CardAccounts: simplefin.ParseCardAccounts(os.Getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_CARDS")),
		DryRun:       simplefin.ParseDryRun(os.Getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_DRY_RUN")),
	}
	runner := simplefin.NewRunner(database, config, &simplefin.Client{AccessURL: accessURL})
	stop := startSyncScheduler(runner)
	if config.DryRun {
		fmt.Println("simplefin sync in dry-run mode: planned writes are logged, nothing is stored")
	}
	return runner, stop
}

// nextSyncDelay returns the wait until the next 3am local time plus a random
// sub-hour offset, spreading Bridge load off the top of the hour.
func nextSyncDelay(now time.Time, randMinute int) time.Duration {
	next := time.Date(now.Year(), now.Month(), now.Day(), 3, 0, 0, 0, now.Location())
	if !now.Before(next) {
		next = next.Add(24 * time.Hour)
	}
	return next.Sub(now) + time.Duration(randMinute)*time.Minute
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
				timer.Reset(24 * time.Hour)
			}
		}
	}()
	return func() { close(stop) }
}
