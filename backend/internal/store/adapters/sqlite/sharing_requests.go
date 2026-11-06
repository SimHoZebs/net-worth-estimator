// Social-operation idempotency and audit (FND-05). Every mutating social
// request carries a client-generated UUID request ID. The store records one
// outcome row per (actor, request ID) in sharing_requests: a retry with the
// same key replays the recorded outcome without re-executing, while the
// same key naming a different action or target fails with
// ErrSharingConflict. Committed mutations also append one row to
// sharing_audit carrying actor, action, target identities, and time only:
// no amounts, names, accounts, memos, or transaction content ever enter audit
// payloads. Recorded outcomes return to their own actor only: grant,
// revocation, and refresh outcomes are identity-only, while an accept
// replay returns the recipient's own copy. Outcomes are never exposed
// cross-user and never appear in audit reads.
//
// Replay returns the recorded result verbatim, mirroring analysis feedback
// request IDs: it confirms the request already completed, it does not
// re-read current state. Callers read current state through their own
// model scope and link refreshes.
package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// sharingRequestsSchemaStatements creates the idempotency-key table.
// sharing_requests records one outcome row per (actor, request ID): a retry
// with the same key replays outcome_json without re-executing, while the
// same key naming a different action or target fails as a conflict. The
// outcome carries only the identities the operation already returns, never
// transaction evidence.
func sharingRequestsSchemaStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS sharing_requests (
			actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			request_id TEXT NOT NULL,
			action TEXT NOT NULL,
			owner_user_id TEXT NOT NULL,
			transaction_id TEXT NOT NULL,
			audience_type TEXT NOT NULL DEFAULT '',
			audience_id TEXT NOT NULL DEFAULT '',
			link_id TEXT NOT NULL DEFAULT '',
			outcome_json TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (actor_user_id, request_id)
		)`,
	}
}

// sharingStorage covers the statement surface shared by *sql.DB and *sql.Tx
// so idempotency and audit helpers run inside a mutation transaction or as
// standalone statements without nesting. The store holds one connection;
// nested transactions would deadlock.
type sharingStorage interface {
	Exec(query string, args ...any) (sql.Result, error)
	QueryRow(query string, args ...any) *sql.Row
}

// sharingRequestOutcome is the stored envelope for one (actor, request ID).
// Result carries the operation's recorded return value: a SharingGrant for
// grants and exclusions, a SharingRevocation for revokes and
// exclusion removals, a Transaction for accepts, a SharingLinkRefresh for
// refreshes.
type sharingRequestOutcome struct {
	Action        string          `json:"action"`
	OwnerUserID   string          `json:"ownerUserId"`
	TransactionID string          `json:"transactionId"`
	Audience      string          `json:"audienceType"`
	AudienceID    string          `json:"audienceId"`
	LinkID        string          `json:"linkId"`
	Result        json.RawMessage `json:"result"`
}

// checkSharingRequestID rejects empty or non-UUID request keys. Keys are
// client-generated UUIDs in canonical lowercase form, mirroring analysis
// feedback request IDs.
func checkSharingRequestID(requestID string) error {
	parsed, err := uuid.Parse(requestID)
	if err != nil || parsed.String() != requestID {
		return fmt.Errorf("%w: sharing request ID must be a UUID", store.ErrGroupInvalid)
	}
	return nil
}

// lookupSharingRequest returns the recorded outcome for one (actor, key),
// or sql.ErrNoRows when the key is fresh.
func lookupSharingRequest(db sharingStorage, actor, requestID string) (sharingRequestOutcome, error) {
	var outcome sharingRequestOutcome
	var raw string
	err := db.QueryRow(`SELECT action, owner_user_id, transaction_id, audience_type, audience_id, link_id, outcome_json FROM sharing_requests WHERE actor_user_id = ? AND request_id = ?`,
		actor, requestID).Scan(&outcome.Action, &outcome.OwnerUserID, &outcome.TransactionID, &outcome.Audience, &outcome.AudienceID, &outcome.LinkID, &raw)
	if err != nil {
		return sharingRequestOutcome{}, err
	}
	outcome.Result = json.RawMessage(raw)
	return outcome, nil
}

// matchSharingRequest verifies a recorded outcome names the same operation.
// A key reused for a different action or target fails as a conflict: the
// recorded result must never alias an unrelated request.
func matchSharingRequest(recorded sharingRequestOutcome, action, ownerID, transactionID, audienceType, audienceID, linkID string) error {
	if recorded.Action != action || recorded.OwnerUserID != ownerID || recorded.TransactionID != transactionID ||
		recorded.Audience != audienceType || recorded.AudienceID != audienceID || recorded.LinkID != linkID {
		return fmt.Errorf("%w: sharing request ID already completed a different action", store.ErrSharingConflict)
	}
	return nil
}

// decodeSharingResult replays a recorded outcome into its operation type.
func decodeSharingResult[T any](recorded sharingRequestOutcome) (T, error) {
	var result T
	if err := json.Unmarshal(recorded.Result, &result); err != nil {
		var zero T
		return zero, err
	}
	return result, nil
}

// recordSharingRequest stores the completed outcome for one (actor, key).
// Callers invoke it after the mutation commits (or in the same
// transaction); failed attempts never consume the key, so a conflicted or
// interrupted request retries with the same key as a fresh execution.
func recordSharingRequest(db sharingStorage, actor, requestID, action, ownerID, transactionID, audienceType, audienceID, linkID string, result any) error {
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	if _, err := db.Exec(`INSERT INTO sharing_requests(actor_user_id, request_id, action, owner_user_id, transaction_id, audience_type, audience_id, link_id, outcome_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		actor, requestID, action, ownerID, transactionID, audienceType, audienceID, linkID, string(raw), now); err != nil {
		return fmt.Errorf("record sharing request: %w", err)
	}
	return nil
}
