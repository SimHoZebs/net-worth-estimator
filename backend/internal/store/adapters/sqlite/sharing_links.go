// Stable linked-transaction representation (FND-04). Links bind one
// source-owner posting to one recipient-owned private copy through
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

const sharingLinkSelect = `c.link_id, c.source_owner_id, c.source_posting_id, c.source_revision, c.recipient_user_id, c.copy_posting_id, c.grant_audience_type, c.grant_audience_id, c.grant_reason, c.copied_at, c.refreshed_at`

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
	if err := rows.Scan(&link.LinkID, &link.SourceOwnerID, &link.SourcePostingID, &link.SourceRevision,
		&link.RecipientUserID, &link.CopyPostingID, &link.GrantAudience, &link.GrantAudienceID,
		&link.GrantReason, &link.CopiedAt, &link.RefreshedAt); err != nil {
		return store.SharingLink{}, err
	}
	// The stored link ID must equal the deterministic derivation: a
	// mismatch means the provenance row is corrupt, and dependents
	// resolving links without a lookup would address a different link.
	// The error carries no identities so a corrupt row is never enumerable.
	if link.LinkID != store.SharingLinkID(link.SourceOwnerID, link.SourcePostingID, link.RecipientUserID) {
		return store.SharingLink{}, fmt.Errorf("sharing link identity mismatch")
	}
	return link, nil
}

// querySharingLink resolves one recipient-scoped link. The join requires
// the copy row to still exist: a link without its copy is not resolvable.
// Missing and foreign links both report ErrNotFound so link memory is not
// enumerable across users.
func (d *Database) querySharingLink(where string, args ...any) (store.SharingLink, error) {
	rows, err := d.db.Query(`SELECT `+sharingLinkSelect+` FROM sharing_copies c JOIN postings p ON p.user_id = c.recipient_user_id AND p.id = c.copy_posting_id `+where,
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
func (d *Database) GetSharingLink(recipientID, copyPostingID string) (store.SharingLink, error) {
	if !validSharingUserID(recipientID) || !validSharingPostingID(copyPostingID) {
		return store.SharingLink{}, store.ErrNotFound
	}
	return d.querySharingLink(`WHERE c.recipient_user_id = ? AND c.copy_posting_id = ?`, recipientID, copyPostingID)
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
func (d *Database) findSharingCopy(ownerID, postingID, requesterID string) (types.Posting, bool, error) {
	var copyID string
	err := d.db.QueryRow(`SELECT copy_posting_id FROM sharing_copies WHERE recipient_user_id = ? AND source_owner_id = ? AND source_posting_id = ?`,
		requesterID, ownerID, postingID).Scan(&copyID)
	if errors.Is(err, sql.ErrNoRows) {
		return types.Posting{}, false, nil
	}
	if err != nil {
		return types.Posting{}, false, err
	}
	rows, err := d.db.Query(`SELECT `+postingSelect+` `+postingJoins+` WHERE p.user_id = ? AND p.id = ?`, requesterID, copyID)
	if err != nil {
		return types.Posting{}, false, err
	}
	defer rows.Close()
	if !rows.Next() {
		// Stale provenance: close the exhausted rows before the nested
		// cleanup write (single-connection store).
		rows.Close()
		if _, derr := d.db.Exec(`DELETE FROM sharing_copies WHERE recipient_user_id = ? AND copy_posting_id = ?`, requesterID, copyID); derr != nil {
			return types.Posting{}, false, derr
		}
		return types.Posting{}, false, nil
	}
	posting, err := scanPostingRow(rows)
	if err != nil {
		return types.Posting{}, false, err
	}
	return posting, true, rows.Err()
}

// sharingLinkGrant names the concrete surviving grant for one authorized
// source-plus-recipient triple, following the CheckSharedPostingAccess
// allow/deny order: the owner's own row, then a direct user grant, then a
// group grant where both requester and source owner hold current
// membership. When several group grants survive, the recorded one is the
// lowest group ID (deterministic, not an authorization decision).
// Callers invoke it only after an allow decision; a fallthrough means
// consent changed mid-flight and fails closed with an error so no link
// records an unauthorized grant.
func (d *Database) sharingLinkGrant(ownerID, postingID, requesterID string) (string, string, string, error) {
	if requesterID == ownerID {
		return store.SharingAudienceUser, ownerID, "owner", nil
	}
	var direct int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = 'user' AND audience_id = ? AND intent = 'shared'`,
		ownerID, postingID, requesterID).Scan(&direct); err != nil {
		return "", "", "", err
	}
	if direct > 0 {
		return store.SharingAudienceUser, requesterID, "manual-user", nil
	}
	rows, err := d.db.Query(`SELECT audience_id FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = 'group' AND intent = 'shared' ORDER BY audience_id`,
		ownerID, postingID)
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
// It never writes the postings table: the recipient's copy and its edits
// survive every outcome, and an unauthorized refresh exposes no source
// content (not even the current revision).
func (d *Database) RefreshSharingLink(recipientID, copyPostingID string) (store.SharingLinkRefresh, error) {
	link, err := d.GetSharingLink(recipientID, copyPostingID)
	if err != nil {
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
	var present int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM postings WHERE user_id = ? AND id = ?`, link.SourceOwnerID, link.SourcePostingID).Scan(&present); err != nil {
		return store.SharingLinkRefresh{}, err
	}
	if present != 1 {
		// The source row is gone. The link keeps its last recorded
		// revision and the copy stays intact as an ordinary row.
		if err := touch(); err != nil {
			return store.SharingLinkRefresh{}, err
		}
		return store.SharingLinkRefresh{Link: link, Status: store.SharingLinkSourceGone}, nil
	}
	access, err := d.CheckSharedPostingAccess(link.SourceOwnerID, link.SourcePostingID, recipientID)
	if err != nil {
		return store.SharingLinkRefresh{}, err
	}
	if !access.Allowed {
		// Revoked, excluded, or membership ended. The copy and its edits
		// stay intact; source changes are no longer visible.
		if err := touch(); err != nil {
			return store.SharingLinkRefresh{}, err
		}
		return store.SharingLinkRefresh{Link: link, Status: store.SharingLinkUnauthorized}, nil
	}
	source, err := d.ReadSharedPosting(link.SourceOwnerID, link.SourcePostingID, recipientID)
	if err != nil {
		return store.SharingLinkRefresh{}, err
	}
	revision, err := store.SharingSourceRevision(source)
	if err != nil {
		return store.SharingLinkRefresh{}, err
	}
	audienceType, audienceID, reason, err := d.sharingLinkGrant(link.SourceOwnerID, link.SourcePostingID, recipientID)
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
	return store.SharingLinkRefresh{Link: link, Status: status, CurrentSourceRevision: revision}, nil
}
