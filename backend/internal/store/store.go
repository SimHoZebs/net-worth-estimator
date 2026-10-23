package store

import (
	"database/sql"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"

	_ "modernc.org/sqlite"
)

// Store is the persistence seam behind the canonical model, projection
// artifacts, and SimpleFIN sync state. The server, API handlers,
// and sync runner depend only on this interface; the SQLite file backend
// below is one implementation. Table definitions live in schema.go; this file owns the contract, the handle, and its
// lifecycle. A replacement backend (Turso, Postgres, …)
// implements these methods plus a constructor, then runs the conformance
// suite (RunConformance) to prove it.
//
// Contract notes for implementers:
//   - Writes are single-threaded by the caller discipline (one server, one
//     instance); the backend must still serialize concurrent writes safely.
//   - Readers always see the latest committed state (no stale replicas).
//   - SQL must stay portable: plain DDL/DML plus ON CONFLICT only. No
//     SQLite pragmas, extensions, or file assumptions outside Open.
//   - A fresh backend reports DocumentExists() == false. InitializeDocument
//     activates an empty model without replacing existing data. Open only
//     ensures the schema itself.
//   - Clear resets all persisted state; the conformance suite relies on it.
type Store interface {
	LoadDocument() (*types.FinancialModelDocument, error)
	DocumentExists() (bool, error)
	InitializeDocument() error
	ImportCSV(modelPath string) (*types.FinancialModelDocument, error)
	CreateAccount(account types.Account) (types.Account, error)
	UpdateAccount(account types.Account) (types.Account, error)
	DeleteAccount(id string) error
	MoveAccount(id, beforeID string) error
	CreatePosting(posting types.Posting) (types.Posting, error)
	UpdatePosting(posting types.Posting) (types.Posting, error)
	DeletePosting(id string) error
	MovePosting(id, beforeID string) error
	CreateRule(rule types.RecurrenceRule) (types.RecurrenceRule, error)
	UpdateRule(rule types.RecurrenceRule) (types.RecurrenceRule, error)
	DeleteRule(id string) error
	MoveRule(id, beforeID string) error
	SaveCheckpoint(checkpoint types.Checkpoint) (types.Checkpoint, error)
	DeleteCheckpoint(accountID, date string) error
	CreateEvaluation(item EvaluationUpdate) (EvaluationUpdate, error)
	UpdateEvaluation(item EvaluationUpdate) (EvaluationUpdate, error)
	DeleteEvaluation(instanceID string) error
	MoveEvaluation(evalType, instanceID, beforeID string) error
	SavePaymentTerms(terms types.PaymentTerms) (types.PaymentTerms, error)
	DeletePaymentTerms(accountID string) error
	ListAmountPresets() ([]types.AmountPreset, error)
	CreateAmountPreset(preset types.AmountPreset) (types.AmountPreset, error)
	UpdateAmountPreset(preset types.AmountPreset) (types.AmountPreset, error)
	DeleteAmountPreset(id string) error
	MoveAmountPreset(id, beforeID string) error
	ListPinnedEvaluations() ([]string, error)
	SetPinnedEvaluations(ids []string) ([]string, error)
	ListAccountLinks() ([]AccountLink, error)
	SaveAccountLink(link AccountLink) (AccountLink, error)
	DeleteAccountLink(bridgeAccountID string) error
	ProvisionSyncAccounts(items []SyncProvision, dryRun bool) (map[string]string, int, []string, error)
	// GetLastSyncTime reports the completion time of the last successful
	// SimpleFIN sync as RFC3339 UTC, or "" when no sync has completed yet.
	GetLastSyncTime() (string, error)
	// SetLastSyncTime records a successful sync completion time. Callers
	// pass RFC3339 UTC; dry runs and failed runs must not record.
	SetLastSyncTime(completedAt string) error
	GetArtifact(identity string) (string, bool, error)
	PutArtifact(identity, kind, payload string) error
	ApplySyncPlan(checkpoints []SyncCheckpoint, pending []SyncPosting, cardAccounts []string, dryRun bool) (SyncApplySummary, error)
	Clear() error
	Close() error
}

// sqliteStore is the embedded-SQLite Store implementation. Pure-Go driver
// (modernc), single file, WAL mode, one open connection.
type sqliteStore struct {
	db *sql.DB
}

// Open opens (creating if needed) the SQLite database and ensures the
// current schema. It returns the Store interface so callers never name the
// implementation. The preceding posting identity schema upgrades atomically.
func Open(path string) (Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1) // single-writer discipline; reads are cheap at this scale
	store := &sqliteStore{db: db}
	if err := store.ensureSchema(); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

// Close closes the database.
func (s *sqliteStore) Close() error { return s.db.Close() }

// Clear removes all canonical model rows (used by tests/import).
func (s *sqliteStore) Clear() error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("clear begin: %w", err)
	}
	defer tx.Rollback()
	if err := clearDocument(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("clear commit: %w", err)
	}
	return nil
}
