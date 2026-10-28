package store

import (
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
//   - Every operation belongs to one immutable plan scope. There is no default
//     private scope and no database-wide financial operation.
//   - Writes are single-threaded by the caller discipline (one server, one
//     instance); the backend must still serialize concurrent writes safely.
//   - Readers always see the latest committed state (no stale replicas).
//   - SQL must stay portable: plain DDL/DML plus ON CONFLICT only. No
//     SQLite pragmas, extensions, or file assumptions outside database setup.
//   - A fresh backend reports DocumentExists() == false. InitializeDocument
//     activates an empty model without replacing existing data.
//   - Clear resets this plan's model, sync state (including the Bridge key
//     and card selection), settings, and artifacts. It preserves amount
//     presets, plan ownership, other plans, and identity state. Use
//     ClearSyncCredential to disconnect the key while keeping cards.
type Store interface {
	ReceiptStore
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
	GetSafeSpendingSettings() (*types.SafeSpendingSettings, error)
	SetSafeSpendingSettings(types.SafeSpendingSettings) error
	SetPinnedEvaluations(ids []string) ([]string, error)
	ListAccountLinks() ([]AccountLink, error)
	SaveAccountLink(link AccountLink) (AccountLink, error)
	DeleteAccountLink(bridgeAccountID string) error
	ProvisionSyncAccounts(items []SyncProvision) (map[string]string, int, []string, error)
	// GetSyncCredential reports the stored per-plan SimpleFIN credential, or
	// a zero credential when no key is connected. The AccessURL is a secret
	// and must never leave the server in API payloads or logs.
	GetSyncCredential() (SyncCredential, error)
	// SetSyncCredential stores the Bridge Access URL with display metadata.
	SetSyncCredential(accessURL, bridgeHost string) (SyncCredential, error)
	// ClearSyncCredential disconnects the Bridge key, keeping card selection.
	ClearSyncCredential() error
	// GetSyncCards reports the per-plan card account selection.
	GetSyncCards() ([]string, error)
	// SetSyncCards replaces the per-plan card account selection.
	SetSyncCards(cards []string) ([]string, error)
	// GetLastSyncTime reports the completion time of the last successful
	// SimpleFIN sync as RFC3339 UTC, or "" when no sync has completed yet.
	GetLastSyncTime() (string, error)
	// SetLastSyncTime records a successful sync completion time. Callers
	// pass RFC3339 UTC; failed runs must not record.
	SetLastSyncTime(completedAt string) error
	GetArtifact(identity string) (string, bool, error)
	PutArtifact(identity, kind, payload string) error
	ApplySyncPlan(checkpoints []SyncCheckpoint, pending []SyncPosting, settled []SyncPosting, cardAccounts []string) (SyncApplySummary, error)
	Clear() error
	Close() error
}

// sqliteStore is the embedded-SQLite Store implementation. Pure-Go driver
// (modernc), single file, WAL mode, one open connection.
type sqliteStore struct {
	db          *planDB
	owned       *Database
	application *Database
}

// Open creates or opens an explicit plans/fixture scope for isolated tests
// and fixture tools. Runtime callers must use OpenDatabase. Legacy unscoped
// databases are rejected and never converted here.
func Open(path string) (Store, error) {
	db, err := SetupDatabase(path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	store, err := db.ensurePlan("plans/fixture", "fixture", "", "", "")
	if err != nil {
		db.Close()
		return nil, err
	}
	store.(*sqliteStore).owned = db
	return store, nil
}

// Close releases an owned fixture database. Shared plan handles never close it.
func (s *sqliteStore) Close() error {
	if s.owned != nil {
		return s.owned.Close()
	}
	return nil
}

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
