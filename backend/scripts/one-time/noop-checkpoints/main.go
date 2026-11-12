// This standalone, one-time operator script removes historical forward
// bank checkpoints whose posted balance matches the modeled balance at their
// instant. Such a checkpoint sets the balance to the value it already has,
// so it reconciles nothing and need not occupy a row. The runtime sync path
// already skips these rows for new observations; this tool prunes rows that
// predate that guard. Neither the server nor setupdb calls it.
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type counts struct {
	Users   int
	Checked int
	Deleted int
	Skipped int
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("noop-checkpoints", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dbPath := flags.String("db", "", "existing SQLite database to prune in place, with the app stopped")
	dryRun := flags.Bool("dry-run", false, "report deletable rows without deleting")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if strings.TrimSpace(*dbPath) == "" || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: go run ./scripts/one-time/noop-checkpoints --db PATH [--dry-run]")
		return 2
	}
	result, err := upgrade(*dbPath, *dryRun)
	if err != nil {
		fmt.Fprintf(stderr, "noop checkpoint prune: %v\n", err)
		return 1
	}
	if *dryRun {
		fmt.Fprintf(stdout, "noop checkpoint prune dry run (%d users, %d checked, %d deletable, %d skipped)\n",
			result.Users, result.Checked, result.Deleted, result.Skipped)
		return 0
	}
	fmt.Fprintf(stdout, "noop checkpoint prune complete (%d users, %d checked, %d deleted, %d skipped)\n",
		result.Users, result.Checked, result.Deleted, result.Skipped)
	return 0
}

// deletable is one forward sync-owned observation with an exact zero delta.
type deletable struct {
	accountID  string
	observedAt int64
}

func upgrade(path string, dryRun bool) (counts, error) {
	var result counts
	abs, err := filepath.Abs(path)
	if err != nil {
		return result, err
	}
	if info, err := os.Lstat(abs); err != nil {
		return result, err
	} else if !info.Mode().IsRegular() {
		return result, fmt.Errorf("database must be an existing regular file")
	}
	if _, err := os.Lstat(abs + "-journal"); err == nil {
		return result, fmt.Errorf("database has a hot rollback journal; stop every writer and retry")
	} else if !os.IsNotExist(err) {
		return result, err
	}
	database, err := sqlite.OpenDatabase(abs)
	if err != nil {
		return result, err
	}
	defer database.Close()

	var users []string
	rows, err := database.SQL().Query(`SELECT DISTINCT user_id FROM checkpoints ORDER BY user_id`)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return result, err
		}
		users = append(users, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return result, err
	}
	if err := rows.Close(); err != nil {
		return result, err
	}
	result.Users = len(users)
	if len(users) == 0 {
		return result, nil
	}

	// Phase one is read-only across every user, including provider
	// lookups: a replay failure skips that user, and a lookup failure
	// aborts before any deletion anywhere.
	type pending struct {
		userID string
		scoped store.Store
		keys   []store.SyncCheckpointKey
	}
	pendings := make([]pending, 0, len(users))
	for _, userID := range users {
		scoped, err := database.User(userID)
		if err != nil {
			return result, err
		}
		model, err := scoped.LoadModel()
		if err != nil {
			return result, err
		}
		if model == nil || len(model.Checkpoints) == 0 {
			continue
		}
		result.Checked++
		raw, err := deletableKeys(model)
		if err != nil {
			// An unpreparable model never blocks the remaining users.
			// Keep its rows and report the skip.
			result.Skipped++
			continue
		}
		if len(raw) == 0 {
			continue
		}
		keys := make([]store.SyncCheckpointKey, 0, len(raw))
		for _, key := range raw {
			var provider, source string
			err := database.SQL().QueryRow(
				`SELECT provider, source FROM checkpoints WHERE user_id = ? AND model_account_id = ? AND observed_at = ?`,
				userID, key.accountID, key.observedAt,
			).Scan(&provider, &source)
			if err == sql.ErrNoRows {
				return result, fmt.Errorf("user %s checkpoint %s %d vanished before prune", userID, key.accountID, key.observedAt)
			}
			if err != nil {
				return result, err
			}
			if domain.IsOwnerAuthored(source) {
				continue
			}
			keys = append(keys, store.SyncCheckpointKey{AccountID: key.accountID, ObservedAt: key.observedAt, Provider: provider})
		}
		if len(keys) == 0 {
			continue
		}
		pendings = append(pendings, pending{userID: userID, scoped: scoped, keys: keys})
	}
	total := 0
	for _, p := range pendings {
		total += len(p.keys)
	}
	if dryRun {
		result.Deleted = total
		return result, nil
	}

	// Phase two deletes per user through the tested store path, which
	// removes the available-balance sidecar and marks the projection dirty
	// to the earliest deleted instant.
	for _, p := range pendings {
		deleted, err := p.scoped.DeleteSyncCheckpoints(p.keys)
		if err != nil {
			return result, err
		}
		if deleted != len(p.keys) {
			return result, fmt.Errorf("user %s prune deleted %d of %d rows", p.userID, deleted, len(p.keys))
		}
		result.Deleted += deleted
	}
	return result, nil
}

// deletableKeys returns the forward sync-owned observations with an exact
// zero delta. An error reports a replay failure: the caller skips that user
// without deleting anything. First observations are always kept: they
// establish coverage even when the opening balance already matches.
func deletableKeys(model *types.FinancialModel) ([]deletable, error) {
	latest := int64(0)
	for _, checkpoint := range model.Checkpoints {
		if checkpoint.ObservedAt > latest {
			latest = checkpoint.ObservedAt
		}
	}
	if latest <= 0 {
		return nil, nil
	}
	zero, err := domain.ZeroDeltaObservations(model, time.Unix(latest, 0).UTC().Format(time.RFC3339))
	if err != nil {
		return nil, err
	}
	byAccount := make(map[string][]types.Checkpoint, len(model.Checkpoints))
	for _, checkpoint := range model.Checkpoints {
		byAccount[checkpoint.AccountID] = append(byAccount[checkpoint.AccountID], checkpoint)
	}
	var out []deletable
	for _, list := range byAccount {
		sort.SliceStable(list, func(i, j int) bool { return list[i].ObservedAt < list[j].ObservedAt })
		for i, checkpoint := range list {
			if i == 0 {
				continue
			}
			if domain.IsOwnerAuthored(checkpoint.Source) {
				continue
			}
			key := domain.ObservationKey{AccountID: checkpoint.AccountID, ObservedAt: checkpoint.ObservedAt}
			if _, ok := zero[key]; !ok {
				continue
			}
			prev := list[i-1]
			if checkpoint.AvailableBalance != nil && (prev.AvailableBalance == nil || *checkpoint.AvailableBalance != *prev.AvailableBalance) {
				continue
			}
			out = append(out, deletable{accountID: checkpoint.AccountID, observedAt: checkpoint.ObservedAt})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].accountID != out[j].accountID {
			return out[i].accountID < out[j].accountID
		}
		return out[i].observedAt < out[j].observedAt
	})
	return out, nil
}
