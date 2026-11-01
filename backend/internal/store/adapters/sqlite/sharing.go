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
		// sharing_copies records provenance for recipient-owned copies.
		// The copy itself is an ordinary posting in the recipient's model:
		// revocation never rewrites or erases it. Stable link identities
		// (link ID, source revision) land with FND-04.
		`CREATE TABLE IF NOT EXISTS sharing_copies (
			recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			copy_posting_id TEXT NOT NULL,
			source_owner_id TEXT NOT NULL,
			source_posting_id TEXT NOT NULL,
			copied_at INTEGER NOT NULL,
			PRIMARY KEY (recipient_user_id, copy_posting_id)
		)`,
		`CREATE INDEX IF NOT EXISTS sharing_copies_source ON sharing_copies(source_owner_id, source_posting_id)`,
	}
	return append(statements, sharingPolicySchemaStatements()...)
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
// and the conflicting-exclusion guard run in one transaction.
func (d *Database) GrantSharedPosting(ownerID, postingID, audienceType, audienceID string) (store.SharingGrant, error) {
	if !validSharingUserID(ownerID) || !validSharingPostingID(postingID) {
		return store.SharingGrant{}, fmt.Errorf("%w: owner and posting must identify one transaction", store.ErrGroupInvalid)
	}
	if err := checkSharingAudience(audienceType, audienceID, false); err != nil {
		return store.SharingGrant{}, err
	}
	tx, err := d.db.Begin()
	if err != nil {
		return store.SharingGrant{}, err
	}
	defer tx.Rollback()
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
		return grant, tx.Commit()
	case err != nil && !errors.Is(err, sql.ErrNoRows):
		return store.SharingGrant{}, err
	}
	now := time.Now().Unix()
	if _, err := tx.Exec(`INSERT INTO sharing_grants(owner_user_id, posting_id, audience_type, audience_id, intent, created_at) VALUES (?, ?, ?, ?, 'shared', ?)`,
		ownerID, postingID, audienceType, audienceID, now); err != nil {
		return store.SharingGrant{}, fmt.Errorf("record sharing grant: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return store.SharingGrant{}, err
	}
	return store.SharingGrant{OwnerUserID: ownerID, PostingID: postingID, Audience: audienceType, AudienceID: audienceID, Intent: store.SharingIntentShared, CreatedAt: now}, nil
}

// RevokeSharedPosting deletes one explicit grant. Later reads deny access
// unless another independent valid grant survives.
func (d *Database) RevokeSharedPosting(ownerID, postingID, audienceType, audienceID string) error {
	if !validSharingUserID(ownerID) || !validSharingPostingID(postingID) {
		return fmt.Errorf("%w: owner and posting must identify one transaction", store.ErrGroupInvalid)
	}
	if err := checkSharingAudience(audienceType, audienceID, false); err != nil {
		return err
	}
	result, err := d.db.Exec(`DELETE FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = ? AND audience_id = ? AND intent = 'shared'`,
		ownerID, postingID, audienceType, audienceID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}

// ExcludeSharedPosting records the owner's explicit exclusion. The guard
// against a contradictory active grant and the insert run in one
// transaction, so share and exclusion cannot coexist for one audience.
func (d *Database) ExcludeSharedPosting(ownerID, postingID, audienceType, audienceID string) (store.SharingGrant, error) {
	if !validSharingUserID(ownerID) || !validSharingPostingID(postingID) {
		return store.SharingGrant{}, fmt.Errorf("%w: owner and posting must identify one transaction", store.ErrGroupInvalid)
	}
	if err := checkSharingAudience(audienceType, audienceID, true); err != nil {
		return store.SharingGrant{}, err
	}
	tx, err := d.db.Begin()
	if err != nil {
		return store.SharingGrant{}, err
	}
	defer tx.Rollback()
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
		return grant, tx.Commit()
	case err != nil && !errors.Is(err, sql.ErrNoRows):
		return store.SharingGrant{}, err
	}
	now := time.Now().Unix()
	if _, err := tx.Exec(`INSERT INTO sharing_grants(owner_user_id, posting_id, audience_type, audience_id, intent, created_at) VALUES (?, ?, ?, ?, 'excluded', ?)`,
		ownerID, postingID, audienceType, audienceID, now); err != nil {
		return store.SharingGrant{}, fmt.Errorf("record sharing exclusion: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return store.SharingGrant{}, err
	}
	return store.SharingGrant{OwnerUserID: ownerID, PostingID: postingID, Audience: audienceType, AudienceID: audienceID, Intent: store.SharingIntentExcluded, CreatedAt: now}, nil
}

// RemoveSharedExclusion deletes one explicit exclusion.
func (d *Database) RemoveSharedExclusion(ownerID, postingID, audienceType, audienceID string) error {
	if !validSharingUserID(ownerID) || !validSharingPostingID(postingID) {
		return fmt.Errorf("%w: owner and posting must identify one transaction", store.ErrGroupInvalid)
	}
	if err := checkSharingAudience(audienceType, audienceID, true); err != nil {
		return err
	}
	result, err := d.db.Exec(`DELETE FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ? AND audience_type = ? AND audience_id = ? AND intent = 'excluded'`,
		ownerID, postingID, audienceType, audienceID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
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

// CheckSharedPostingAccess re-evaluates authorization from current rows on
// every call. Denial covers missing postings, malformed IDs, void rows,
// exclusions, revoked grants, disabled or narrowed policies, and ended
// memberships without distinguishing them. Manual explicit grants and the
// policy-derived automatic reason compose as a union under exclusions.
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
// requester. Manual candidates come from the small explicit-grant table,
// never from scanning owners' postings; automatic candidates come from
// owners holding enabled policies in the requester's groups. Each
// candidate is re-authorized through CheckSharedPostingAccess before it is
// read, and one posting lists once however many accounts or reasons match.
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
	// Automatic candidates (GRP-02): owners with enabled policies in the
	// requester's groups contribute their currently covered postings. This
	// bounded scan is the interim discovery path; the later reference index
	// (GRP-05) replaces it while CheckSharedPostingAccess stays the final
	// gate below.
	owners, err := d.automaticPolicyOwners(requesterID)
	if err != nil {
		return nil, err
	}
	for _, owner := range owners {
		if owner == requesterID {
			// Own rows live in the private model, never in the shared
			// list: the owner reason would otherwise echo them here.
			continue
		}
		policies, err := d.ownerGroupPolicies(owner, requesterID)
		if err != nil {
			return nil, err
		}
		ids, err := eligiblePolicyPostings(d.db, owner, policies)
		if err != nil {
			return nil, err
		}
		for _, id := range ids {
			add(owner, id)
		}
	}
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

// CopySharedPosting accepts one authorized shared posting into the
// requester's own model as an independent row. The copy keeps the stored
// content with recipient-local adjustments the store requires: a fresh ID,
// recipient ownership, no owner-scoped claim, and a cleared source account
// when the recipient owns no account with that ID (the foreign key would
// otherwise reject the row). Destination IDs carry no store foreign key
// and stay verbatim for the recipient to relink. Amount descriptors stay
// verbatim; reference validation remains the API write boundary's job.
func (d *Database) CopySharedPosting(ownerID, postingID, requesterID string) (types.Posting, error) {
	source, err := d.ReadSharedPosting(ownerID, postingID, requesterID)
	if err != nil {
		return types.Posting{}, err
	}
	var recipients int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, requesterID).Scan(&recipients); err != nil {
		return types.Posting{}, err
	}
	if recipients != 1 {
		return types.Posting{}, store.ErrNotFound
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
	recipient := &sqliteStore{db: &userDB{DB: d.db, userID: requesterID}, application: d}
	created, err := recipient.CreatePosting(copy)
	if err != nil {
		return types.Posting{}, err
	}
	// Re-check after the copy commits: revocation between the read above
	// and the copy commit must not mint an unauthorized copy. This is
	// fail-closed, not authorized-at-instant: a revocation landing in that
	// window deletes a just-created copy even though the copy was
	// authorized moments earlier. A copy that survives this check is
	// unaffected by later revocation by design.
	access, err := d.CheckSharedPostingAccess(ownerID, postingID, requesterID)
	if err == nil && !access.Allowed {
		err = store.ErrNotFound
	}
	if err != nil {
		// Loud failure, never silent success. Both causes use %v so the
		// result never unwraps to ErrNotFound: a leftover copy must
		// surface as 503, not "not found".
		if derr := recipient.DeletePosting(created.ID); derr != nil {
			return types.Posting{}, fmt.Errorf("revoke unauthorized sharing copy: %v: %v", derr, err)
		}
		return types.Posting{}, err
	}
	if _, err := d.db.Exec(`INSERT INTO sharing_copies(recipient_user_id, copy_posting_id, source_owner_id, source_posting_id, copied_at) VALUES (?, ?, ?, ?, ?)`,
		requesterID, created.ID, ownerID, postingID, time.Now().Unix()); err != nil {
		if derr := recipient.DeletePosting(created.ID); derr != nil {
			return types.Posting{}, fmt.Errorf("record sharing copy: %v: %w", derr, err)
		}
		return types.Posting{}, fmt.Errorf("record sharing copy: %w", err)
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
// and clear with the model.
func clearSharingForUser(tx *userTx) error {
	if _, err := tx.Exec(`DELETE FROM sharing_grants WHERE owner_user_id = :user_id`); err != nil {
		return fmt.Errorf("clear sharing grants: %w", err)
	}
	if err := clearSharingPoliciesForUser(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM sharing_copies WHERE recipient_user_id = :user_id OR source_owner_id = :user_id`); err != nil {
		return fmt.Errorf("clear sharing copies: %w", err)
	}
	return nil
}
