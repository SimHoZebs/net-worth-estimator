// Materialized group-share visibility index (GRP-05). One row references
// one owner transaction for one group audience at one policy version: no
// financial payload is copied, and at most one reference exists per
// transaction plus group however many selected accounts match.
//
// The index is discovery only, never authorization. Every shared read
// re-validates through CheckSharedTransactionAccess over live rows, so a
// stale or missing reference can under-share but never over-share:
// extra rows deny at the live gate, missing rows only hide list entries
// while detail reads still evaluate the live rule.
//
// Maintenance is same-write: every statement below runs inside the
// transaction that mutates transactions, policies, accounts, memberships, or
// consent, or the mutation fails. Policy changes bump the policy version
// first, then old-version rows are deleted and current rows rewritten in
// the same transaction, so revocation fences on commit. Bulk rebuilds
// delete before re-deriving and insert only live-covered transactions, so an
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
			transaction_id TEXT NOT NULL,
			group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
			policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (owner_user_id, transaction_id, group_id)
		)`,
		`CREATE INDEX IF NOT EXISTS sharing_visibility_group ON sharing_visibility(group_id, owner_user_id, transaction_id)`,
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
			kind TEXT NOT NULL CHECK (kind IN ('policy-set', 'policy-strip', 'policies-cleared', 'grant', 'revoke', 'exclude', 'unexclude', 'index-rebuild', 'copy-accepted', 'link-refreshed', 'split-created', 'split-updated', 'split-accepted')),
			transaction_id TEXT NOT NULL DEFAULT '',
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
// transaction. All placeholders are positional. It accepts the shared
// storage surface so social-operation audit rows commit alongside the
// mutation whether the caller holds a transaction or the pool handle.
func auditSharingRaw(db sharingStorage, ownerID, actor, kind, transactionID, audienceType, audienceID, groupID, detail string) error {
	if _, err := db.Exec(`INSERT INTO sharing_audit(owner_user_id, actor_user_id, kind, transaction_id, audience_type, audience_id, group_id, detail_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		ownerID, actor, kind, transactionID, audienceType, audienceID, groupID, detail, time.Now().Unix()); err != nil {
		return fmt.Errorf("audit sharing %s: %w", kind, err)
	}
	return nil
}

// shareAuditDetail carries the accepted-copy link, the link-refresh
// outcome status, and the idempotency key inside the landed audit detail
// payload. Split rows reuse the same shape for the split link, resulting
// status, and request key. Actions that name none leave their fields
// empty. It carries identities only, never transaction evidence.
type shareAuditDetail struct {
	Link      string `json:"link,omitempty"`
	Status    string `json:"status,omitempty"`
	RequestID string `json:"requestId,omitempty"`
}

// auditShareEvent appends one social-operation audit row through the
// landed consent shape: actor, kind, owner-scoped target, and audience
// columns for consent rows, with link, status, and request key inside the
// detail payload decoded by ListSharingAudit.
func auditShareEvent(db sharingStorage, ownerID, actor, kind, transactionID, audienceType, audienceID, linkID, status, requestID string) error {
	detail, err := json.Marshal(shareAuditDetail{Link: linkID, Status: status, RequestID: requestID})
	if err != nil {
		return err
	}
	return auditSharingRaw(db, ownerID, actor, kind, transactionID, audienceType, audienceID, "", string(detail))
}

// auditSharingScoped appends one consent audit row inside a scoped
// (owner) transaction. The owner scope binds last per convention; the
// actor travels as an explicit positional argument.
func auditSharingScoped(tx *userTx, actor, kind, transactionID, audienceType, audienceID, groupID, detail string) error {
	if _, err := tx.Exec(`INSERT INTO sharing_audit(actor_user_id, kind, transaction_id, audience_type, audience_id, group_id, detail_json, created_at, owner_user_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, :user_id)`,
		actor, kind, transactionID, audienceType, audienceID, groupID, detail, time.Now().Unix()); err != nil {
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
// transaction under the single store.PolicyCoversTransaction rule. Deduplication
// by (transaction, group) is structural: one policy exists per owner plus
// group, so at most one candidate names a group.
func coveringVisibility(policies []store.SharingPolicy, transaction policyTransaction) []store.SharingPolicy {
	var covering []store.SharingPolicy
	for _, policy := range policies {
		if policyTransactionEligible(policy, transaction) {
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

// loadVisibilityTransactionTx reads the eligibility columns of one scoped
// transaction. The positional placeholder precedes the scope, per convention.
func loadVisibilityTransactionTx(tx *userTx, transactionID string) (policyTransaction, error) {
	var transaction policyTransaction
	var source sql.NullString
	var destinationsJSON string
	var voided int
	transaction.id = transactionID
	err := tx.QueryRow(`SELECT source_account_id, destination_account_ids, transaction_time, void FROM transactions WHERE id = ? AND user_id = :user_id`,
		transactionID).Scan(&source, &destinationsJSON, &transaction.txnTime, &voided)
	if err != nil {
		return policyTransaction{}, err
	}
	if source.Valid {
		value := source.String
		transaction.source = &value
	}
	if destinationsJSON != "" && destinationsJSON != "null" {
		if err := json.Unmarshal([]byte(destinationsJSON), &transaction.destinations); err != nil {
			return policyTransaction{}, fmt.Errorf("parse transaction destinations: %w", err)
		}
	}
	transaction.void = voided != 0
	return transaction, nil
}

// refreshVisibilityForTransactionTx re-derives one scoped transaction's index rows
// in the caller's write transaction: stale rows go, then one row per
// currently covering enabled policy lands with its current version. A
// voided transaction keeps its retained rows untouched (spec section 4): the
// live read gate denies void rows, and lazy cleanup removes the
// reference. A missing transaction (delete paths that refresh after the
// delete) indexes nothing.
func refreshVisibilityForTransactionTx(tx *userTx, transactionID string) error {
	transaction, err := loadVisibilityTransactionTx(tx, transactionID)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if transaction.void {
		return nil
	}
	if _, err := tx.Exec(`DELETE FROM sharing_visibility WHERE transaction_id = ? AND owner_user_id = :user_id`, transactionID); err != nil {
		return fmt.Errorf("fence sharing visibility %s: %w", transactionID, err)
	}
	policies, err := loadOwnerEnabledPoliciesTx(tx)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	for _, policy := range coveringVisibility(policies, transaction) {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO sharing_visibility(transaction_id, group_id, policy_version, updated_at, owner_user_id)
			VALUES (?, ?, ?, ?, :user_id)`,
			transactionID, policy.GroupID, policy.Version, now); err != nil {
			return fmt.Errorf("index sharing visibility %s: %w", transactionID, err)
		}
	}
	return nil
}

// deleteVisibilityForTransactionTx drops one scoped transaction's index rows. The
// positional placeholder precedes the scope, per convention.
func deleteVisibilityForTransactionTx(tx *userTx, transactionID string) error {
	if _, err := tx.Exec(`DELETE FROM sharing_visibility WHERE transaction_id = ? AND owner_user_id = :user_id`, transactionID); err != nil {
		return fmt.Errorf("clear sharing visibility %s: %w", transactionID, err)
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

// loadPolicyTransactionsRaw scans one owner's eligibility columns in a raw
// transaction. Positional placeholders only.
func loadPolicyTransactionsRaw(tx *sql.Tx, ownerID string) ([]policyTransaction, error) {
	rows, err := tx.Query(`SELECT id, source_account_id, destination_account_ids, transaction_time, void FROM transactions WHERE user_id = ? ORDER BY id`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []policyTransaction
	for rows.Next() {
		var transaction policyTransaction
		var source sql.NullString
		var destinationsJSON string
		var voided int
		if err := rows.Scan(&transaction.id, &source, &destinationsJSON, &transaction.txnTime, &voided); err != nil {
			return nil, err
		}
		if source.Valid {
			value := source.String
			transaction.source = &value
		}
		if destinationsJSON != "" && destinationsJSON != "null" {
			if err := json.Unmarshal([]byte(destinationsJSON), &transaction.destinations); err != nil {
				return nil, fmt.Errorf("parse transaction destinations: %w", err)
			}
		}
		transaction.void = voided != 0
		out = append(out, transaction)
	}
	return out, rows.Err()
}

// loadPolicyTransactionsScoped scans one scoped owner's eligibility columns.
// The scope placeholder stands alone, so no mixing applies.
func loadPolicyTransactionsScoped(tx *userTx) ([]policyTransaction, error) {
	rows, err := tx.Query(`SELECT id, source_account_id, destination_account_ids, transaction_time, void FROM transactions WHERE user_id = :user_id ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []policyTransaction
	for rows.Next() {
		var transaction policyTransaction
		var source sql.NullString
		var destinationsJSON string
		var voided int
		if err := rows.Scan(&transaction.id, &source, &destinationsJSON, &transaction.txnTime, &voided); err != nil {
			return nil, err
		}
		if source.Valid {
			value := source.String
			transaction.source = &value
		}
		if destinationsJSON != "" && destinationsJSON != "null" {
			if err := json.Unmarshal([]byte(destinationsJSON), &transaction.destinations); err != nil {
				return nil, fmt.Errorf("parse transaction destinations: %w", err)
			}
		}
		transaction.void = voided != 0
		out = append(out, transaction)
	}
	return out, rows.Err()
}

// insertVisibilityRaw writes one reference row in a raw transaction.
// Positional placeholders only.
func insertVisibilityRaw(tx *sql.Tx, ownerID, transactionID, groupID string, version, now int64) error {
	if _, err := tx.Exec(`INSERT OR IGNORE INTO sharing_visibility(owner_user_id, transaction_id, group_id, policy_version, updated_at)
		VALUES (?, ?, ?, ?, ?)`, ownerID, transactionID, groupID, version, now); err != nil {
		return fmt.Errorf("index sharing visibility %s: %w", transactionID, err)
	}
	return nil
}

// insertVisibilityScoped writes one reference row in a scoped transaction.
// The owner scope binds last per convention.
func insertVisibilityScoped(tx *userTx, transactionID, groupID string, version, now int64) error {
	if _, err := tx.Exec(`INSERT OR IGNORE INTO sharing_visibility(transaction_id, group_id, policy_version, updated_at, owner_user_id)
		VALUES (?, ?, ?, ?, :user_id)`, transactionID, groupID, version, now); err != nil {
		return fmt.Errorf("index sharing visibility %s: %w", transactionID, err)
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
// covered non-void transaction lands with the policy's current version. An
// absent or disabled policy, or an ended membership, leaves the slice
// empty. A rolled-back caller keeps its old slice; only live-covered
// transactions for current memberships ever land.
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
	transactions, err := loadPolicyTransactionsRaw(tx, ownerID)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	for _, transaction := range transactions {
		if transaction.void {
			continue
		}
		for _, covering := range coveringVisibility([]store.SharingPolicy{policy}, transaction) {
			if err := insertVisibilityRaw(tx, ownerID, transaction.id, covering.GroupID, covering.Version, now); err != nil {
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
	transactions, err := loadPolicyTransactionsScoped(tx)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	for _, transaction := range transactions {
		if transaction.void {
			continue
		}
		for _, covering := range coveringVisibility([]store.SharingPolicy{policy}, transaction) {
			if err := insertVisibilityScoped(tx, transaction.id, covering.GroupID, covering.Version, now); err != nil {
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
// live policies and transactions in one transaction: concurrent readers keep
// seeing the pre-rebuild slice until commit, and a crash rolls back to
// it. Only live-covered transactions for current memberships land, so a
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
	transactions, err := loadPolicyTransactionsRaw(tx, ownerID)
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	for _, transaction := range transactions {
		if transaction.void {
			continue
		}
		for _, policy := range coveringVisibility(policies, transaction) {
			if !member[policy.GroupID] {
				continue
			}
			if err := insertVisibilityRaw(tx, ownerID, transaction.id, policy.GroupID, policy.Version, now); err != nil {
				return err
			}
		}
	}
	if err := auditSharingRaw(tx, ownerID, ownerID, "index-rebuild", "", "", "", "", fmt.Sprintf(`{"policies":%d,"transactions":%d}`, len(policies), len(transactions))); err != nil {
		return err
	}
	return tx.Commit()
}
