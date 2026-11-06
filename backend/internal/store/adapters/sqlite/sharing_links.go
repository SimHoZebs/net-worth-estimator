// Stable linked-transaction representation (FND-04). Links bind one
// source-owner transaction to one recipient-owned private copy through
// immutable identities recorded in sharing_copies: the source transaction
// ID, the deterministic link ID, the source revision observed at the last
// authorized copy or refresh, the recipient owner, and the authorizing
// sharing-grant identifiers. Refresh re-checks live authorization and
// source state and records the outcome on the link row; it never writes
// the recipient's copy, so recipient edits survive refresh, revocation,
// and source deletion alike. Reads here reuse the existing transaction
// shape only: there is no cross-user DTO and no column-level ACL.
package sqlite

import (
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const sharingLinkSelect = `c.link_id, c.source_owner_id, c.source_transaction_id, c.source_revision, c.recipient_user_id, c.copy_transaction_id, c.grant_audience_type, c.grant_audience_id, c.grant_reason, c.copied_at, c.refreshed_at`

func validSharingLinkID(id string) bool {
	if !strings.HasPrefix(id, "link_") {
		return false
	}
	raw := strings.TrimPrefix(id, "link_")
	decoded, err := hex.DecodeString(raw)
	return err == nil && len(decoded) == 32 && hex.EncodeToString(decoded) == raw
}

func scanSharingLinkRow(rows *sql.Rows) (store.SharingLink, error) {
	var link store.SharingLink
	if err := rows.Scan(&link.LinkID, &link.SourceOwnerID, &link.SourceTransactionID, &link.SourceRevision,
		&link.RecipientUserID, &link.CopyTransactionID, &link.GrantAudience, &link.GrantAudienceID,
		&link.GrantReason, &link.CopiedAt, &link.RefreshedAt); err != nil {
		return store.SharingLink{}, err
	}
	// The stored link ID must equal the deterministic derivation: a
	// mismatch means the provenance row is corrupt, and dependents
	// resolving links without a lookup would address a different link.
	// The error carries no identities so a corrupt row is never enumerable.
	if link.LinkID != store.SharingLinkID(link.SourceOwnerID, link.SourceTransactionID, link.RecipientUserID) {
		return store.SharingLink{}, fmt.Errorf("sharing link identity mismatch")
	}
	return link, nil
}

// querySharingLink resolves one recipient-scoped link. The join requires
// the copy row to still exist: a link without its copy is not resolvable.
// Missing and foreign links both report ErrNotFound so link memory is not
// enumerable across users.
func (d *Database) querySharingLink(where string, args ...any) (store.SharingLink, error) {
	rows, err := d.db.Query(`SELECT `+sharingLinkSelect+` FROM sharing_copies c JOIN transactions p ON p.user_id = c.recipient_user_id AND p.id = c.copy_transaction_id `+where,
		args...)
	if err != nil {
		return store.SharingLink{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return store.SharingLink{}, store.ErrNotFound
	}
	link, err := scanSharingLinkRow(rows)
	if err != nil {
		return store.SharingLink{}, err
	}
	return link, rows.Err()
}

// GetSharingLink resolves the stable link for one of the recipient's own
// copies. It performs no source authorization check: the link is the
// recipient's own provenance.
func (d *Database) GetSharingLink(recipientID, copyTransactionID string) (store.SharingLink, error) {
	if !validSharingUserID(recipientID) || !validSharingTransactionID(copyTransactionID) {
		return store.SharingLink{}, store.ErrNotFound
	}
	return d.querySharingLink(`WHERE c.recipient_user_id = ? AND c.copy_transaction_id = ?`, recipientID, copyTransactionID)
}

// GetSharingLinkByID resolves one of the recipient's links by its stable
// link ID, for callers that hold links (group feeds, splits, audit)
// rather than copy row IDs.
func (d *Database) GetSharingLinkByID(linkID, recipientID string) (store.SharingLink, error) {
	if !validSharingLinkID(linkID) || !validSharingUserID(recipientID) {
		return store.SharingLink{}, store.ErrNotFound
	}
	return d.querySharingLink(`WHERE c.link_id = ? AND c.recipient_user_id = ?`, linkID, recipientID)
}

// findSharingCopy returns the recipient's existing copy for one
// source-plus-recipient triple. Stale provenance whose copy row is gone
// is dropped so a later accept mints a fresh copy under the same link.
func (d *Database) findSharingCopy(ownerID, transactionID, requesterID string) (types.Transaction, bool, error) {
	var copyID string
	err := d.db.QueryRow(`SELECT copy_transaction_id FROM sharing_copies WHERE recipient_user_id = ? AND source_owner_id = ? AND source_transaction_id = ?`,
		requesterID, ownerID, transactionID).Scan(&copyID)
	if errors.Is(err, sql.ErrNoRows) {
		return types.Transaction{}, false, nil
	}
	if err != nil {
		return types.Transaction{}, false, err
	}
	rows, err := d.db.Query(`SELECT `+transactionSelect+` `+transactionJoins+` WHERE p.user_id = ? AND p.id = ?`, requesterID, copyID)
	if err != nil {
		return types.Transaction{}, false, err
	}
	defer rows.Close()
	if !rows.Next() {
		// Stale provenance: close the exhausted rows before the nested
		// cleanup write (single-connection store).
		rows.Close()
		if _, derr := d.db.Exec(`DELETE FROM sharing_copies WHERE recipient_user_id = ? AND copy_transaction_id = ?`, requesterID, copyID); derr != nil {
			return types.Transaction{}, false, derr
		}
		return types.Transaction{}, false, nil
	}
	transaction, err := scanTransactionRow(rows)
	if err != nil {
		return types.Transaction{}, false, err
	}
	return transaction, true, rows.Err()
}

// sharingLinkGrant names the concrete surviving grant for one authorized
// source-plus-recipient triple, following the CheckSharedTransactionAccess
// allow/deny order: the owner's own row, then a direct user grant, then a
// group grant where both requester and source owner hold current
// membership. When several group grants survive, the recorded one is the
// lowest group ID (deterministic, not an authorization decision).
// Callers invoke it only after an allow decision; a fallthrough means
// consent changed mid-flight and fails closed with an error so no link
// records an unauthorized grant.
func (d *Database) sharingLinkGrant(ownerID, transactionID, requesterID string) (string, string, string, error) {
	if requesterID == ownerID {
		return store.SharingAudienceUser, ownerID, "owner", nil
	}
	var direct int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM sharing_grants WHERE owner_user_id = ? AND transaction_id = ? AND audience_type = 'user' AND audience_id = ? AND intent = 'shared'`,
		ownerID, transactionID, requesterID).Scan(&direct); err != nil {
		return "", "", "", err
	}
	if direct > 0 {
		return store.SharingAudienceUser, requesterID, "manual-user", nil
	}
	rows, err := d.db.Query(`SELECT audience_id FROM sharing_grants WHERE owner_user_id = ? AND transaction_id = ? AND audience_type = 'group' AND intent = 'shared' ORDER BY audience_id`,
		ownerID, transactionID)
	if err != nil {
		return "", "", "", err
	}
	groups := []string{}
	for rows.Next() {
		var groupID string
		if err := rows.Scan(&groupID); err != nil {
			rows.Close()
			return "", "", "", err
		}
		groups = append(groups, groupID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", "", "", err
	}
	// Membership is resolved only after the grant rows are consumed and
	// closed: the store holds a single connection, so a nested query
	// inside the rows loop would deadlock.
	for _, groupID := range groups {
		requesterRole, err := d.groupRole(groupID, requesterID)
		if err != nil {
			return "", "", "", err
		}
		if requesterRole == "" {
			continue
		}
		ownerRole, err := d.groupRole(groupID, ownerID)
		if err != nil {
			return "", "", "", err
		}
		if ownerRole == "" {
			continue
		}
		return store.SharingAudienceGroup, groupID, "manual-group", nil
	}
	return "", "", "", fmt.Errorf("resolve sharing grant: no surviving grant for this copy")
}

// RefreshSharingLink re-checks one of the recipient's links against live
// authorization and source state and records the outcome on the link row.
// It never writes the transactions table: the recipient's copy and its edits
// survive every outcome, and an unauthorized refresh exposes no source
// content (not even the current revision). requestID is a client UUID: a
// retry replays the recorded outcome. The link update commits before the
// outcome key, so an interrupted refresh retries as a new execution
// converging to current rather than replaying an unapplied outcome.
func (d *Database) RefreshSharingLink(recipientID, copyTransactionID, requestID string) (store.SharingLinkRefresh, error) {
	if err := checkSharingRequestID(requestID); err != nil {
		return store.SharingLinkRefresh{}, err
	}
	link, err := d.GetSharingLink(recipientID, copyTransactionID)
	if err != nil {
		return store.SharingLinkRefresh{}, err
	}
	if recorded, err := lookupSharingRequest(d.db, recipientID, requestID); err == nil {
		if err := matchSharingRequest(recorded, store.SharingAuditLinkRefreshed, link.SourceOwnerID, link.SourceTransactionID, "", "", link.LinkID); err != nil {
			return store.SharingLinkRefresh{}, err
		}
		return decodeSharingResult[store.SharingLinkRefresh](recorded)
	} else if !errors.Is(err, sql.ErrNoRows) {
		return store.SharingLinkRefresh{}, err
	}
	now := time.Now().Unix()
	touch := func() error {
		if _, err := d.db.Exec(`UPDATE sharing_copies SET refreshed_at = ? WHERE link_id = ?`, now, link.LinkID); err != nil {
			return err
		}
		link.RefreshedAt = now
		return nil
	}
	// finish records the committed outcome: one audit row for the
	// mutation plus the idempotency key, in one short transaction so a
	// concurrent same-key refresh cannot double-audit. A key collision
	// means a concurrent same-key refresh committed first, so its outcome
	// wins: our audit row rolls back and the winner replays. The rollback
	// precedes the replay read: the store holds one connection, so reading
	// while our transaction stands open would deadlock on our own lock.
	finish := func(outcome store.SharingLinkRefresh) (store.SharingLinkRefresh, error) {
		tx, err := d.db.Begin()
		if err != nil {
			return store.SharingLinkRefresh{}, err
		}
		defer tx.Rollback()
		if err := auditShareEvent(tx, link.SourceOwnerID, recipientID, store.SharingAuditLinkRefreshed,
			link.SourceTransactionID, "", "", link.LinkID, outcome.Status, requestID); err != nil {
			return store.SharingLinkRefresh{}, err
		}
		if err := recordSharingRequest(tx, recipientID, requestID, store.SharingAuditLinkRefreshed, link.SourceOwnerID, link.SourceTransactionID, "", "", link.LinkID, outcome); err != nil {
			_ = tx.Rollback()
			if isUniqueViolation(err) {
				return d.replaySharingRefresh(recipientID, requestID, link)
			}
			return store.SharingLinkRefresh{}, err
		}
		return outcome, tx.Commit()
	}
	var present int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM transactions WHERE user_id = ? AND id = ?`, link.SourceOwnerID, link.SourceTransactionID).Scan(&present); err != nil {
		return store.SharingLinkRefresh{}, err
	}
	if present != 1 {
		// The source row is gone. The link keeps its last recorded
		// revision and the copy stays intact as an ordinary row.
		if err := touch(); err != nil {
			return store.SharingLinkRefresh{}, err
		}
		return finish(store.SharingLinkRefresh{Link: link, Status: store.SharingLinkSourceGone})
	}
	access, err := d.CheckSharedTransactionAccess(link.SourceOwnerID, link.SourceTransactionID, recipientID)
	if err != nil {
		return store.SharingLinkRefresh{}, err
	}
	if !access.Allowed {
		// Revoked, excluded, or membership ended. The copy and its edits
		// stay intact; source changes are no longer visible.
		if err := touch(); err != nil {
			return store.SharingLinkRefresh{}, err
		}
		return finish(store.SharingLinkRefresh{Link: link, Status: store.SharingLinkUnauthorized})
	}
	source, err := d.ReadSharedTransaction(link.SourceOwnerID, link.SourceTransactionID, recipientID)
	if err != nil {
		return store.SharingLinkRefresh{}, err
	}
	revision, err := store.SharingSourceRevision(source)
	if err != nil {
		return store.SharingLinkRefresh{}, err
	}
	audienceType, audienceID, reason, err := d.sharingLinkGrant(link.SourceOwnerID, link.SourceTransactionID, recipientID)
	if err != nil {
		return store.SharingLinkRefresh{}, err
	}
	status := store.SharingLinkCurrent
	if revision != link.SourceRevision {
		status = store.SharingLinkSourceChange
	}
	if _, err := d.db.Exec(`UPDATE sharing_copies SET source_revision = ?, grant_audience_type = ?, grant_audience_id = ?, grant_reason = ?, refreshed_at = ? WHERE link_id = ?`,
		revision, audienceType, audienceID, reason, now, link.LinkID); err != nil {
		return store.SharingLinkRefresh{}, err
	}
	link.SourceRevision = revision
	link.GrantAudience = audienceType
	link.GrantAudienceID = audienceID
	link.GrantReason = reason
	link.RefreshedAt = now
	return finish(store.SharingLinkRefresh{Link: link, Status: status, CurrentSourceRevision: revision})
}

// replaySharingRefresh re-reads a just-committed same-key outcome after a
// key collision: a concurrent refresh with the same key committed first.
func (d *Database) replaySharingRefresh(recipientID, requestID string, link store.SharingLink) (store.SharingLinkRefresh, error) {
	recorded, err := lookupSharingRequest(d.db, recipientID, requestID)
	if err != nil {
		return store.SharingLinkRefresh{}, err
	}
	if err := matchSharingRequest(recorded, store.SharingAuditLinkRefreshed, link.SourceOwnerID, link.SourceTransactionID, "", "", link.LinkID); err != nil {
		return store.SharingLinkRefresh{}, err
	}
	return decodeSharingResult[store.SharingLinkRefresh](recorded)
}
