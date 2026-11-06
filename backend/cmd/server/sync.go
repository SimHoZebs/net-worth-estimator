package main

import (
	"context"
	"log/slog"
	"math/rand/v2"
	"sync"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

// syncManager is the one place that owns SimpleFIN runners. Each user
// connection gets a runner bound to that user's scoped store. Runners share
// the process-wide in-flight guard and blackout behavior per user.
type syncManager struct {
	database *sqlite.Database
	config   simplefin.Config
	mu       sync.Mutex
	runners  map[string]*simplefin.Runner
}

// newSyncManager builds the SimpleFIN manager. Invalid throttle settings
// fail closed before the server starts.
func newSyncManager(database *sqlite.Database, getenv func(string) string) (*syncManager, error) {
	triggerInterval, err := simplefin.ParsePositiveDuration(
		getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_MIN_TRIGGER_INTERVAL"),
		simplefin.MinTriggerInterval,
	)
	if err != nil {
		return nil, err
	}
	rateLimitCooldown, err := simplefin.ParsePositiveDuration(
		getenv("NET_WORTH_ESTIMATOR_SIMPLEFIN_RATE_LIMIT_COOLDOWN"),
		simplefin.DefaultRateLimitCooldown,
	)
	if err != nil {
		return nil, err
	}
	return &syncManager{
		database: database,
		config: simplefin.Config{
			MinTriggerInterval: triggerInterval,
			RateLimitCooldown:  rateLimitCooldown,
		},
		runners: map[string]*simplefin.Runner{},
	}, nil
}

// RunnerFor returns the runner for one user's scoped store, creating it on
// first use. The credential and card selection stay in that user's database
// rows; the provider can be rotated without rebuilding the runner.
func (m *syncManager) RunnerFor(userID string, scoped store.Store) *simplefin.Runner {
	m.mu.Lock()
	defer m.mu.Unlock()
	if runner, ok := m.runners[userID]; ok {
		return runner
	}
	runner := newDynamicRunner(scoped, m.config)
	m.runners[userID] = runner
	return runner
}

// SyncConfigured runs every user connection with a non-empty Bridge
// credential. A deleted or invalid user is logged and skipped without
// stopping the others.
func (m *syncManager) SyncConfigured(ctx context.Context) {
	ids, err := m.database.SyncCredentialUserIDs()
	if err != nil {
		slog.Error("simplefin scheduled sync could not list credentials", "component", "simplefin", "error", err)
		return
	}
	for _, userID := range ids {
		m.syncUser(ctx, userID)
	}
}

func (m *syncManager) syncUser(ctx context.Context, userID string) {
	scoped, err := m.database.User(userID)
	if err != nil {
		slog.Warn("simplefin scheduled sync skipped an unavailable user", "component", "simplefin", "user_id", userID, "error", err)
		return
	}
	runner := m.RunnerFor(userID, scoped)
	if !runner.IsConfigured() {
		return
	}
	summary, err := runner.Sync(ctx)
	if err != nil {
		slog.Error("simplefin scheduled sync failed", "component", "simplefin", "user_id", userID, "error", err)
		return
	}
	slog.Info("simplefin scheduled sync", "component", "simplefin", "user_id", userID,
		"checkpoints_inserted", summary.CheckpointsInserted,
		"checkpoints_updated", summary.CheckpointsUpdated,
		"checkpoints_skipped", summary.CheckpointsSkipped,
		"pending_deleted", summary.PendingDeleted,
		"pending_inserted", summary.PendingInserted,
		"pending_updated", summary.PendingUpdated,
		"settled_converted", summary.SettledConverted,
		"settled_inserted", summary.SettledInserted,
		"accounts_provisioned", summary.AccountsProvisioned,
		"skipped", summary.Skipped)
}

// newDynamicRunner builds a runner whose credential and card selection
// resolve per run from the user's stored BYOK rows, so connecting,
// rotating, or disconnecting a key takes effect without a restart.
func newDynamicRunner(scoped store.Store, config simplefin.Config) *simplefin.Runner {
	provider := func() (string, map[string]struct{}) {
		stored, err := scoped.GetSyncCredential()
		if err != nil {
			// A transient store failure must not trigger a Bridge fetch
			// with an empty key; report unconfigured until the next run.
			slog.Error("simplefin credential read failed", "component", "simplefin", "error", err)
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
	return simplefin.NewRunnerWithProvider(scoped, config, provider, nil)
}

// syncInterval is the fixed scheduler cadence: four Bridge attempts per day,
// within the Bridge daily-update quota.
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

func startSyncScheduler(manager *syncManager) func() {
	stop := make(chan struct{})
	go func() {
		timer := time.NewTimer(nextSyncDelay(time.Now(), rand.N(60)))
		defer timer.Stop()
		for {
			select {
			case <-stop:
				return
			case <-timer.C:
				manager.SyncConfigured(context.Background())
				timer.Reset(syncInterval)
			}
		}
	}()
	return func() { close(stop) }
}
