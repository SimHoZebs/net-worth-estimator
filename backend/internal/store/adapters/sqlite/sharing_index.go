// Materialized group-share visibility index (GRP-05). One row references
// one owner posting for one group audience at one policy version: no
// financial payload is copied, and at most one reference exists per
// posting plus group however many selected accounts match.
//
// The index is discovery only, never authorization. Every shared read
// re-validates through CheckSharedPostingAccess over live rows, so a
// stale or missing reference can under-share but never over-share:
// extra rows deny at the live gate, missing rows only hide list entries
// while detail reads still evaluate the live rule.
//
// Maintenance is same-write: every statement below runs inside the
// transaction that mutates postings, policies, accounts, memberships, or
// consent, or the mutation fails. Policy changes bump the policy version
// first, then old-version rows are deleted and current rows rewritten in
// the same transaction, so revocation fences on commit. Bulk rebuilds
// delete before re-deriving and insert only live-covered postings, so an
// interrupted rebuild under-shares until it completes.
//
// Placeholder order is load-bearing (see scoped.go): in scoped (*userTx)
// statements the auto-appended :user_id argument binds to the LAST
// placeholder, so :user_id stands textually last in every statement here
// and every mixed statement has a misbinding test. Raw (*sql.Tx)
// statements use positional placeholders only.
package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// sharingVisibilitySchemaStatements creates the reference index. Groups
// cascade as a backstop; every mutation path also deletes explicitly
// because SQLite only enforces cascades with foreign-key pragmas on.
func sharingVisibilitySchemaStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS sharing_visibility (
			owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			posting_id TEXT NOT NULL,
			group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
			policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (owner_user_id, posting_id, group_id)
		)`,
		`CREATE INDEX IF NOT EXISTS sharing_visibility_group ON sharing_visibility(group_id, owner_user_id, posting_id)`,
	}
}

// sharingAuditSchemaStatements creates the consent audit log. Every
// policy, grant, and exclusion mutation appends one row with the actor,
// timestamp, and before/after coverage in the same transaction; idempotent
// retries that change nothing append nothing. The owner scope column is
// owner_user_id, matching the other sharing tables: the operator copy
// only carries tables with a user_id column, so audit history is never
// copied as a source reference. In scoped statements the auto-appended
// :user_id argument still binds the owner last per the placeholder
// convention; only the column name differs.
func sharingAuditSchemaStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS sharing_audit (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			actor_user_id TEXT NOT NULL,
			kind TEXT NOT NULL CHECK (kind IN ('policy-set', 'policy-strip', 'policies-cleared', 'grant', 'revoke', 'exclude', 'unexclude', 'index-rebuild', 'split-created', 'split-updated', 'split-accepted')),
			posting_id TEXT NOT NULL DEFAULT '',
			audience_type TEXT NOT NULL DEFAULT '',
			audience_id TEXT NOT NULL DEFAULT '',
			group_id TEXT NOT NULL DEFAULT '',
			detail_json TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS sharing_audit_owner ON sharing_audit(owner_user_id, created_at)`,
	}
}

// auditSharingRaw appends one consent audit row inside a raw (Database)
// transaction. All placeholders are positional.
func auditSharingRaw(tx *sql.Tx, ownerID, actor, kind, postingID, audienceType, audienceID, groupID, detail string) error {
	if _, err := tx.Exec(`INSERT INTO sharing_audit(owner_user_id, actor_user_id, kind, posting_id, audience_type, audience_id, group_id, detail_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		ownerID, actor, kind, postingID, audienceType, audienceID, groupID, detail, time.Now().Unix()); err != nil {
		return fmt.Errorf("audit sharing %s: %w", kind, err)
	}
	return nil
}

// auditSharingScoped appends one consent audit row inside a scoped
// (owner) transaction. The owner scope binds last per convention; the
// actor travels as an explicit positional argument.
func auditSharingScoped(tx *userTx, actor, kind, postingID, audienceType, audienceID, groupID, detail string) error {
	if _, err := tx.Exec(`INSERT INTO sharing_audit(actor_user_id, kind, posting_id, audience_type, audience_id, group_id, detail_json, created_at, owner_user_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, :user_id)`,
		actor, kind, postingID, audienceType, audienceID, groupID, detail, time.Now().Unix()); err != nil {
		return fmt.Errorf("audit sharing %s: %w", kind, err)
	}
	return nil
}

// policyAuditDetail renders before/after policy coverage for the audit log.
func policyAuditDetail(before, after store.SharingPolicy, hasBefore bool) string {
	coverage := func(policy store.SharingPolicy) map[string]any {
		return map[string]any{
			"enabled":  policy.Enabled,
			"accounts": policy.AccountIDs,
			"start":    policy.StartDate,
			"end":      policy.EndDate,
			"version":  policy.Version,
		}
	}
	entry := map[string]any{"after": coverage(after)}
	if hasBefore {
		entry["before"] = coverage(before)
	}
	encoded, err := json.Marshal(entry)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

// coveringVisibility returns one candidate per enabled policy covering the
// posting under the single store.PolicyCoversPosting rule. Deduplication
// by (posting, group) is structural: one policy exists per owner plus
// group, so at most one candidate names a group.
func coveringVisibility(policies []store.SharingPolicy, posting policyPosting) []store.SharingPolicy {
	var covering []store.SharingPolicy
	for _, policy := range policies {
		if policyPostingEligible(policy, posting) {
			covering = append(covering, policy)
		}
	}
	return covering
}

// loadOwnerEnabledPoliciesTx lists the owner's enabled policies in a scoped
// transaction. The scope placeholder stands alone, so no mixing applies.
func loadOwnerEnabledPoliciesTx(tx *userTx) ([]store.SharingPolicy, error) {
	rows, err := tx.Query(`SELECT owner_user_id, group_id, enabled, account_ids_json, start_date, end_date, version, updated_at FROM sharing_policies WHERE owner_user_id = :user_id AND enabled = 1 ORDER BY group_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var policies []store.SharingPolicy
	for rows.Next() {
		policy, err := scanSharingPolicy(rows)
		if err != nil {
			return nil, err
		}
		policies = append(policies, policy)
	}
	return policies, rows.Err()
}

// loadVisibilityPostingTx reads the eligibility columns of one scoped
// posting. The positional placeholder precedes the scope, per convention.
func loadVisibilityPostingTx(tx *userTx, postingID string) (policyPosting, error) {
	var posting policyPosting
	var source sql.NullString
	var destinationsJSON string
	var voided int
	posting.id = postingID
	err := tx.QueryRow(`SELECT source_account_id, destination_account_ids, transaction_time, void FROM postings WHERE id = ? AND user_id = :user_id`,
		postingID).Scan(&source, &destinationsJSON, &posting.txnTime, &voided)
	if err != nil {
		return policyPosting{}, err
	}
	if source.Valid {
		value := source.String
		posting.source = &value
	}
	if destinationsJSON != "" && destinationsJSON != "null" {
		if err := json.Unmarshal([]byte(destinationsJSON), &posting.destinations); err != nil {
			return policyPosting{}, fmt.Errorf("parse posting destinations: %w", err)
		}
	}
	posting.void = voided != 0
	return posting, nil
}

// refreshVisibilityForPostingTx re-derives one scoped posting's index rows
// in the caller's write transaction: stale rows go, then one row per
// currently covering enabled policy lands with its current version. A
// voided posting keeps its retained rows untouched (spec section 4): the
// live read gate denies void rows, and lazy cleanup removes the
// reference. A missing posting (delete paths that refresh after the
// delete) indexes nothing.
func refreshVisibilityForPostingTx(tx *userTx, postingID string) error {
	posting, err := loadVisibilityPostingTx(tx, postingID)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if posting.void {
		return nil
	}
	if _, err := tx.Exec(`DELETE FROM sharing_visibility WHERE posting_id = ? AND owner_user_id = :user_id`, postingID); err != nil {
		return fmt.Errorf("fence sharing visibility %s: %w", postingID, err)
	}
	policies, err := loadOwnerEnabledPoliciesTx(tx)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	for _, policy := range coveringVisibility(policies, posting) {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO sharing_visibility(posting_id, group_id, policy_version, updated_at, owner_user_id)
			VALUES (?, ?, ?, ?, :user_id)`,
			postingID, policy.GroupID, policy.Version, now); err != nil {
			return fmt.Errorf("index sharing visibility %s: %w", postingID, err)
		}
	}
	return nil
}

// deleteVisibilityForPostingTx drops one scoped posting's index rows. The
// positional placeholder precedes the scope, per convention.
func deleteVisibilityForPostingTx(tx *userTx, postingID string) error {
	if _, err := tx.Exec(`DELETE FROM sharing_visibility WHERE posting_id = ? AND owner_user_id = :user_id`, postingID); err != nil {
		return fmt.Errorf("clear sharing visibility %s: %w", postingID, err)
	}
	return nil
}

// deleteVisibilityForOwnerTx drops the scoped owner's whole index slice.
// The scope placeholder stands alone, so no mixing applies.
func deleteVisibilityForOwnerTx(tx *userTx) error {
	if _, err := tx.Exec(`DELETE FROM sharing_visibility WHERE owner_user_id = :user_id`); err != nil {
		return fmt.Errorf("clear sharing visibility: %w", err)
	}
	return nil
}

// loadPolicyPostingsRaw scans one owner's eligibility columns in a raw
// transaction. Positional placeholders only.
func loadPolicyPostingsRaw(tx *sql.Tx, ownerID string) ([]policyPosting, error) {
	rows, err := tx.Query(`SELECT id, source_account_id, destination_account_ids, transaction_time, void FROM postings WHERE user_id = ? ORDER BY id`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []policyPosting
	for rows.Next() {
		var posting policyPosting
		var source sql.NullString
		var destinationsJSON string
		var voided int
		if err := rows.Scan(&posting.id, &source, &destinationsJSON, &posting.txnTime, &voided); err != nil {
			return nil, err
		}
		if source.Valid {
			value := source.String
			posting.source = &value
		}
		if destinationsJSON != "" && destinationsJSON != "null" {
			if err := json.Unmarshal([]byte(destinationsJSON), &posting.destinations); err != nil {
				return nil, fmt.Errorf("parse posting destinations: %w", err)
			}
		}
		posting.void = voided != 0
		out = append(out, posting)
	}
	return out, rows.Err()
}

// loadPolicyPostingsScoped scans one scoped owner's eligibility columns.
// The scope placeholder stands alone, so no mixing applies.
func loadPolicyPostingsScoped(tx *userTx) ([]policyPosting, error) {
	rows, err := tx.Query(`SELECT id, source_account_id, destination_account_ids, transaction_time, void FROM postings WHERE user_id = :user_id ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []policyPosting
	for rows.Next() {
		var posting policyPosting
		var source sql.NullString
		var destinationsJSON string
		var voided int
		if err := rows.Scan(&posting.id, &source, &destinationsJSON, &posting.txnTime, &voided); err != nil {
			return nil, err
		}
		if source.Valid {
			value := source.String
			posting.source = &value
		}
		if destinationsJSON != "" && destinationsJSON != "null" {
			if err := json.Unmarshal([]byte(destinationsJSON), &posting.destinations); err != nil {
				return nil, fmt.Errorf("parse posting destinations: %w", err)
			}
		}
		posting.void = voided != 0
		out = append(out, posting)
	}
	return out, rows.Err()
}

// insertVisibilityRaw writes one reference row in a raw transaction.
// Positional placeholders only.
func insertVisibilityRaw(tx *sql.Tx, ownerID, postingID, groupID string, version, now int64) error {
	if _, err := tx.Exec(`INSERT OR IGNORE INTO sharing_visibility(owner_user_id, posting_id, group_id, policy_version, updated_at)
		VALUES (?, ?, ?, ?, ?)`, ownerID, postingID, groupID, version, now); err != nil {
		return fmt.Errorf("index sharing visibility %s: %w", postingID, err)
	}
	return nil
}

// insertVisibilityScoped writes one reference row in a scoped transaction.
// The owner scope binds last per convention.
func insertVisibilityScoped(tx *userTx, postingID, groupID string, version, now int64) error {
	if _, err := tx.Exec(`INSERT OR IGNORE INTO sharing_visibility(posting_id, group_id, policy_version, updated_at, owner_user_id)
		VALUES (?, ?, ?, ?, :user_id)`, postingID, groupID, version, now); err != nil {
		return fmt.Errorf("index sharing visibility %s: %w", postingID, err)
	}
	return nil
}

// ownerMemberGroupsRaw lists the groups where the owner currently holds
// membership. Rebuilds only index member audiences: restoring rows for an
// ended membership would mislead operators even though the list joins and
// the live gate still deny.
func ownerMemberGroupsRaw(tx *sql.Tx, ownerID string) (map[string]bool, error) {
	rows, err := tx.Query(`SELECT group_id FROM group_members WHERE user_id = ?`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	member := map[string]bool{}
	for rows.Next() {
		var group string
		if err := rows.Scan(&group); err != nil {
			return nil, err
		}
		member[group] = true
	}
	return member, rows.Err()
}

// rebuildVisibilityForOwnerGroupRaw re-derives one owner's index slice for
// one group in a raw transaction: old-version rows go first so the
// committed slice never mixes generations, then one row per currently
// covered non-void posting lands with the policy's current version. An
// absent or disabled policy, or an ended membership, leaves the slice
// empty. A rolled-back caller keeps its old slice; only live-covered
// postings for current memberships ever land.
func rebuildVisibilityForOwnerGroupRaw(tx *sql.Tx, ownerID, groupID string) error {
	if _, err := tx.Exec(`DELETE FROM sharing_visibility WHERE owner_user_id = ? AND group_id = ?`, ownerID, groupID); err != nil {
		return fmt.Errorf("fence sharing visibility: %w", err)
	}
	member, err := ownerMemberGroupsRaw(tx, ownerID)
	if err != nil {
		return err
	}
	if !member[groupID] {
		return nil
	}
	policy, err := scanSharingPolicy(tx.QueryRow(
		`SELECT owner_user_id, group_id, enabled, account_ids_json, start_date, end_date, version, updated_at FROM sharing_policies WHERE owner_user_id = ? AND group_id = ?`,
		ownerID, groupID))
	if err == sql.ErrNoRows || (err == nil && !policy.Enabled) {
		return nil
	}
	if err != nil {
		return err
	}
	postings, err := loadPolicyPostingsRaw(tx, ownerID)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	for _, posting := range postings {
		if posting.void {
			continue
		}
		for _, covering := range coveringVisibility([]store.SharingPolicy{policy}, posting) {
			if err := insertVisibilityRaw(tx, ownerID, posting.id, covering.GroupID, covering.Version, now); err != nil {
				return err
			}
		}
	}
	return nil
}

// rebuildVisibilityForOwnerGroupScoped re-derives one scoped owner's index
// slice for one group in the caller's write transaction, with the same
// fence-first semantics as the raw variant. The group travels positionally
// while the owner scope binds last per convention.
func rebuildVisibilityForOwnerGroupScoped(tx *userTx, groupID string) error {
	if _, err := tx.Exec(`DELETE FROM sharing_visibility WHERE group_id = ? AND owner_user_id = :user_id`, groupID); err != nil {
		return fmt.Errorf("fence sharing visibility: %w", err)
	}
	var role string
	err := tx.QueryRow(`SELECT role FROM group_members WHERE group_id = ? AND user_id = :user_id`, groupID).Scan(&role)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	policy, err := scanSharingPolicy(tx.QueryRow(
		`SELECT owner_user_id, group_id, enabled, account_ids_json, start_date, end_date, version, updated_at FROM sharing_policies WHERE group_id = ? AND owner_user_id = :user_id`,
		groupID))
	if err == sql.ErrNoRows || (err == nil && !policy.Enabled) {
		return nil
	}
	if err != nil {
		return err
	}
	postings, err := loadPolicyPostingsScoped(tx)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	for _, posting := range postings {
		if posting.void {
			continue
		}
		for _, covering := range coveringVisibility([]store.SharingPolicy{policy}, posting) {
			if err := insertVisibilityScoped(tx, posting.id, covering.GroupID, covering.Version, now); err != nil {
				return err
			}
		}
	}
	return nil
}

// deleteVisibilityForOwnerGroupRaw drops one owner's index slice for one
// group in a raw transaction: membership end fences list discovery
// immediately while live reads deny through missing membership anyway.
func deleteVisibilityForOwnerGroupRaw(tx *sql.Tx, ownerID, groupID string) error {
	if _, err := tx.Exec(`DELETE FROM sharing_visibility WHERE owner_user_id = ? AND group_id = ?`, ownerID, groupID); err != nil {
		return fmt.Errorf("clear sharing visibility: %w", err)
	}
	return nil
}

// deleteVisibilityForGroupRaw drops a dead group's whole index slice in a
// raw transaction. Positional placeholders only.
func deleteVisibilityForGroupRaw(tx *sql.Tx, groupID string) error {
	if _, err := tx.Exec(`DELETE FROM sharing_visibility WHERE group_id = ?`, groupID); err != nil {
		return fmt.Errorf("clear sharing visibility: %w", err)
	}
	return nil
}

// deleteVisibilityForOwnerRaw drops one owner's whole index slice in a raw
// transaction. Positional placeholders only.
func deleteVisibilityForOwnerRaw(tx *sql.Tx, ownerID string) error {
	if _, err := tx.Exec(`DELETE FROM sharing_visibility WHERE owner_user_id = ?`, ownerID); err != nil {
		return fmt.Errorf("clear sharing visibility: %w", err)
	}
	return nil
}

// RebuildSharingIndex re-derives one owner's whole visibility index from
// live policies and postings in one transaction: concurrent readers keep
// seeing the pre-rebuild slice until commit, and a crash rolls back to
// it. Only live-covered postings for current memberships land, so a
// rebuild never over-shares. Operator recovery and tests use this; normal
// writes maintain the index incrementally instead.
func (d *Database) RebuildSharingIndex(ownerID string) error {
	if !validSharingUserID(ownerID) {
		return fmt.Errorf("%w: owner must be a user ID", store.ErrGroupInvalid)
	}
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var users int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, ownerID).Scan(&users); err != nil {
		return err
	}
	if users != 1 {
		return store.ErrNotFound
	}
	if err := deleteVisibilityForOwnerRaw(tx, ownerID); err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT owner_user_id, group_id, enabled, account_ids_json, start_date, end_date, version, updated_at FROM sharing_policies WHERE owner_user_id = ? AND enabled = 1 ORDER BY group_id`, ownerID)
	if err != nil {
		return err
	}
	var policies []store.SharingPolicy
	for rows.Next() {
		policy, err := scanSharingPolicy(rows)
		if err != nil {
			rows.Close()
			return err
		}
		policies = append(policies, policy)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if len(policies) == 0 {
		return tx.Commit()
	}
	member, err := ownerMemberGroupsRaw(tx, ownerID)
	if err != nil {
		return err
	}
	postings, err := loadPolicyPostingsRaw(tx, ownerID)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	for _, posting := range postings {
		if posting.void {
			continue
		}
		for _, policy := range coveringVisibility(policies, posting) {
			if !member[policy.GroupID] {
				continue
			}
			if err := insertVisibilityRaw(tx, ownerID, posting.id, policy.GroupID, policy.Version, now); err != nil {
				return err
			}
		}
	}
	if err := auditSharingRaw(tx, ownerID, ownerID, "index-rebuild", "", "", "", "", fmt.Sprintf(`{"policies":%d,"postings":%d}`, len(policies), len(postings))); err != nil {
		return err
	}
	return tx.Commit()
}
