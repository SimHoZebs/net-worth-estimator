// Cross-user transaction authorization (FND-02). Grants and exclusions are
// explicit owner decisions naming one owner-scoped posting and one
// audience. Reads re-evaluate current membership, exclusion, and
// revocation rows on every call: there is no positive auth cache and no
// materialized visibility index shortcut (an index row is never final
// authorization; GRP-05 re-validates here).
package sqlite

import (
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// sharingSchemaStatements creates explicit cross-user consent rows. One row
// is one explicit intent for one posting plus one audience: default intent
// is the row's absence, and explicit share and exclusion cannot coexist
// for the same audience because they share the primary key.
func sharingSchemaStatements() []string {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS sharing_grants (
			owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			posting_id TEXT NOT NULL,
			audience_type TEXT NOT NULL CHECK (audience_type IN ('user', 'group', 'all')),
			audience_id TEXT NOT NULL DEFAULT '',
			intent TEXT NOT NULL CHECK (intent IN ('shared', 'excluded')),
			created_at INTEGER NOT NULL,
			PRIMARY KEY (owner_user_id, posting_id, audience_type, audience_id),
			CHECK ((audience_type = 'all' AND audience_id = '' AND intent = 'excluded') OR (audience_type IN ('user', 'group') AND audience_id <> ''))
		)`,
		`CREATE INDEX IF NOT EXISTS sharing_grants_grantee ON sharing_grants(audience_type, audience_id, intent)`,
		// sharing_copies records provenance plus the stable linked-transaction
		// representation (FND-04) for recipient-owned copies. The copy itself
		// is an ordinary posting in the recipient's model: revocation never
		// rewrites or erases it. One row binds the immutable identities of a
		// link: the source transaction (source_owner_id, source_posting_id),
		// the stable link_id, the source_revision observed at the last
		// authorized copy or refresh, the recipient owner (recipient_user_id,
		// copy_posting_id), and the authorizing sharing-grant identifiers
		// (grant audience type/id plus the access reason).
		`CREATE TABLE IF NOT EXISTS sharing_copies (
			recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			copy_posting_id TEXT NOT NULL,
			source_owner_id TEXT NOT NULL,
			source_posting_id TEXT NOT NULL,
			link_id TEXT NOT NULL,
			source_revision TEXT NOT NULL DEFAULT '',
			grant_audience_type TEXT NOT NULL DEFAULT '',
			grant_audience_id TEXT NOT NULL DEFAULT '',
			grant_reason TEXT NOT NULL DEFAULT '',
			copied_at INTEGER NOT NULL,
			refreshed_at INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (recipient_user_id, copy_posting_id),
			UNIQUE (link_id)
		)`,
		`CREATE INDEX IF NOT EXISTS sharing_copies_source ON sharing_copies(source_owner_id, source_posting_id)`,
	}
	// The visibility index and audit log ship with the consent schema so
	// fresh and migrated databases gain them together.
	statements = append(statements, sharingPolicySchemaStatements()...)
	statements = append(statements, sharingVisibilitySchemaStatements()...)
	return append(statements, sharingAuditSchemaStatements()...)
}

func validSharingUserID(id string) bool {
	if !strings.HasPrefix(id, "user:") {
		return false
	}
	raw := strings.TrimPrefix(id, "user:")
	decoded, err := hex.DecodeString(raw)
	return err == nil && len(decoded) == 32 && hex.EncodeToString(decoded) == raw
}

func validSharingPostingID(id string) bool {
	parsed, err := uuid.Parse(id)
	return err == nil && parsed.String() == id
}

func validSharingGroupID(id string) bool {
	_, err := uuid.Parse(id)
	return err == nil
}

// checkSharingAudience validates audience shape. Wildcard ("all") is an
// exclusion-only audience with no ID.
func checkSharingAudience(audienceType, audienceID string, forExclude bool) error {
	switch audienceType {
	case store.SharingAudienceUser:
		if !validSharingUserID(audienceID) {
			return fmt.Errorf("%w: user audience must be a user ID", store.ErrGroupInvalid)
		}
	case store.SharingAudienceGroup:
		if !validSharingGroupID(audienceID) {
			return fmt.Errorf("%w: group audience must be a group ID", store.ErrGroupInvalid)
		}
	case store.SharingAudienceAll:
		if !forExclude {
			return fmt.Errorf("%w: wildcard audience is exclusion-only", store.ErrGroupInvalid)
		}
		if audienceID != "" {
			return fmt.Errorf("%w: wildcard exclusion carries no audience ID", store.ErrGroupInvalid)
		}
	default:
		return fmt.Errorf("%w: unknown audience", store.ErrGroupInvalid)
	}
	return nil
}

func sharingGrantScan(rows *sql.Rows) (store.SharingGrant, error) {
	var grant store.SharingGrant
	if err := rows.Scan(&grant.OwnerUserID, &grant.PostingID, &grant.Audience, &grant.AudienceID, &grant.Intent, &grant.CreatedAt); err != nil {
		return store.SharingGrant{}, err
	}
	return grant, nil
}

// excludedGroupIDs lists groups carrying an explicit exclusion for one
// posting. Callers deny current members of each.
func excludedGroupIDs(db *sql.DB, ownerID, postingID string) ([]string, error) {
	rows, err := db.Query(`SELECT audience_id FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = 'group' AND intent = 'excluded'`, ownerID, postingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var groups []string
	for rows.Next() {
		var groupID string
		if err := rows.Scan(&groupID); err != nil {
			return nil, err
		}
		groups = append(groups, groupID)
	}
	return groups, rows.Err()
}

// requireSharingAudienceExists rejects well-formed but unknown audiences so
// typos fail closed instead of parking dangling consent. User audiences
// must be provisioned users; group audiences must be existing groups.
func requireSharingAudienceExists(tx *sql.Tx, audienceType, audienceID string) error {
	switch audienceType {
	case store.SharingAudienceUser:
		var users int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, audienceID).Scan(&users); err != nil {
			return err
		}
		if users != 1 {
			return store.ErrNotFound
		}
	case store.SharingAudienceGroup:
		var groups int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM user_groups WHERE id = ?`, audienceID).Scan(&groups); err != nil {
			return err
		}
		if groups != 1 {
			return store.ErrNotFound
		}
	}
	return nil
}

// GrantSharedPosting records the owner's explicit share decision. The grant
// and the conflicting-exclusion guard run in one transaction. requestID is
// a client UUID: retries replay the recorded grant, and a reused key for a
// different action fails as a conflict. Only committed grants append audit.
func (d *Database) GrantSharedPosting(ownerID, postingID, audienceType, audienceID, requestID string) (store.SharingGrant, error) {
	if !validSharingUserID(ownerID) || !validSharingPostingID(postingID) {
		return store.SharingGrant{}, fmt.Errorf("%w: owner and posting must identify one transaction", store.ErrGroupInvalid)
	}
	if err := checkSharingRequestID(requestID); err != nil {
		return store.SharingGrant{}, err
	}
	if err := checkSharingAudience(audienceType, audienceID, false); err != nil {
		return store.SharingGrant{}, err
	}
	tx, err := d.db.Begin()
	if err != nil {
		return store.SharingGrant{}, err
	}
	defer tx.Rollback()
	if recorded, err := lookupSharingRequest(tx, ownerID, requestID); err == nil {
		if err := matchSharingRequest(recorded, "grant", ownerID, postingID, audienceType, audienceID, ""); err != nil {
			return store.SharingGrant{}, err
		}
		grant, err := decodeSharingResult[store.SharingGrant](recorded)
		if err != nil {
			return store.SharingGrant{}, err
		}
		return grant, tx.Commit()
	} else if err != sql.ErrNoRows {
		return store.SharingGrant{}, err
	}
	var users int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, ownerID).Scan(&users); err != nil {
		return store.SharingGrant{}, err
	}
	if users != 1 {
		return store.SharingGrant{}, store.ErrNotFound
	}
	var postings int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM postings WHERE user_id = ? AND id = ?`, ownerID, postingID).Scan(&postings); err != nil {
		return store.SharingGrant{}, err
	}
	if postings != 1 {
		return store.SharingGrant{}, store.ErrNotFound
	}
	if err := requireSharingAudienceExists(tx, audienceType, audienceID); err != nil {
		return store.SharingGrant{}, err
	}
	var intent string
	err = tx.QueryRow(`SELECT intent FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = ? AND audience_id = ?`,
		ownerID, postingID, audienceType, audienceID).Scan(&intent)
	switch {
	case err == nil && intent == store.SharingIntentExcluded:
		return store.SharingGrant{}, fmt.Errorf("%w: remove the exclusion before sharing with this audience", store.ErrGroupInvalid)
	case err == nil && intent == store.SharingIntentShared:
		var grant store.SharingGrant
		if err := tx.QueryRow(`SELECT owner_user_id, posting_id, audience_type, audience_id, intent, created_at FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = ? AND audience_id = ?`,
			ownerID, postingID, audienceType, audienceID).Scan(&grant.OwnerUserID, &grant.PostingID, &grant.Audience, &grant.AudienceID, &grant.Intent, &grant.CreatedAt); err != nil {
			return store.SharingGrant{}, err
		}
		// No mutation happened, so no audit row: the outcome key alone
		// records that this request completed with the existing grant.
		if err := recordSharingRequest(tx, ownerID, requestID, "grant", ownerID, postingID, audienceType, audienceID, "", grant); err != nil {
			return store.SharingGrant{}, err
		}
		return grant, tx.Commit()
	case err != nil && !errors.Is(err, sql.ErrNoRows):
		return store.SharingGrant{}, err
	}
	now := time.Now().Unix()
	if _, err := tx.Exec(`INSERT INTO sharing_grants(owner_user_id, posting_id, audience_type, audience_id, intent, created_at) VALUES (?, ?, ?, ?, 'shared', ?)`,
		ownerID, postingID, audienceType, audienceID, now); err != nil {
		return store.SharingGrant{}, fmt.Errorf("record sharing grant: %w", err)
	}
	grant := store.SharingGrant{OwnerUserID: ownerID, PostingID: postingID, Audience: audienceType, AudienceID: audienceID, Intent: store.SharingIntentShared, CreatedAt: now}
	if err := auditShareEvent(tx, ownerID, ownerID, "grant", postingID, audienceType, audienceID, "", "", requestID); err != nil {
		return store.SharingGrant{}, err
	}
	if err := recordSharingRequest(tx, ownerID, requestID, "grant", ownerID, postingID, audienceType, audienceID, "", grant); err != nil {
		return store.SharingGrant{}, err
	}
	if err := tx.Commit(); err != nil {
		return store.SharingGrant{}, err
	}
	return grant, nil
}

// RevokeSharedPosting deletes one explicit grant. Later reads deny access
// unless another independent valid grant survives. The delete and its audit
// row commit together; revoking an absent grant reports not-found.
// requestID carries the grant idempotency contract: a retry replays the
// recorded revocation.
func (d *Database) RevokeSharedPosting(ownerID, postingID, audienceType, audienceID, requestID string) error {
	if !validSharingUserID(ownerID) || !validSharingPostingID(postingID) {
		return fmt.Errorf("%w: owner and posting must identify one transaction", store.ErrGroupInvalid)
	}
	if err := checkSharingRequestID(requestID); err != nil {
		return err
	}
	if err := checkSharingAudience(audienceType, audienceID, false); err != nil {
		return err
	}
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if recorded, err := lookupSharingRequest(tx, ownerID, requestID); err == nil {
		return matchSharingRequest(recorded, "revoke", ownerID, postingID, audienceType, audienceID, "")
	} else if err != sql.ErrNoRows {
		return err
	}
	result, err := tx.Exec(`DELETE FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = ? AND audience_id = ? AND intent = 'shared'`,
		ownerID, postingID, audienceType, audienceID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	if err := auditShareEvent(tx, ownerID, ownerID, "revoke", postingID, audienceType, audienceID, "", "", requestID); err != nil {
		return err
	}
	revoked := store.SharingRevocation{OwnerUserID: ownerID, PostingID: postingID, Audience: audienceType, AudienceID: audienceID, Intent: store.SharingIntentShared}
	if err := recordSharingRequest(tx, ownerID, requestID, "revoke", ownerID, postingID, audienceType, audienceID, "", revoked); err != nil {
		return err
	}
	return tx.Commit()
}

// ExcludeSharedPosting records the owner's explicit exclusion. The guard
// against a contradictory active grant and the insert run in one
// transaction, so share and exclusion cannot coexist for one audience.
// requestID carries the grant idempotency contract.
func (d *Database) ExcludeSharedPosting(ownerID, postingID, audienceType, audienceID, requestID string) (store.SharingGrant, error) {
	if !validSharingUserID(ownerID) || !validSharingPostingID(postingID) {
		return store.SharingGrant{}, fmt.Errorf("%w: owner and posting must identify one transaction", store.ErrGroupInvalid)
	}
	if err := checkSharingRequestID(requestID); err != nil {
		return store.SharingGrant{}, err
	}
	if err := checkSharingAudience(audienceType, audienceID, true); err != nil {
		return store.SharingGrant{}, err
	}
	tx, err := d.db.Begin()
	if err != nil {
		return store.SharingGrant{}, err
	}
	defer tx.Rollback()
	if recorded, err := lookupSharingRequest(tx, ownerID, requestID); err == nil {
		if err := matchSharingRequest(recorded, "exclude", ownerID, postingID, audienceType, audienceID, ""); err != nil {
			return store.SharingGrant{}, err
		}
		exclusion, err := decodeSharingResult[store.SharingGrant](recorded)
		if err != nil {
			return store.SharingGrant{}, err
		}
		return exclusion, tx.Commit()
	} else if err != sql.ErrNoRows {
		return store.SharingGrant{}, err
	}
	var users int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, ownerID).Scan(&users); err != nil {
		return store.SharingGrant{}, err
	}
	if users != 1 {
		return store.SharingGrant{}, store.ErrNotFound
	}
	var postings int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM postings WHERE user_id = ? AND id = ?`, ownerID, postingID).Scan(&postings); err != nil {
		return store.SharingGrant{}, err
	}
	if postings != 1 {
		return store.SharingGrant{}, store.ErrNotFound
	}
	if err := requireSharingAudienceExists(tx, audienceType, audienceID); err != nil {
		return store.SharingGrant{}, err
	}
	var intent string
	err = tx.QueryRow(`SELECT intent FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = ? AND audience_id = ?`,
		ownerID, postingID, audienceType, audienceID).Scan(&intent)
	switch {
	case err == nil && intent == store.SharingIntentShared:
		return store.SharingGrant{}, fmt.Errorf("%w: revoke the grant before excluding this audience", store.ErrGroupInvalid)
	case err == nil && intent == store.SharingIntentExcluded:
		var grant store.SharingGrant
		if err := tx.QueryRow(`SELECT owner_user_id, posting_id, audience_type, audience_id, intent, created_at FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = ? AND audience_id = ?`,
			ownerID, postingID, audienceType, audienceID).Scan(&grant.OwnerUserID, &grant.PostingID, &grant.Audience, &grant.AudienceID, &grant.Intent, &grant.CreatedAt); err != nil {
			return store.SharingGrant{}, err
		}
		// No mutation happened, so no audit row: the outcome key alone
		// records that this request completed with the existing row.
		if err := recordSharingRequest(tx, ownerID, requestID, "exclude", ownerID, postingID, audienceType, audienceID, "", grant); err != nil {
			return store.SharingGrant{}, err
		}
		return grant, tx.Commit()
	case err != nil && !errors.Is(err, sql.ErrNoRows):
		return store.SharingGrant{}, err
	}
	now := time.Now().Unix()
	if _, err := tx.Exec(`INSERT INTO sharing_grants(owner_user_id, posting_id, audience_type, audience_id, intent, created_at) VALUES (?, ?, ?, ?, 'excluded', ?)`,
		ownerID, postingID, audienceType, audienceID, now); err != nil {
		return store.SharingGrant{}, fmt.Errorf("record sharing exclusion: %w", err)
	}
	exclusion := store.SharingGrant{OwnerUserID: ownerID, PostingID: postingID, Audience: audienceType, AudienceID: audienceID, Intent: store.SharingIntentExcluded, CreatedAt: now}
	if err := auditShareEvent(tx, ownerID, ownerID, "exclude", postingID, audienceType, audienceID, "", "", requestID); err != nil {
		return store.SharingGrant{}, err
	}
	if err := recordSharingRequest(tx, ownerID, requestID, "exclude", ownerID, postingID, audienceType, audienceID, "", exclusion); err != nil {
		return store.SharingGrant{}, err
	}
	if err := tx.Commit(); err != nil {
		return store.SharingGrant{}, err
	}
	return exclusion, nil
}

// RemoveSharedExclusion deletes one explicit exclusion. The delete and its
// audit row commit together; removing an absent exclusion reports not-found.
// requestID carries the grant idempotency contract: a retry replays the
// recorded removal.
func (d *Database) RemoveSharedExclusion(ownerID, postingID, audienceType, audienceID, requestID string) error {
	if !validSharingUserID(ownerID) || !validSharingPostingID(postingID) {
		return fmt.Errorf("%w: owner and posting must identify one transaction", store.ErrGroupInvalid)
	}
	if err := checkSharingRequestID(requestID); err != nil {
		return err
	}
	if err := checkSharingAudience(audienceType, audienceID, true); err != nil {
		return err
	}
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if recorded, err := lookupSharingRequest(tx, ownerID, requestID); err == nil {
		return matchSharingRequest(recorded, "unexclude", ownerID, postingID, audienceType, audienceID, "")
	} else if err != sql.ErrNoRows {
		return err
	}
	result, err := tx.Exec(`DELETE FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = ? AND audience_id = ? AND intent = 'excluded'`,
		ownerID, postingID, audienceType, audienceID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	if err := auditShareEvent(tx, ownerID, ownerID, "unexclude", postingID, audienceType, audienceID, "", "", requestID); err != nil {
		return err
	}
	removed := store.SharingRevocation{OwnerUserID: ownerID, PostingID: postingID, Audience: audienceType, AudienceID: audienceID, Intent: store.SharingIntentExcluded}
	if err := recordSharingRequest(tx, ownerID, requestID, "unexclude", ownerID, postingID, audienceType, audienceID, "", removed); err != nil {
		return err
	}
	return tx.Commit()
}

// ListSharingGrants returns the owner's explicit grants and exclusions in
// stable order.
func (d *Database) ListSharingGrants(ownerID string) ([]store.SharingGrant, error) {
	if !validSharingUserID(ownerID) {
		return nil, fmt.Errorf("%w: owner must be a user ID", store.ErrGroupInvalid)
	}
	rows, err := d.db.Query(`SELECT owner_user_id, posting_id, audience_type, audience_id, intent, created_at FROM sharing_grants WHERE owner_user_id = ? ORDER BY posting_id, audience_type, audience_id`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	grants := []store.SharingGrant{}
	for rows.Next() {
		grant, err := sharingGrantScan(rows)
		if err != nil {
			return nil, err
		}
		grants = append(grants, grant)
	}
	return grants, rows.Err()
}

// CheckSharedPostingAccess evaluates read-time authorization for one
// owner-scoped posting and requester: current group and source-owner
// membership, owner consent (explicit grant or enabled automatic-sharing
// policy covering the posting's current accounts and transaction date),
// exclusions, and revocation state. It queries current rows on every call;
// there is no positive auth cache. It takes no index shortcut: the
// visibility index only discovers list candidates, while this function
// alone decides every list and detail read from live rows, so a stale or
// missing reference can under-share a list but never over-share a read.
func (d *Database) CheckSharedPostingAccess(ownerID, postingID, requesterID string) (store.SharedPostingAccess, error) {
	denied := store.SharedPostingAccess{Allowed: false}
	if !validSharingUserID(ownerID) || !validSharingPostingID(postingID) || !validSharingUserID(requesterID) {
		return denied, nil
	}
	var present int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM postings WHERE user_id = ? AND id = ? AND void = 0`, ownerID, postingID).Scan(&present); err != nil {
		return denied, err
	}
	if present != 1 {
		return denied, nil
	}
	if requesterID == ownerID {
		return store.SharedPostingAccess{Allowed: true, Reason: "owner"}, nil
	}
	var exclusions int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND intent = 'excluded' AND ((audience_type = 'all') OR (audience_type = 'user' AND audience_id = ?))`,
		ownerID, postingID, requesterID).Scan(&exclusions); err != nil {
		return denied, err
	}
	if exclusions > 0 {
		return denied, nil
	}
	// A group exclusion denies its current members even when another
	// audience grants them access. Other group members stay authorized.
	excludedGroups, err := excludedGroupIDs(d.db, ownerID, postingID)
	if err != nil {
		return denied, err
	}
	for _, groupID := range excludedGroups {
		role, err := d.groupRole(groupID, requesterID)
		if err != nil {
			return denied, err
		}
		if role != "" {
			return denied, nil
		}
	}
	var direct int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = 'user' AND audience_id = ? AND intent = 'shared'`,
		ownerID, postingID, requesterID).Scan(&direct); err != nil {
		return denied, err
	}
	if direct > 0 {
		return store.SharedPostingAccess{Allowed: true, Reason: "manual-user"}, nil
	}
	// Group grants authorize only while both the requester and the source
	// owner hold current membership. Ended membership denies immediately;
	// no cached or indexed row survives it.
	rows, err := d.db.Query(`SELECT audience_id FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = 'group' AND intent = 'shared'`, ownerID, postingID)
	if err != nil {
		return denied, err
	}
	defer rows.Close()
	groups := []string{}
	for rows.Next() {
		var groupID string
		if err := rows.Scan(&groupID); err != nil {
			return denied, err
		}
		groups = append(groups, groupID)
	}
	if err := rows.Err(); err != nil {
		return denied, err
	}
	for _, groupID := range groups {
		requesterRole, err := d.groupRole(groupID, requesterID)
		if err != nil {
			return denied, err
		}
		if requesterRole == "" {
			continue
		}
		ownerRole, err := d.groupRole(groupID, ownerID)
		if err != nil {
			return denied, err
		}
		if ownerRole == "" {
			continue
		}
		return store.SharedPostingAccess{Allowed: true, Reason: "manual-group"}, nil
	}
	// Policy-derived automatic access (GRP-02) composes under the same
	// exclusions checked above: an enabled policy covering the posting's
	// current accounts and transaction date authorizes while both parties
	// hold current membership. Disable or narrow revokes on commit because
	// this reads live rows with no cache.
	return d.automaticPolicyAccess(ownerID, postingID, requesterID)
}

// ReadSharedPosting returns one authorized posting in the existing
// transaction shape. Missing and denied postings both report ErrNotFound.
func (d *Database) ReadSharedPosting(ownerID, postingID, requesterID string) (types.Posting, error) {
	access, err := d.CheckSharedPostingAccess(ownerID, postingID, requesterID)
	if err != nil {
		return types.Posting{}, err
	}
	if !access.Allowed {
		return types.Posting{}, store.ErrNotFound
	}
	rows, err := d.db.Query(`SELECT `+postingSelect+` `+postingJoins+` WHERE p.user_id = ? AND p.id = ?`, ownerID, postingID)
	if err != nil {
		return types.Posting{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return types.Posting{}, store.ErrNotFound
	}
	posting, err := scanPostingRow(rows)
	if err != nil {
		return types.Posting{}, err
	}
	return posting, rows.Err()
}

// ListSharedPostings returns every posting currently shared with the
// requester. Manual candidates come from the small explicit-grant table;
// automatic candidates come from the write-maintained visibility index
// at the current policy version, never from scanning owners' postings.
// Each candidate is re-authorized through CheckSharedPostingAccess before
// it is read, and one posting lists once however many accounts, groups,
// or reasons match. Results order by owner then posting; keyset feed
// pagination over the index belongs to the feed consumer.
func (d *Database) ListSharedPostings(requesterID string) ([]store.SharedPostingRef, error) {
	if !validSharingUserID(requesterID) {
		return nil, fmt.Errorf("%w: requester must be a user ID", store.ErrGroupInvalid)
	}
	type candidate struct{ owner, posting string }
	seen := map[candidate]bool{}
	var candidates []candidate
	add := func(owner, posting string) {
		key := candidate{owner, posting}
		if !seen[key] {
			seen[key] = true
			candidates = append(candidates, key)
		}
	}
	rows, err := d.db.Query(`SELECT g.owner_user_id, g.posting_id FROM sharing_grants g JOIN postings p ON p.user_id = g.owner_user_id AND p.id = g.posting_id
		WHERE g.audience_type = 'user' AND g.audience_id = ? AND g.intent = 'shared' ORDER BY g.owner_user_id, g.posting_id`, requesterID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var owner, posting string
		if err := rows.Scan(&owner, &posting); err != nil {
			rows.Close()
			return nil, err
		}
		add(owner, posting)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	groupRows, err := d.db.Query(`SELECT DISTINCT g.owner_user_id, g.posting_id FROM sharing_grants g JOIN postings p ON p.user_id = g.owner_user_id AND p.id = g.posting_id
		JOIN group_members m ON m.group_id = g.audience_id AND m.user_id = ? WHERE g.audience_type = 'group' AND g.intent = 'shared' ORDER BY g.owner_user_id, g.posting_id`, requesterID)
	if err != nil {
		return nil, err
	}
	for groupRows.Next() {
		var owner, posting string
		if err := groupRows.Scan(&owner, &posting); err != nil {
			groupRows.Close()
			return nil, err
		}
		add(owner, posting)
	}
	if err := groupRows.Err(); err != nil {
		groupRows.Close()
		return nil, err
	}
	groupRows.Close()
	// Automatic candidates (GRP-05): the write-maintained reference index
	// names covered postings per group at the current policy version, so
	// reads never scan owners' postings. The joins pre-fence stale rows
	// (version match, current membership both sides, non-void existence);
	// every candidate is still re-authorized through
	// CheckSharedPostingAccess before it is read, so a retained row can
	// under-share but never over-share. Own rows live in the private
	// model, never in the shared list.
	indexRows, err := d.db.Query(`SELECT DISTINCT v.owner_user_id, v.posting_id FROM sharing_visibility v
		JOIN group_members requester ON requester.group_id = v.group_id AND requester.user_id = ?
		JOIN group_members owner ON owner.group_id = v.group_id AND owner.user_id = v.owner_user_id
		JOIN sharing_policies policy ON policy.owner_user_id = v.owner_user_id AND policy.group_id = v.group_id
			AND policy.version = v.policy_version AND policy.enabled = 1
		JOIN postings posting ON posting.user_id = v.owner_user_id AND posting.id = v.posting_id AND posting.void = 0
		WHERE v.owner_user_id != ? ORDER BY v.owner_user_id, v.posting_id`, requesterID, requesterID)
	if err != nil {
		return nil, err
	}
	for indexRows.Next() {
		var owner, posting string
		if err := indexRows.Scan(&owner, &posting); err != nil {
			indexRows.Close()
			return nil, err
		}
		add(owner, posting)
	}
	if err := indexRows.Err(); err != nil {
		indexRows.Close()
		return nil, err
	}
	indexRows.Close()
	refs := []store.SharedPostingRef{}
	for _, key := range candidates {
		access, err := d.CheckSharedPostingAccess(key.owner, key.posting, requesterID)
		if err != nil {
			return nil, err
		}
		if !access.Allowed {
			continue
		}
		posting, err := d.ReadSharedPosting(key.owner, key.posting, requesterID)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				continue
			}
			return nil, err
		}
		refs = append(refs, store.SharedPostingRef{OwnerUserID: key.owner, Posting: posting})
	}
	return refs, nil
}

// verifySharingSourceCurrent re-reads the source posting after the copy
// commit and compares its revision against the snapshot the copy was built
// from. A mismatch means the owner revised the source mid-accept, so the
// accept fails explicitly instead of recording a torn link. The re-read
// also re-checks live authorization, preserving the fail-closed revocation
// window: a revoked grant reports ErrNotFound here.
func (d *Database) verifySharingSourceCurrent(ownerID, postingID, requesterID, snapshotRevision string) (types.Posting, error) {
	current, err := d.ReadSharedPosting(ownerID, postingID, requesterID)
	if err != nil {
		return types.Posting{}, err
	}
	revision, err := store.SharingSourceRevision(current)
	if err != nil {
		return types.Posting{}, fmt.Errorf("verify sharing source: %w", err)
	}
	if revision != snapshotRevision {
		return types.Posting{}, fmt.Errorf("%w: the shared transaction was revised during acceptance", store.ErrSharingConflict)
	}
	return current, nil
}

// healSharingCopyRace resolves a lost double-accept race to the winner's
// copy. A link-identity collision means another accept committed the same
// triple first; the loser's duplicate is already gone, so the recorded
// copy is returned with its edits intact. No second audit row is appended:
// the mutation happened once.
func (d *Database) healSharingCopyRace(ownerID, postingID, requesterID, requestID, linkID string) (types.Posting, error) {
	existing, ok, err := d.findSharingCopy(ownerID, postingID, requesterID)
	if err != nil {
		return types.Posting{}, err
	}
	if !ok {
		return types.Posting{}, fmt.Errorf("record sharing copy: link identity collision without a recorded copy")
	}
	if err := recordSharingRequest(d.db, requesterID, requestID, store.SharingAuditCopyAccepted, ownerID, postingID, "", "", linkID, existing); err != nil {
		if isUniqueViolation(err) {
			return d.replaySharingCopy(requesterID, requestID, ownerID, postingID, linkID)
		}
		return types.Posting{}, err
	}
	return existing, nil
}

// replaySharingCopy re-reads a just-committed same-key outcome after a key
// collision: a concurrent request with the same key committed first.
func (d *Database) replaySharingCopy(requesterID, requestID, ownerID, postingID, linkID string) (types.Posting, error) {
	recorded, err := lookupSharingRequest(d.db, requesterID, requestID)
	if err != nil {
		return types.Posting{}, err
	}
	if err := matchSharingRequest(recorded, store.SharingAuditCopyAccepted, ownerID, postingID, "", "", linkID); err != nil {
		return types.Posting{}, err
	}
	return decodeSharingResult[types.Posting](recorded)
}

// CopySharedPosting accepts one authorized shared posting into the
// requester's own model as an independent row. The copy keeps the stored
// content with recipient-local adjustments the store requires: a fresh ID,
// recipient ownership, no owner-scoped claim, and a cleared source account
// when the recipient owns no account with that ID (the foreign key would
// otherwise reject the row). Destination IDs carry no store foreign key
// and stay verbatim for the recipient to relink. Amount descriptors stay
// verbatim; reference validation remains the API write boundary's job.
// CreatePosting recomputes lifecycle, so the copy is always owner-authored
// with no bank sync key: accepting a share never manufactures a duplicate
// bank posting. Copies are idempotent per source-plus-recipient triple: a
// repeat accept returns the existing recipient row, with its edits intact,
// and resolves to the same stable link (FND-04) instead of minting a
// duplicate. requestID is a client UUID: retries with the same key replay
// the recorded copy. A source revision landing mid-accept fails with
// ErrSharingConflict and rolls the copy back instead of recording a torn
// link; a concurrent accept losing the link-identity race resolves to the
// winner's copy instead of leaking a constraint error.
func (d *Database) CopySharedPosting(ownerID, postingID, requesterID, requestID string) (types.Posting, error) {
	if err := checkSharingRequestID(requestID); err != nil {
		return types.Posting{}, err
	}
	linkID := store.SharingLinkID(ownerID, postingID, requesterID)
	// Retry replay: the same key returns the recorded copy without
	// re-executing; a reused key for a different action fails as conflict.
	if recorded, err := lookupSharingRequest(d.db, requesterID, requestID); err == nil {
		if err := matchSharingRequest(recorded, store.SharingAuditCopyAccepted, ownerID, postingID, "", "", linkID); err != nil {
			return types.Posting{}, err
		}
		return decodeSharingResult[types.Posting](recorded)
	} else if !errors.Is(err, sql.ErrNoRows) {
		return types.Posting{}, err
	}
	source, err := d.ReadSharedPosting(ownerID, postingID, requesterID)
	if err != nil {
		return types.Posting{}, err
	}
	snapshotRevision, err := store.SharingSourceRevision(source)
	if err != nil {
		return types.Posting{}, fmt.Errorf("record sharing copy: %w", err)
	}
	var recipients int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, requesterID).Scan(&recipients); err != nil {
		return types.Posting{}, err
	}
	if recipients != 1 {
		return types.Posting{}, store.ErrNotFound
	}
	recipient := &sqliteStore{db: &userDB{DB: d.db, userID: requesterID}, application: d}
	// Idempotent accept: the stable link names one source-plus-recipient
	// triple, so a repeat accept returns the existing recipient row with
	// its edits intact instead of minting a duplicate. The outcome key is
	// still recorded, but no second audit row is appended: the mutation
	// happened once.
	if existing, ok, err := d.findSharingCopy(ownerID, postingID, requesterID); err != nil {
		return types.Posting{}, err
	} else if ok {
		if err := recordSharingRequest(d.db, requesterID, requestID, store.SharingAuditCopyAccepted, ownerID, postingID, "", "", linkID, existing); err != nil {
			if isUniqueViolation(err) {
				return d.replaySharingCopy(requesterID, requestID, ownerID, postingID, linkID)
			}
			return types.Posting{}, err
		}
		return existing, nil
	}
	copy := source
	copy.ID = ""
	copy.Claim = nil
	if copy.SourceAccountID != nil {
		var accounts int
		if err := d.db.QueryRow(`SELECT COUNT(*) FROM accounts WHERE user_id = ? AND id = ?`, requesterID, *copy.SourceAccountID).Scan(&accounts); err != nil {
			return types.Posting{}, err
		}
		if accounts != 1 {
			copy.SourceAccountID = nil
		}
	}
	created, err := recipient.CreatePosting(copy)
	if err != nil {
		return types.Posting{}, err
	}
	// Re-check after the copy commits: revocation between the read above
	// and the copy commit must not mint an unauthorized copy, and a source
	// revision in the same window must not record a torn link. Both fail
	// explicitly and roll the copy back; the caller retries with a fresh
	// read and a new key. This is fail-closed, not authorized-at-instant:
	// a revocation landing in that window deletes a just-created copy even
	// though the copy was authorized moments earlier. A copy that survives
	// this check is unaffected by later revocation by design.
	if _, err := d.verifySharingSourceCurrent(ownerID, postingID, requesterID, snapshotRevision); err != nil {
		// Loud failure, never silent success. The cleanup cause uses %v
		// so the result never unwraps to ErrNotFound: a leftover copy
		// must surface as 503, not "not found".
		if derr := recipient.DeletePosting(created.ID); derr != nil {
			return types.Posting{}, fmt.Errorf("revoke unauthorized sharing copy: %v: %v", derr, err)
		}
		return types.Posting{}, err
	}
	audienceType, audienceID, reason, err := d.sharingLinkGrant(ownerID, postingID, requesterID)
	if err != nil {
		if derr := recipient.DeletePosting(created.ID); derr != nil {
			return types.Posting{}, fmt.Errorf("record sharing copy: %v: %w", derr, err)
		}
		return types.Posting{}, err
	}
	now := time.Now().Unix()
	// Provenance, audit, and outcome key commit atomically: a crash can
	// never leave a copy with no audit row, and a retry then converges
	// through the existing-copy path with the key recorded and no second
	// audit. The copy row itself commits outside (CreatePosting owns its
	// lifecycle), so failures here still delete it explicitly.
	tx, err := d.db.Begin()
	if err != nil {
		if derr := recipient.DeletePosting(created.ID); derr != nil {
			return types.Posting{}, fmt.Errorf("record sharing copy: %v: %w", derr, err)
		}
		return types.Posting{}, err
	}
	defer tx.Rollback()
	// Every pre-commit failure path below rolls the transaction back
	// before touching the pool again: the store holds one connection, so
	// cleanup reads and writes while our transaction stands open would
	// deadlock on our own lock. (A failed Commit releases the connection
	// itself, so the commit-failure cleanup below needs no rollback.)
	if _, err := tx.Exec(`INSERT INTO sharing_copies(recipient_user_id, copy_posting_id, source_owner_id, source_posting_id, link_id, source_revision, grant_audience_type, grant_audience_id, grant_reason, copied_at, refreshed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		requesterID, created.ID, ownerID, postingID, linkID, snapshotRevision, audienceType, audienceID, reason, now, now); err != nil {
		_ = tx.Rollback()
		if derr := recipient.DeletePosting(created.ID); derr != nil {
			return types.Posting{}, fmt.Errorf("record sharing copy: %v: %w", derr, err)
		}
		if isUniqueViolation(err) {
			// A concurrent accept committed this triple first: drop our
			// duplicate copy and resolve to the winner instead of
			// leaking a constraint error. A retry heals the same way.
			// Nothing of ours committed, and the winner's rows are
			// fully committed (single connection), so the heal below
			// observes complete state.
			return d.healSharingCopyRace(ownerID, postingID, requesterID, requestID, linkID)
		}
		return types.Posting{}, fmt.Errorf("record sharing copy: %w", err)
	}
	if err := auditShareEvent(tx, ownerID, requesterID, store.SharingAuditCopyAccepted, postingID, "", "", linkID, "", requestID); err != nil {
		_ = tx.Rollback()
		if derr := recipient.DeletePosting(created.ID); derr != nil {
			return types.Posting{}, fmt.Errorf("record sharing copy: %v: %w", derr, err)
		}
		return types.Posting{}, err
	}
	if err := recordSharingRequest(tx, requesterID, requestID, store.SharingAuditCopyAccepted, ownerID, postingID, "", "", linkID, created); err != nil {
		_ = tx.Rollback()
		if derr := recipient.DeletePosting(created.ID); derr != nil {
			return types.Posting{}, fmt.Errorf("record sharing copy: %v: %w", derr, err)
		}
		if isUniqueViolation(err) {
			// A concurrent same-key accept committed first with a full
			// outcome: our rows are rolled back above and the winner's
			// recording replays. The rollback must precede the replay
			// read for the single-connection reason above.
			return d.replaySharingCopy(requesterID, requestID, ownerID, postingID, linkID)
		}
		return types.Posting{}, err
	}
	if err := tx.Commit(); err != nil {
		if derr := recipient.DeletePosting(created.ID); derr != nil {
			return types.Posting{}, fmt.Errorf("record sharing copy: %v: %w", derr, err)
		}
		return types.Posting{}, err
	}
	return created, nil
}

// deleteSharingForPosting removes explicit consent rows for one deleted
// owner posting. A deleted transaction authorizes nothing afterwards.
func deleteSharingForPosting(tx *userTx, postingID string) error {
	// Positional placeholders precede the named scope parameter, matching
	// every scoped statement in this package.
	if _, err := tx.Exec(`DELETE FROM sharing_grants WHERE posting_id = ? AND owner_user_id = :user_id`, postingID); err != nil {
		return fmt.Errorf("clear sharing grants %s: %w", postingID, err)
	}
	if err := deleteVisibilityForPostingTx(tx, postingID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM sharing_copies WHERE source_posting_id = ? AND source_owner_id = :user_id`, postingID); err != nil {
		return fmt.Errorf("clear sharing copy provenance %s: %w", postingID, err)
	}
	// The recipient deleting their own copy also drops its provenance row.
	if _, err := tx.Exec(`DELETE FROM sharing_copies WHERE copy_posting_id = ? AND recipient_user_id = :user_id`, postingID); err != nil {
		return fmt.Errorf("clear sharing copy provenance %s: %w", postingID, err)
	}
	return nil
}

// clearSharingForUser removes consent the user issued and provenance for
// copies they received or sourced. Copies themselves are ordinary model rows
// and clear with the model. Idempotency keys the user executed and audit
// events touching the user go too: a stale replay must never resurrect a
// cleared grant, and a cleared scope restarts with an empty trace.
func clearSharingForUser(tx *userTx) error {
	if _, err := tx.Exec(`DELETE FROM sharing_grants WHERE owner_user_id = :user_id`); err != nil {
		return fmt.Errorf("clear sharing grants: %w", err)
	}
	// The cleared scope restarts with an empty trace: stale audit rows
	// touching the user go before the replacement marker below, so the
	// only surviving row is the policies-cleared marker itself (which
	// names no posting and never surfaces in per-posting reads).
	if _, err := tx.Exec(`DELETE FROM sharing_audit WHERE actor_user_id = :user_id OR owner_user_id = :user_id`); err != nil {
		return fmt.Errorf("clear sharing audit: %w", err)
	}
	if err := clearSharingPoliciesForUser(tx); err != nil {
		return err
	}
	if err := deleteVisibilityForOwnerTx(tx); err != nil {
		return err
	}
	if err := auditSharingScoped(tx, tx.userID, "policies-cleared", "", "", "", "", `{"reason":"model-rows-replaced"}`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM sharing_copies WHERE recipient_user_id = :user_id OR source_owner_id = :user_id`); err != nil {
		return fmt.Errorf("clear sharing copies: %w", err)
	}
	// Inbox state is recipient-owned: clearing the model resets the
	// recipient's decisions, read, and dismissed flags. Currently shared
	// postings re-sight as new on the next list; rows where the user is
	// the source owner stay for their recipients and cancel by lost
	// authorization.
	if _, err := tx.Exec(`DELETE FROM inbox_share_state WHERE recipient_user_id = :user_id`); err != nil {
		return fmt.Errorf("clear inbox state: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM sharing_requests WHERE actor_user_id = :user_id`); err != nil {
		return fmt.Errorf("clear sharing requests: %w", err)
	}
	return nil
}
