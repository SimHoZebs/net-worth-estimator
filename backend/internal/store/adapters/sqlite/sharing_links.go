// Recipient copy provenance for accept idempotency. One row binds the
// immutable tuple of recipient, source owner, source transaction, and
// recipient-owned copy transaction, so repeat accepts return the existing
// row with its edits intact instead of minting duplicates. The copy itself
// is an ordinary transaction in the recipient's model and is never rewritten
// by later consent changes. Reads here reuse the existing transaction shape
// only: there is no cross-user DTO and no column-level ACL.
package sqlite

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

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
