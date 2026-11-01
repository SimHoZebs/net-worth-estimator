// Versioned split persistence (SOC-04B). Splits divide one shared
// transaction across authorized participants as immutable version rows:
// every revision appends a version, accepted shares are never edited in
// place, and every mutation is retry-safe through the social-operation
// request-ID contract (FND-05) with explicit revision conflicts. Split
// writes never touch postings, checkpoints, accounts, or balances, so
// acceptance moves no money.
package sqlite

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// splitSchemaStatements creates versioned split obligation rows. One splits
// row is one immutable version; split_allocations carries that version's
// per-participant shares in integer minor units plus per-participant
// acceptance. Versions are append-only: updates insert, never rewrite.
func splitSchemaStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS splits (
			split_id TEXT NOT NULL,
			version INTEGER NOT NULL CHECK (version >= 1),
			source_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			source_posting_id TEXT NOT NULL,
			source_revision TEXT NOT NULL DEFAULT '',
			initiator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			currency TEXT NOT NULL,
			total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
			status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (split_id, version)
		)`,
		`CREATE INDEX IF NOT EXISTS splits_source ON splits(source_owner_id, source_posting_id)`,
		`CREATE TABLE IF NOT EXISTS split_allocations (
			split_id TEXT NOT NULL,
			version INTEGER NOT NULL,
			position INTEGER NOT NULL,
			participant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
			accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0, 1)),
			accepted_at INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (split_id, version, participant_id),
			FOREIGN KEY (split_id, version) REFERENCES splits(split_id, version) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS split_allocations_participant ON split_allocations(participant_id)`,
	}
}

// splitQuerier covers the statement surface shared by *sql.DB and *sql.Tx
// so split reads run inside a mutation transaction or standalone without
// nesting. The store holds one connection; nested transactions would
// deadlock.
type splitQuerier interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

func validSplitID(id string) bool {
	parsed, err := uuid.Parse(id)
	return err == nil && parsed.String() == id
}

// checkSplitInput validates the proposal shape before any storage or
// authorization read. Share math stays with domain.AllocateSplit (SOC-04A);
// the store only persists its result.
func checkSplitInput(input store.SplitInput) ([]store.SplitAllocation, error) {
	if !validSharingUserID(input.SourceOwnerID) || !validSharingPostingID(input.SourcePostingID) {
		return nil, fmt.Errorf("%w: source owner and posting must identify one transaction", store.ErrGroupInvalid)
	}
	if !validSharingUserID(input.InitiatorID) {
		return nil, fmt.Errorf("%w: initiator must be a user ID", store.ErrGroupInvalid)
	}
	for _, id := range input.ParticipantIDs {
		if !validSharingUserID(id) {
			return nil, fmt.Errorf("%w: participant IDs must be user IDs", store.ErrGroupInvalid)
		}
	}
	shares, err := domain.AllocateSplit(domain.SplitInput{
		TotalMinor:     input.TotalMinor,
		Currency:       input.Currency,
		InitiatorID:    input.InitiatorID,
		ParticipantIDs: input.ParticipantIDs,
		Overrides:      input.Overrides,
	})
	if err != nil {
		return nil, fmt.Errorf("%w: %v", store.ErrGroupInvalid, err)
	}
	allocations := make([]store.SplitAllocation, 0, len(shares))
	for _, share := range shares {
		allocations = append(allocations, store.SplitAllocation{
			ParticipantID: share.ParticipantID,
			AmountMinor:   share.AmountMinor,
		})
	}
	return allocations, nil
}

// authorizeSplitParticipants requires every participant to hold current
// shared-posting access to the source. Failures report ErrNotFound without
// naming who lacks access, so participant authorization never leaks who
// can see the source transaction.
func (d *Database) authorizeSplitParticipants(ownerID, postingID string, participants []string) error {
	for _, participant := range participants {
		access, err := d.CheckSharedPostingAccess(ownerID, postingID, participant)
		if err != nil {
			return err
		}
		if !access.Allowed {
			return fmt.Errorf("%w: every split participant must hold current access to the shared transaction", store.ErrNotFound)
		}
	}
	return nil
}

// querySplitVersion reads one immutable version with its allocations in
// stable participant order.
func querySplitVersion(db splitQuerier, splitID string, version int64) (store.Split, error) {
	var split store.Split
	err := db.QueryRow(`SELECT split_id, source_owner_id, source_posting_id, source_revision, initiator_id, currency, total_minor, version, status, created_at, updated_at
		FROM splits WHERE split_id = ? AND version = ?`, splitID, version).Scan(
		&split.ID, &split.SourceOwnerID, &split.SourcePostingID, &split.SourceRevision, &split.InitiatorID,
		&split.Currency, &split.TotalMinor, &split.Version, &split.Status, &split.CreatedAt, &split.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return store.Split{}, store.ErrNotFound
		}
		return store.Split{}, err
	}
	rows, err := db.Query(`SELECT participant_id, amount_minor, accepted, accepted_at FROM split_allocations
		WHERE split_id = ? AND version = ? ORDER BY position`, splitID, version)
	if err != nil {
		return store.Split{}, err
	}
	defer rows.Close()
	split.Allocations = []store.SplitAllocation{}
	for rows.Next() {
		var allocation store.SplitAllocation
		var accepted int
		if err := rows.Scan(&allocation.ParticipantID, &allocation.AmountMinor, &accepted, &allocation.AcceptedAt); err != nil {
			return store.Split{}, err
		}
		allocation.Accepted = accepted == 1
		split.Allocations = append(split.Allocations, allocation)
	}
	return split, rows.Err()
}

// currentSplitVersion resolves the latest version number for one split.
func currentSplitVersion(db splitQuerier, splitID string) (int64, error) {
	var version sql.NullInt64
	if err := db.QueryRow(`SELECT MAX(version) FROM splits WHERE split_id = ?`, splitID).Scan(&version); err != nil {
		return 0, err
	}
	if !version.Valid || version.Int64 == 0 {
		return 0, store.ErrNotFound
	}
	return version.Int64, nil
}

// checkSplitReader enforces participant-scoped reads: the requester must be
// the initiator or a participant of the latest version. Anything else fails
// as not-found so split membership is never enumerable.
func checkSplitReader(split store.Split, requesterID string) error {
	if requesterID == split.InitiatorID {
		return nil
	}
	for _, allocation := range split.Allocations {
		if allocation.ParticipantID == requesterID {
			return nil
		}
	}
	return store.ErrNotFound
}

// insertSplitVersion appends one immutable version row plus its allocations.
func insertSplitVersion(db splitQuerier, split store.Split, allocations []store.SplitAllocation, now int64) error {
	if _, err := db.Exec(`INSERT INTO splits(split_id, version, source_owner_id, source_posting_id, source_revision, initiator_id, currency, total_minor, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		split.ID, split.Version, split.SourceOwnerID, split.SourcePostingID, split.SourceRevision,
		split.InitiatorID, split.Currency, split.TotalMinor, split.Status, split.CreatedAt, now); err != nil {
		return err
	}
	for position, allocation := range allocations {
		accepted := 0
		if allocation.Accepted {
			accepted = 1
		}
		if _, err := db.Exec(`INSERT INTO split_allocations(split_id, version, position, participant_id, amount_minor, accepted, accepted_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			split.ID, split.Version, position, allocation.ParticipantID, allocation.AmountMinor, accepted, allocation.AcceptedAt); err != nil {
			return err
		}
	}
	return nil
}

// replaySplitCreate returns the recorded split for a retried creation key.
// One key creates one split per source posting, so the replay matches on
// action plus source target: a key reused for a different action or target
// fails as a conflict.
func (d *Database) replaySplitCreate(actorID, requestID, ownerID, postingID string) (store.Split, error) {
	recorded, err := lookupSharingRequest(d.db, actorID, requestID)
	if err != nil {
		return store.Split{}, err
	}
	if recorded.Action != store.SharingAuditSplitCreated || recorded.OwnerUserID != ownerID || recorded.PostingID != postingID {
		return store.Split{}, fmt.Errorf("%w: sharing request ID already completed a different action", store.ErrSharingConflict)
	}
	return decodeSharingResult[store.Split](recorded)
}

// replaySplitMutation returns the recorded split for a retried update or
// accept key. The caller's expected version must agree with the recording:
// an update replay must name the recorded version's predecessor, an accept
// replay the recorded version itself. A new attempt reusing a key carries
// a different expectation and fails as a conflict instead of replaying
// stale history.
func (d *Database) replaySplitMutation(actorID, requestID, action, splitID string, expectedVersion int64) (store.Split, error) {
	recorded, err := lookupSharingRequest(d.db, actorID, requestID)
	if err != nil {
		return store.Split{}, err
	}
	version, err := currentSplitVersion(d.db, splitID)
	if err != nil {
		return store.Split{}, err
	}
	current, err := querySplitVersion(d.db, splitID, version)
	if err != nil {
		return store.Split{}, err
	}
	if err := matchSharingRequest(recorded, action, current.SourceOwnerID, current.SourcePostingID, "", "", splitID); err != nil {
		return store.Split{}, err
	}
	split, err := decodeSharingResult[store.Split](recorded)
	if err != nil {
		return store.Split{}, err
	}
	wantVersion := expectedVersion
	if action == store.SharingAuditSplitUpdated {
		wantVersion = expectedVersion + 1
	}
	if split.ID != splitID || split.Version != wantVersion {
		return store.Split{}, fmt.Errorf("%w: sharing request ID already completed a different split revision", store.ErrSharingConflict)
	}
	return split, nil
}

// CreateSplit persists version 1 of a split obligation. Only the initiator
// may create their split, and every participant must hold current source
// access at creation time. Split writes never touch financial rows.
func (d *Database) CreateSplit(actorID string, input store.SplitInput, requestID string) (store.Split, error) {
	if err := checkSharingRequestID(requestID); err != nil {
		return store.Split{}, err
	}
	if !validSharingUserID(actorID) {
		return store.Split{}, fmt.Errorf("%w: actor must be a user ID", store.ErrGroupInvalid)
	}
	allocations, err := checkSplitInput(input)
	if err != nil {
		return store.Split{}, err
	}
	if actorID != input.InitiatorID {
		return store.Split{}, fmt.Errorf("%w: only the initiator may create their split", store.ErrGroupForbidden)
	}
	if _, err := lookupSharingRequest(d.db, actorID, requestID); err == nil {
		return d.replaySplitCreate(actorID, requestID, input.SourceOwnerID, input.SourcePostingID)
	} else if !errors.Is(err, sql.ErrNoRows) {
		return store.Split{}, err
	}
	source, err := d.ReadSharedPosting(input.SourceOwnerID, input.SourcePostingID, actorID)
	if err != nil {
		return store.Split{}, err
	}
	if err := d.authorizeSplitParticipants(input.SourceOwnerID, input.SourcePostingID, input.ParticipantIDs); err != nil {
		return store.Split{}, err
	}
	revision, err := store.SharingSourceRevision(source)
	if err != nil {
		return store.Split{}, fmt.Errorf("record split: %w", err)
	}
	id, err := uuid.NewV7()
	if err != nil {
		return store.Split{}, err
	}
	now := time.Now().Unix()
	split := store.Split{
		ID: id.String(), SourceOwnerID: input.SourceOwnerID, SourcePostingID: input.SourcePostingID,
		SourceRevision: revision, InitiatorID: input.InitiatorID, Currency: strings.ToUpper(strings.TrimSpace(input.Currency)),
		TotalMinor: input.TotalMinor, Version: 1, Status: store.SplitStatusProposed,
		Allocations: allocations, CreatedAt: now, UpdatedAt: now,
	}
	tx, err := d.db.Begin()
	if err != nil {
		return store.Split{}, err
	}
	defer tx.Rollback()
	if err := insertSplitVersion(tx, split, allocations, now); err != nil {
		return store.Split{}, fmt.Errorf("record split: %w", err)
	}
	if err := auditSplitEvent(tx, actorID, split.SourceOwnerID, store.SharingAuditSplitCreated, split.SourcePostingID, split.ID, store.SplitStatusProposed, requestID); err != nil {
		return store.Split{}, err
	}
	if err := recordSharingRequest(tx, actorID, requestID, store.SharingAuditSplitCreated,
		split.SourceOwnerID, split.SourcePostingID, "", "", split.ID, split); err != nil {
		if isUniqueViolation(err) {
			// A concurrent creation with the same key committed first:
			// drop our rows and replay the winner's recording.
			if rerr := tx.Rollback(); rerr != nil {
				return store.Split{}, fmt.Errorf("record split: %v: %w", rerr, err)
			}
			return d.replaySplitCreate(actorID, requestID, input.SourceOwnerID, input.SourcePostingID)
		}
		return store.Split{}, err
	}
	if err := tx.Commit(); err != nil {
		return store.Split{}, err
	}
	return split, nil
}

// UpdateSplit appends a new proposed version. Only the initiator may
// revise, the expected version must be current, and every participant of
// the new version must hold current source access. Acceptances reset: an
// accepted share only changes through this explicit version step.
func (d *Database) UpdateSplit(actorID, splitID string, expectedVersion int64, input store.SplitInput, requestID string) (store.Split, error) {
	if err := checkSharingRequestID(requestID); err != nil {
		return store.Split{}, err
	}
	if !validSharingUserID(actorID) || !validSplitID(splitID) {
		return store.Split{}, fmt.Errorf("%w: actor and split must identify one obligation", store.ErrGroupInvalid)
	}
	allocations, err := checkSplitInput(input)
	if err != nil {
		return store.Split{}, err
	}
	if _, err := lookupSharingRequest(d.db, actorID, requestID); err == nil {
		return d.replaySplitMutation(actorID, requestID, store.SharingAuditSplitUpdated, splitID, expectedVersion)
	} else if !errors.Is(err, sql.ErrNoRows) {
		return store.Split{}, err
	}
	version, err := currentSplitVersion(d.db, splitID)
	if err != nil {
		return store.Split{}, err
	}
	current, err := querySplitVersion(d.db, splitID, version)
	if err != nil {
		return store.Split{}, err
	}
	// Membership before role and revision: strangers learn nothing from
	// version or initiator checks.
	if err := checkSplitReader(current, actorID); err != nil {
		return store.Split{}, err
	}
	if version != expectedVersion {
		return store.Split{}, fmt.Errorf("%w: split changed since it was read; reload before revising", store.ErrSharingConflict)
	}
	if actorID != current.InitiatorID {
		return store.Split{}, fmt.Errorf("%w: only the initiator may revise their split", store.ErrGroupForbidden)
	}
	if input.InitiatorID != current.InitiatorID {
		return store.Split{}, fmt.Errorf("%w: a revision cannot change the split initiator", store.ErrGroupInvalid)
	}
	if input.SourceOwnerID != current.SourceOwnerID || input.SourcePostingID != current.SourcePostingID {
		return store.Split{}, fmt.Errorf("%w: a revision cannot move a split to another transaction", store.ErrGroupInvalid)
	}
	if err := d.authorizeSplitParticipants(input.SourceOwnerID, input.SourcePostingID, input.ParticipantIDs); err != nil {
		return store.Split{}, err
	}
	source, err := d.ReadSharedPosting(input.SourceOwnerID, input.SourcePostingID, actorID)
	if err != nil {
		return store.Split{}, err
	}
	revision, err := store.SharingSourceRevision(source)
	if err != nil {
		return store.Split{}, fmt.Errorf("record split revision: %w", err)
	}
	now := time.Now().Unix()
	next := store.Split{
		ID: splitID, SourceOwnerID: current.SourceOwnerID, SourcePostingID: current.SourcePostingID,
		SourceRevision: revision, InitiatorID: current.InitiatorID, Currency: strings.ToUpper(strings.TrimSpace(input.Currency)),
		TotalMinor: input.TotalMinor, Version: version + 1, Status: store.SplitStatusProposed,
		Allocations: allocations, CreatedAt: current.CreatedAt, UpdatedAt: now,
	}
	tx, err := d.db.Begin()
	if err != nil {
		return store.Split{}, err
	}
	defer tx.Rollback()
	// Authoritative concurrency check inside the transaction: a revision
	// that committed after the pre-check above fails here instead of
	// forking the version sequence.
	latest, err := currentSplitVersion(tx, splitID)
	if err != nil {
		return store.Split{}, err
	}
	if latest != expectedVersion {
		return store.Split{}, fmt.Errorf("%w: split changed since it was read; reload before revising", store.ErrSharingConflict)
	}
	if err := insertSplitVersion(tx, next, allocations, now); err != nil {
		if isUniqueViolation(err) {
			return store.Split{}, fmt.Errorf("%w: split changed since it was read; reload before revising", store.ErrSharingConflict)
		}
		return store.Split{}, fmt.Errorf("record split revision: %w", err)
	}
	if err := auditSplitEvent(tx, actorID, next.SourceOwnerID, store.SharingAuditSplitUpdated, next.SourcePostingID, splitID, store.SplitStatusProposed, requestID); err != nil {
		return store.Split{}, err
	}
	if err := recordSharingRequest(tx, actorID, requestID, store.SharingAuditSplitUpdated,
		next.SourceOwnerID, next.SourcePostingID, "", "", splitID, next); err != nil {
		if isUniqueViolation(err) {
			if rerr := tx.Rollback(); rerr != nil {
				return store.Split{}, fmt.Errorf("record split revision: %v: %w", rerr, err)
			}
			return d.replaySplitMutation(actorID, requestID, store.SharingAuditSplitUpdated, splitID, expectedVersion)
		}
		return store.Split{}, err
	}
	if err := tx.Commit(); err != nil {
		return store.Split{}, err
	}
	return next, nil
}

// AcceptSplit records the actor's own acceptance of the current version.
// The version becomes accepted when every participant has accepted.
// Acceptance writes no financial rows: it moves no money.
func (d *Database) AcceptSplit(actorID, splitID string, expectedVersion int64, requestID string) (store.Split, error) {
	if err := checkSharingRequestID(requestID); err != nil {
		return store.Split{}, err
	}
	if !validSharingUserID(actorID) || !validSplitID(splitID) {
		return store.Split{}, fmt.Errorf("%w: actor and split must identify one obligation", store.ErrGroupInvalid)
	}
	if _, err := lookupSharingRequest(d.db, actorID, requestID); err == nil {
		return d.replaySplitMutation(actorID, requestID, store.SharingAuditSplitAccepted, splitID, expectedVersion)
	} else if !errors.Is(err, sql.ErrNoRows) {
		return store.Split{}, err
	}
	tx, err := d.db.Begin()
	if err != nil {
		return store.Split{}, err
	}
	defer tx.Rollback()
	version, err := currentSplitVersion(tx, splitID)
	if err != nil {
		return store.Split{}, err
	}
	split, err := querySplitVersion(tx, splitID, version)
	if err != nil {
		return store.Split{}, err
	}
	// Membership before revision: strangers learn nothing from the
	// version check.
	if err := checkSplitReader(split, actorID); err != nil {
		return store.Split{}, err
	}
	if version != expectedVersion {
		return store.Split{}, fmt.Errorf("%w: split changed since it was read; reload before accepting", store.ErrSharingConflict)
	}
	var participant int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM split_allocations WHERE split_id = ? AND version = ? AND participant_id = ?`,
		splitID, version, actorID).Scan(&participant); err != nil {
		return store.Split{}, err
	}
	if participant != 1 {
		return store.Split{}, store.ErrNotFound
	}
	now := time.Now().Unix()
	var already int
	if err := tx.QueryRow(`SELECT accepted FROM split_allocations WHERE split_id = ? AND version = ? AND participant_id = ?`,
		splitID, version, actorID).Scan(&already); err != nil {
		return store.Split{}, err
	}
	if already != 1 {
		if _, err := tx.Exec(`UPDATE split_allocations SET accepted = 1, accepted_at = ? WHERE split_id = ? AND version = ? AND participant_id = ?`,
			now, splitID, version, actorID); err != nil {
			return store.Split{}, fmt.Errorf("record split acceptance: %w", err)
		}
	}
	var pending int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM split_allocations WHERE split_id = ? AND version = ? AND accepted = 0`,
		splitID, version).Scan(&pending); err != nil {
		return store.Split{}, err
	}
	status := store.SplitStatusProposed
	if pending == 0 {
		status = store.SplitStatusAccepted
		if _, err := tx.Exec(`UPDATE splits SET status = 'accepted', updated_at = ? WHERE split_id = ? AND version = ?`,
			now, splitID, version); err != nil {
			return store.Split{}, fmt.Errorf("record split acceptance: %w", err)
		}
	}
	split, err = querySplitVersion(tx, splitID, version)
	if err != nil {
		return store.Split{}, err
	}
	if already == 1 {
		// Idempotent accept: the participant already accepted this
		// version, so no audit row. The outcome key alone records that
		// this request completed with the current version.
		if err := recordSharingRequest(tx, actorID, requestID, store.SharingAuditSplitAccepted,
			split.SourceOwnerID, split.SourcePostingID, "", "", splitID, split); err != nil {
			if isUniqueViolation(err) {
				if rerr := tx.Rollback(); rerr != nil {
					return store.Split{}, fmt.Errorf("record split acceptance: %v: %w", rerr, err)
				}
				return d.replaySplitMutation(actorID, requestID, store.SharingAuditSplitAccepted, splitID, expectedVersion)
			}
			return store.Split{}, err
		}
		return split, tx.Commit()
	}
	if err := auditSplitEvent(tx, actorID, split.SourceOwnerID, store.SharingAuditSplitAccepted, split.SourcePostingID, splitID, status, requestID); err != nil {
		return store.Split{}, err
	}
	if err := recordSharingRequest(tx, actorID, requestID, store.SharingAuditSplitAccepted,
		split.SourceOwnerID, split.SourcePostingID, "", "", splitID, split); err != nil {
		if isUniqueViolation(err) {
			if rerr := tx.Rollback(); rerr != nil {
				return store.Split{}, fmt.Errorf("record split acceptance: %v: %w", rerr, err)
			}
			return d.replaySplitMutation(actorID, requestID, store.SharingAuditSplitAccepted, splitID, expectedVersion)
		}
		return store.Split{}, err
	}
	if err := tx.Commit(); err != nil {
		return store.Split{}, err
	}
	return split, nil
}

// GetSplit returns the latest version of one split for its initiator or
// participants. The split survives source edits, revocation, and source
// deletion: reads perform no live source check.
func (d *Database) GetSplit(requesterID, splitID string) (store.Split, error) {
	if !validSharingUserID(requesterID) || !validSplitID(splitID) {
		return store.Split{}, fmt.Errorf("%w: requester and split must identify one obligation", store.ErrGroupInvalid)
	}
	version, err := currentSplitVersion(d.db, splitID)
	if err != nil {
		return store.Split{}, err
	}
	split, err := querySplitVersion(d.db, splitID, version)
	if err != nil {
		return store.Split{}, err
	}
	if err := checkSplitReader(split, requesterID); err != nil {
		return store.Split{}, err
	}
	return split, nil
}

// ListSplits returns the latest version of every split the requester
// initiated or participates in, in stable order.
func (d *Database) ListSplits(requesterID string) ([]store.Split, error) {
	if !validSharingUserID(requesterID) {
		return nil, fmt.Errorf("%w: requester must be a user ID", store.ErrGroupInvalid)
	}
	rows, err := d.db.Query(`SELECT s.split_id, s.version FROM splits s
		WHERE s.version = (SELECT MAX(version) FROM splits s2 WHERE s2.split_id = s.split_id)
		AND (s.initiator_id = ? OR EXISTS (SELECT 1 FROM split_allocations a
			WHERE a.split_id = s.split_id AND a.version = s.version AND a.participant_id = ?))
		ORDER BY s.updated_at, s.split_id`, requesterID, requesterID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type ref struct {
		id      string
		version int64
	}
	refs := []ref{}
	for rows.Next() {
		var r ref
		if err := rows.Scan(&r.id, &r.version); err != nil {
			return nil, err
		}
		refs = append(refs, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	splits := []store.Split{}
	for _, r := range refs {
		split, err := querySplitVersion(d.db, r.id, r.version)
		if err != nil {
			return nil, err
		}
		splits = append(splits, split)
	}
	return splits, nil
}

// ListSplitVersions returns every version of one split in ascending order:
// the immutable accepted history plus superseded proposals.
func (d *Database) ListSplitVersions(requesterID, splitID string) ([]store.Split, error) {
	latest, err := d.GetSplit(requesterID, splitID)
	if err != nil {
		return nil, err
	}
	versions := []store.Split{}
	for version := int64(1); version <= latest.Version; version++ {
		split, err := querySplitVersion(d.db, splitID, version)
		if err != nil {
			return nil, err
		}
		versions = append(versions, split)
	}
	return versions, nil
}

// clearSplitsForUser removes every split touching the cleared scope: splits
// sourced, initiated, or participated in by the user go whole, all
// versions, so a cleared scope restarts with no dangling obligations.
// Request keys the user executed and audit events they touched go through
// the shared social clear path alongside grants and links.
func clearSplitsForUser(tx *userTx) error {
	if _, err := tx.Exec(`DELETE FROM splits WHERE source_owner_id = :user_id OR initiator_id = :user_id
		OR split_id IN (SELECT split_id FROM split_allocations WHERE participant_id = :user_id)`); err != nil {
		return fmt.Errorf("clear splits: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM split_allocations WHERE split_id NOT IN (SELECT split_id FROM splits)`); err != nil {
		return fmt.Errorf("clear split allocations: %w", err)
	}
	return nil
}

// splitAuditDetail carries the split link, resulting status, and request
// key inside the consent audit's detail payload. Split rows reuse the
// landed sharing_audit shape (owner scope, kind, detail JSON) instead of
// a parallel audit table.
type splitAuditDetail struct {
	Link      string `json:"link"`
	Status    string `json:"status"`
	RequestID string `json:"requestId"`
}

func auditSplitEvent(tx *sql.Tx, actorID, ownerID, action, postingID, splitID, status, requestID string) error {
	detail, err := json.Marshal(splitAuditDetail{Link: splitID, Status: status, RequestID: requestID})
	if err != nil {
		return err
	}
	return auditSharingRaw(tx, ownerID, actorID, action, postingID, "", "", "", string(detail))
}

// ListSharingAudit returns the committed cross-user changes for one
// owner-scoped posting in sequence order, including split-created,
// split-updated, and split-accepted rows. Audit reads are owner-scoped
// like grant lists. Split link, status, and request-key fields decode
// from the audit detail payload; other actions leave them empty.
func (d *Database) ListSharingAudit(ownerID, postingID string) ([]store.SharingAuditEvent, error) {
	if !validSharingUserID(ownerID) || !validSharingPostingID(postingID) {
		return nil, fmt.Errorf("%w: owner and posting must identify one transaction", store.ErrGroupInvalid)
	}
	rows, err := d.db.Query(`SELECT id, actor_user_id, kind, owner_user_id, posting_id, group_id, detail_json, created_at FROM sharing_audit WHERE owner_user_id = ? AND posting_id = ? ORDER BY id`,
		ownerID, postingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []store.SharingAuditEvent{}
	for rows.Next() {
		var event store.SharingAuditEvent
		var groupID, detail string
		if err := rows.Scan(&event.Seq, &event.ActorUserID, &event.Action, &event.OwnerUserID, &event.PostingID,
			&groupID, &detail, &event.CreatedAt); err != nil {
			return nil, err
		}
		var decoded splitAuditDetail
		if err := json.Unmarshal([]byte(detail), &decoded); err == nil {
			event.LinkID, event.Status, event.RequestID = decoded.Link, decoded.Status, decoded.RequestID
		}
		events = append(events, event)
	}
	return events, rows.Err()
}
