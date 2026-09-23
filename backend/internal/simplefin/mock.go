// Mock SimpleFIN Bridge responses for local development.
//
// This file is temporary scaffolding for the mock interlude: it fabricates
// bridge-shaped AccountSets so the sync can be exercised without Bridge
// credentials. Mock rows are intentionally identical to real sync rows
// (source "simplefin", sfin-pending-* IDs) and flow through the same
// Map/ApplySyncPlan path, so no store or mapper logic branches on mock vs
// real. Cutover is a documented DB purge, not code:
// backend/scripts/purge-simplefin-sync.sql.
//
// Removal checklist when the real Bridge is wired up: delete this file and
// mock_test.go, drop the MOCK env wiring in cmd/server/sync.go, and remove
// the mock docs from .env.example, README.md, and tasks/simplefin-sync-plan.md.
// `grep -r MockRunner backend` and `grep -ri mock backend/scripts` should
// then return nothing.
package simplefin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// ParseMockMode reports whether mock Bridge mode is on. Only "1" enables
// it, mirroring ParseDryRun strictness so mock mode never starts by typo.
func ParseMockMode(value string) bool {
	return strings.TrimSpace(value) == "1"
}

// MockAccountSet returns a deterministic bridge-shaped fixture: a checking
// balance, a card balance with one pending charge, plus one posted charge
// and one positive pending transaction that the mapper must skip. IDs are
// stable (mock-checking, mock-prime) so operators can map them with
// NET_WORTH_ESTIMATOR_SIMPLEFIN_ACCOUNTS=mock-checking=checking,mock-prime=prime_card.
func MockAccountSet(now time.Time) *AccountSet {
	stamp := now.UTC().Unix()
	pending := true
	return &AccountSet{
		Accounts: []Account{
			{
				ID:          "mock-checking",
				Name:        "Mock Checking",
				Currency:    "USD",
				Balance:     "1523.10",
				BalanceDate: stamp,
			},
			{
				ID:          "mock-prime",
				Name:        "Mock Prime Card",
				Currency:    "USD",
				Balance:     "-412.55",
				BalanceDate: stamp,
				Transactions: []Transaction{
					{ID: "mock-pend1", Amount: "-42.10", Description: "Mock Corner Store", Pending: &pending},
					{ID: "mock-ref1", Amount: "25.00", Description: "Mock pending refund", Pending: &pending},
					{ID: "mock-post1", Posted: stamp - 86400, Amount: "-18.00", Description: "Mock posted merchant"},
					{ID: "mock-pay1", Posted: stamp - 86400, Amount: "400.00", Description: "Mock card payment"},
				},
			},
		},
	}
}

// LoadMockAccountSet reads a bridge-shaped AccountSet (GET /accounts body)
// from path, so operators can craft custom mock payloads without code.
func LoadMockAccountSet(path string) (*AccountSet, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open mock account set %s: %w", path, err)
	}
	defer file.Close()
	body, err := io.ReadAll(io.LimitReader(file, 32<<20))
	if err != nil {
		return nil, fmt.Errorf("read mock account set %s: %w", path, err)
	}
	var set AccountSet
	if err := json.Unmarshal(body, &set); err != nil {
		return nil, fmt.Errorf("decode mock account set %s: %w", path, err)
	}
	return &set, nil
}

// NewMockRunner builds a runner whose fetch returns MockAccountSet instead
// of hitting the Bridge. Mapping, apply, guards, and scheduler behavior are
// unchanged.
func NewMockRunner(database store.Store, config Config) *Runner {
	runner := NewRunner(database, config, nil)
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		return MockAccountSet(runner.now()), nil
	}
	return runner
}

// NewMockRunnerFromFile builds a mock runner that reloads the AccountSet
// from path on every fetch, so file edits apply without a restart.
func NewMockRunnerFromFile(database store.Store, config Config, path string) *Runner {
	runner := NewRunner(database, config, nil)
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		return LoadMockAccountSet(path)
	}
	return runner
}
