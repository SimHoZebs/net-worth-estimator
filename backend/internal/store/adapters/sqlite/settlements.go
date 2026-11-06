// Split settlement ledger (SOC-05). Settlements record real-world payoff
// against versioned split obligations (SOC-04B) without moving money:
// recording appends one row to split_settlements plus one idempotency
// row, and never writes transactions, checkpoints, accounts, or balances.
// Rows are append-only: there is no update or delete, so
// ListSettlements is the full history in record order. User-scoped
// Clear and model import preserve settlement history: the tables carry
// no user_id, so one user's reset never destroys shared history.
// Per-split cleanup rides the SOC-04B fencing follow-up below.
//
// Retry safety mirrors analysis feedback request IDs: one outcome row
// per (actor, request ID) replays the recorded settlement on retry,
// while the same key naming a different settlement fails with
// store.ErrSettlementConflict. A linked real payment backs at most one
// settlement across all splits and participants, so linked payments are
// never double-counted.
//
// Split identity and membership live with SOC-04B, which has not landed:
// the split ID is validated for shape only, and any provisioned user
// may record or read. Fencing record/read access to current split
// participants (including hiding history from removed participants) is
// an explicit follow-up once the split reads land.
package sqlite

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// settlementSchemaStatements creates the append-only settlement ledger
// plus its per-(actor, request ID) idempotency records. Linked payments
// use NULL halves when unlinked so the unique link index only constrains
// linked rows: one real payment backs at most one settlement.
func settlementSchemaStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS split_settlements (
			settlement_id TEXT PRIMARY KEY,
			split_id TEXT NOT NULL,
			participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
			-- The linked owner carries a bare reference (no ON DELETE
			-- action): a cascade to NULL would break the paired-NULL
			-- CHECK below, and history must survive user deletes
			-- rather than half-null the pair. Nothing deletes users
			-- today; a delete of a referenced user fails closed.
			linked_owner_id TEXT REFERENCES users(id),
			linked_transaction_id TEXT,
			actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			request_id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			CHECK ((linked_owner_id IS NULL) = (linked_transaction_id IS NULL))
		)`,
		`CREATE INDEX IF NOT EXISTS split_settlements_split ON split_settlements(split_id, created_at, settlement_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS split_settlements_link ON split_settlements(linked_owner_id, linked_transaction_id)`,
		`CREATE TABLE IF NOT EXISTS split_settlement_requests (
			actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			request_id TEXT NOT NULL,
			settlement_id TEXT NOT NULL REFERENCES split_settlements(settlement_id) ON DELETE CASCADE,
			input_hash TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (actor_id, request_id)
		)`,
	}
}

// validSettlementUserID reports whether id has the provisioned user shape
// ("user:" plus 32 hex-encoded bytes), mirroring authorization.ActorKey.
func validSettlementUserID(id string) bool {
	if !strings.HasPrefix(id, "user:") {
		return false
	}
	raw := strings.TrimPrefix(id, "user:")
	decoded, err := hex.DecodeString(raw)
	return err == nil && len(decoded) == 32 && hex.EncodeToString(decoded) == raw
}

// validSettlementUUID reports canonical lowercase UUID shape, mirroring
// transaction identity and analysis feedback request IDs.
func validSettlementUUID(id string) bool {
	parsed, err := uuid.Parse(id)
	return err == nil && parsed.String() == id
}

// settlementInputHash fingerprints one record request so a retried key
// naming a different settlement conflicts instead of replaying.
func settlementInputHash(input store.SettlementInput) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		input.SplitID, input.ParticipantID,
		fmt.Sprintf("%d", input.AmountMinor),
		input.LinkedOwnerID, input.LinkedTransactionID,
	}, "\x00")))
	return hex.EncodeToString(sum[:])
}

// checkSettlementInput validates the record shape before any storage
// read. The split ID is shape-only: split existence and membership land
// with the SOC-04B split reads.
func checkSettlementInput(input store.SettlementInput, requestID string) error {
	if !validSettlementUUID(requestID) {
		return fmt.Errorf("%w: settlement request ID must be a UUID", store.ErrGroupInvalid)
	}
	if !validSettlementUUID(input.SplitID) {
		return fmt.Errorf("%w: split must be a UUID", store.ErrGroupInvalid)
	}
	if !validSettlementUserID(input.ParticipantID) {
		return fmt.Errorf("%w: participant must be a user ID", store.ErrGroupInvalid)
	}
	if input.AmountMinor <= 0 {
		return fmt.Errorf("%w: settlement amount must be positive", store.ErrGroupInvalid)
	}
	linked := input.LinkedOwnerID != "" || input.LinkedTransactionID != ""
	if linked && (input.LinkedOwnerID == "" || input.LinkedTransactionID == "") {
		return fmt.Errorf("%w: linked payment must name owner and transaction together", store.ErrGroupInvalid)
	}
	if linked {
		if !validSettlementUserID(input.LinkedOwnerID) {
			return fmt.Errorf("%w: linked owner must be a user ID", store.ErrGroupInvalid)
		}
		if !validSettlementUUID(input.LinkedTransactionID) {
			return fmt.Errorf("%w: linked transaction must be a UUID", store.ErrGroupInvalid)
		}
	}
	return nil
}

// settlementUserExists fails closed on unknown users so typos never park
// dangling settlement records.
func settlementUserExists(tx *sql.Tx, id string) error {
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, id).Scan(&count); err != nil {
		return err
	}
	if count != 1 {
		return store.ErrNotFound
	}
	return nil
}

// settlementQuerier covers the statement surface shared by *sql.DB and
// *sql.Tx so settlement reads run inside a mutation transaction or
// standalone without nesting. The store holds one connection; nested
// transactions would deadlock.
type settlementQuerier interface {
	QueryRow(query string, args ...any) *sql.Row
}

func scanSettlement(row *sql.Row) (store.Settlement, error) {
	var record store.Settlement
	var linkedOwner, linkedTransaction sql.NullString
	err := row.Scan(&record.ID, &record.SplitID, &record.ParticipantID, &record.AmountMinor,
		&linkedOwner, &linkedTransaction, &record.ActorID, &record.RequestID, &record.CreatedAt)
	if err != nil {
		return store.Settlement{}, err
	}
	record.LinkedOwnerID = linkedOwner.String
	record.LinkedTransactionID = linkedTransaction.String
	return record, nil
}

func querySettlement(db settlementQuerier, id string) (store.Settlement, error) {
	record, err := scanSettlement(db.QueryRow(`SELECT settlement_id, split_id, participant_id, amount_minor,
		linked_owner_id, linked_transaction_id, actor_id, request_id, created_at
		FROM split_settlements WHERE settlement_id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return store.Settlement{}, store.ErrNotFound
	}
	return record, err
}

// lookupSettlementRequest returns the recorded settlement ID and input
// hash for one (actor, request ID), or sql.ErrNoRows when fresh.
func lookupSettlementRequest(db settlementQuerier, actorID, requestID string) (string, string, error) {
	var recordedID, recordedHash string
	err := db.QueryRow(`SELECT settlement_id, input_hash FROM split_settlement_requests WHERE actor_id = ? AND request_id = ?`,
		actorID, requestID).Scan(&recordedID, &recordedHash)
	return recordedID, recordedHash, err
}

// RecordSettlement appends one payoff record plus its idempotency row in
// one transaction on the store's single connection. A retried key
// replays the recorded settlement; a key reused for a different
// settlement, or a linked payment already backing another settlement,
// fails with store.ErrSettlementConflict. The write never touches
// transactions, checkpoints, accounts, or balances.
func (d *Database) RecordSettlement(actorID string, input store.SettlementInput, requestID string) (store.Settlement, error) {
	if !validSettlementUserID(actorID) {
		return store.Settlement{}, fmt.Errorf("%w: actor must be a user ID", store.ErrGroupInvalid)
	}
	if err := checkSettlementInput(input, requestID); err != nil {
		return store.Settlement{}, err
	}
	tx, err := d.db.Begin()
	if err != nil {
		return store.Settlement{}, err
	}
	defer tx.Rollback()
	if err := settlementUserExists(tx, actorID); err != nil {
		return store.Settlement{}, err
	}
	if err := settlementUserExists(tx, input.ParticipantID); err != nil {
		return store.Settlement{}, err
	}
	if input.LinkedOwnerID != "" {
		if err := settlementUserExists(tx, input.LinkedOwnerID); err != nil {
			return store.Settlement{}, err
		}
		// The link must name a real payment at record time: typos
		// must not park dangling links. This is a read-only check;
		// the write still never touches transactions. History keeps the
		// link if the payment is deleted later, mirroring
		// accepted-copy provenance: settlement history is never
		// rewritten by source edits or deletes.
		var linked int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM transactions WHERE user_id = ? AND id = ?`,
			input.LinkedOwnerID, input.LinkedTransactionID).Scan(&linked); err != nil {
			return store.Settlement{}, err
		}
		if linked != 1 {
			return store.Settlement{}, fmt.Errorf("%w: linked payment must be a real transaction", store.ErrGroupInvalid)
		}
	}
	wantHash := settlementInputHash(input)
	recordedID, recordedHash, err := lookupSettlementRequest(tx, actorID, requestID)
	if err == nil {
		if recordedHash != wantHash {
			return store.Settlement{}, fmt.Errorf("%w: request ID already recorded a different settlement", store.ErrSettlementConflict)
		}
		recorded, err := querySettlement(tx, recordedID)
		if err != nil {
			return store.Settlement{}, err
		}
		if err := tx.Commit(); err != nil {
			return store.Settlement{}, err
		}
		return recorded, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return store.Settlement{}, err
	}
	id, err := newRowID()
	if err != nil {
		return store.Settlement{}, err
	}
	now := time.Now().Unix()
	var linkedOwner, linkedTransaction any
	if input.LinkedOwnerID != "" {
		linkedOwner, linkedTransaction = input.LinkedOwnerID, input.LinkedTransactionID
	}
	if _, err := tx.Exec(`INSERT INTO split_settlements
		(settlement_id, split_id, participant_id, amount_minor, linked_owner_id, linked_transaction_id, actor_id, request_id, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, input.SplitID, input.ParticipantID, input.AmountMinor,
		linkedOwner, linkedTransaction, actorID, requestID, now); err != nil {
		if strings.Contains(err.Error(), "split_settlements.linked_owner_id") {
			return store.Settlement{}, fmt.Errorf("%w: linked payment already backs a settlement", store.ErrSettlementConflict)
		}
		return store.Settlement{}, err
	}
	if _, err := tx.Exec(`INSERT INTO split_settlement_requests (actor_id, request_id, settlement_id, input_hash, created_at)
		VALUES (?, ?, ?, ?, ?)`, actorID, requestID, id, wantHash, now); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			// A concurrent retry won the key race: this transaction
			// rolls back (discarding our duplicate row) and converges
			// to the winner's record instead of double-counting.
			if convErr := tx.Rollback(); convErr != nil {
				return store.Settlement{}, convErr
			}
			return convergeSettlementRequest(d, actorID, requestID, wantHash)
		}
		return store.Settlement{}, err
	}
	recorded, err := querySettlement(tx, id)
	if err != nil {
		return store.Settlement{}, err
	}
	if err := tx.Commit(); err != nil {
		return store.Settlement{}, err
	}
	return recorded, nil
}

// convergeSettlementRequest resolves a lost key race after rollback:
// the winner's record replays when the input matches, otherwise the key
// reuse is a conflict.
func convergeSettlementRequest(d *Database, actorID, requestID, wantHash string) (store.Settlement, error) {
	recordedID, recordedHash, err := lookupSettlementRequest(d.db, actorID, requestID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return store.Settlement{}, fmt.Errorf("%w: request ID already recorded a different settlement", store.ErrSettlementConflict)
		}
		return store.Settlement{}, err
	}
	if recordedHash != wantHash {
		return store.Settlement{}, fmt.Errorf("%w: request ID already recorded a different settlement", store.ErrSettlementConflict)
	}
	return querySettlement(d.db, recordedID)
}

// ListSettlements returns the append-only history for one split in
// record order. Unknown splits report an empty history: split existence
// checks land with the SOC-04B split reads.
func (d *Database) ListSettlements(requesterID, splitID string) ([]store.Settlement, error) {
	if !validSettlementUserID(requesterID) {
		return nil, fmt.Errorf("%w: requester must be a user ID", store.ErrGroupInvalid)
	}
	if !validSettlementUUID(splitID) {
		return nil, fmt.Errorf("%w: split must be a UUID", store.ErrGroupInvalid)
	}
	var count int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, requesterID).Scan(&count); err != nil {
		return nil, err
	}
	if count != 1 {
		return nil, store.ErrNotFound
	}
	rows, err := d.db.Query(`SELECT settlement_id, split_id, participant_id, amount_minor,
		linked_owner_id, linked_transaction_id, actor_id, request_id, created_at
		FROM split_settlements WHERE split_id = ? ORDER BY created_at, settlement_id`, splitID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	history := []store.Settlement{}
	for rows.Next() {
		var record store.Settlement
		var linkedOwner, linkedTransaction sql.NullString
		if err := rows.Scan(&record.ID, &record.SplitID, &record.ParticipantID, &record.AmountMinor,
			&linkedOwner, &linkedTransaction, &record.ActorID, &record.RequestID, &record.CreatedAt); err != nil {
			return nil, err
		}
		record.LinkedOwnerID = linkedOwner.String
		record.LinkedTransactionID = linkedTransaction.String
		history = append(history, record)
	}
	return history, rows.Err()
}
