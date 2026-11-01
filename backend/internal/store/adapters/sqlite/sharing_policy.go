// Automatic sharing-policy storage (GRP-02). One row is one member's
// preference for one group: enabled flag (default off by absence),
// selected owner-held accounts, a single transaction-date interval, and a
// version bumped on every committed change for stale-generation fencing.
// Eligibility itself derives live from current posting rows through
// store.PolicyCoversPosting; no per-posting state is stored here.
package sqlite

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// sharingPolicySchemaStatements creates the per-member preference table.
// Account IDs are a JSON list validated against the owner's accounts at
// write time; dangling IDs after account deletion match nothing. Group
// deletion cascades (backstopped by explicit cleanup in
// deleteGroupSharingRows); user deletion cascades with the user.
func sharingPolicySchemaStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS sharing_policies (
			owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			group_id TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
			enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
			account_ids_json TEXT NOT NULL DEFAULT '[]',
			start_date TEXT NOT NULL DEFAULT '',
			end_date TEXT NOT NULL DEFAULT '',
			version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (owner_user_id, group_id)
		)`,
		`CREATE INDEX IF NOT EXISTS sharing_policies_group ON sharing_policies(group_id, enabled)`,
	}
}

func scanSharingPolicy(scanner interface {
	Scan(dest ...any) error
}) (store.SharingPolicy, error) {
	var policy store.SharingPolicy
	var enabled int
	var accountsJSON string
	if err := scanner.Scan(&policy.OwnerUserID, &policy.GroupID, &enabled, &accountsJSON, &policy.StartDate, &policy.EndDate, &policy.Version, &policy.UpdatedAt); err != nil {
		return store.SharingPolicy{}, err
	}
	policy.Enabled = enabled != 0
	if err := json.Unmarshal([]byte(accountsJSON), &policy.AccountIDs); err != nil {
		return store.SharingPolicy{}, fmt.Errorf("parse sharing policy accounts: %w", err)
	}
	if policy.AccountIDs == nil {
		policy.AccountIDs = []string{}
	}
	return policy, nil
}

// requirePolicyMember rejects policy writes from non-members without
// distinguishing missing groups from foreign ones: both read 404, matching
// the group read contract.
func requirePolicyMember(tx *sql.Tx, groupID, ownerID string) error {
	var groups int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM user_groups WHERE id = ?`, groupID).Scan(&groups); err != nil {
		return err
	}
	if groups != 1 {
		return store.ErrNotFound
	}
	var role string
	if err := tx.QueryRow(`SELECT role FROM group_members WHERE group_id = ? AND user_id = ?`, groupID, ownerID).Scan(&role); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return store.ErrNotFound
		}
		return err
	}
	return nil
}

// SetSharingPolicy creates or replaces one member's preference in one
// transaction: membership, account ownership, and interval validation run
// with the version-bumped write, so disable/narrow revokes automatic
// access on commit. The same transaction fences the old index generation
// and re-derives the (owner, group) slice at the new version, and appends
// one audit row with before/after coverage.
func (d *Database) SetSharingPolicy(ownerID, groupID string, input store.SharingPolicyInput) (store.SharingPolicy, error) {
	if !validSharingUserID(ownerID) {
		return store.SharingPolicy{}, fmt.Errorf("%w: policy owner must be a user ID", store.ErrGroupInvalid)
	}
	if !validSharingGroupID(groupID) {
		return store.SharingPolicy{}, fmt.Errorf("%w: policy group must be a group ID", store.ErrGroupInvalid)
	}
	normalized, err := store.NormalizeSharingPolicyInput(input)
	if err != nil {
		return store.SharingPolicy{}, fmt.Errorf("%w: %v", store.ErrGroupInvalid, err)
	}
	tx, err := d.db.Begin()
	if err != nil {
		return store.SharingPolicy{}, err
	}
	defer tx.Rollback()
	var users int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM users WHERE id = ?`, ownerID).Scan(&users); err != nil {
		return store.SharingPolicy{}, err
	}
	if users != 1 {
		return store.SharingPolicy{}, store.ErrNotFound
	}
	if err := requirePolicyMember(tx, groupID, ownerID); err != nil {
		return store.SharingPolicy{}, err
	}
	for _, accountID := range normalized.AccountIDs {
		var accounts int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM accounts WHERE user_id = ? AND id = ?`, ownerID, accountID).Scan(&accounts); err != nil {
			return store.SharingPolicy{}, err
		}
		if accounts != 1 {
			return store.SharingPolicy{}, fmt.Errorf("%w: unknown sharing account %q", store.ErrGroupInvalid, accountID)
		}
	}
	accountsJSON, err := json.Marshal(normalized.AccountIDs)
	if err != nil {
		return store.SharingPolicy{}, fmt.Errorf("encode sharing policy accounts: %w", err)
	}
	var version int64
	err = tx.QueryRow(`SELECT version FROM sharing_policies WHERE owner_user_id = ? AND group_id = ?`, ownerID, groupID).Scan(&version)
	switch {
	case err == nil:
		version++
	case errors.Is(err, sql.ErrNoRows):
		version = 1
	default:
		return store.SharingPolicy{}, err
	}
	var before store.SharingPolicy
	hasBefore := false
	if existing, err := scanSharingPolicy(tx.QueryRow(
		`SELECT owner_user_id, group_id, enabled, account_ids_json, start_date, end_date, version, updated_at FROM sharing_policies WHERE owner_user_id = ? AND group_id = ?`,
		ownerID, groupID)); err == nil {
		before, hasBefore = existing, true
	} else if !errors.Is(err, sql.ErrNoRows) {
		return store.SharingPolicy{}, err
	}
	now := time.Now().Unix()
	if _, err := tx.Exec(`INSERT INTO sharing_policies(owner_user_id, group_id, enabled, account_ids_json, start_date, end_date, version, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(owner_user_id, group_id) DO UPDATE SET enabled = excluded.enabled, account_ids_json = excluded.account_ids_json,
			start_date = excluded.start_date, end_date = excluded.end_date, version = excluded.version, updated_at = excluded.updated_at`,
		ownerID, groupID, boolToInt(normalized.Enabled), string(accountsJSON), normalized.StartDate, normalized.EndDate, version, now); err != nil {
		return store.SharingPolicy{}, fmt.Errorf("record sharing policy: %w", err)
	}
	policy := store.SharingPolicy{
		OwnerUserID: ownerID, GroupID: groupID, Enabled: normalized.Enabled,
		AccountIDs: normalized.AccountIDs, StartDate: normalized.StartDate,
		EndDate: normalized.EndDate, Version: version, UpdatedAt: now,
	}
	if err := rebuildVisibilityForOwnerGroupRaw(tx, ownerID, groupID); err != nil {
		return store.SharingPolicy{}, err
	}
	if err := auditSharingRaw(tx, ownerID, ownerID, "policy-set", "", "", "", groupID, policyAuditDetail(before, policy, hasBefore)); err != nil {
		return store.SharingPolicy{}, err
	}
	if err := tx.Commit(); err != nil {
		return store.SharingPolicy{}, err
	}
	return policy, nil
}

// GetSharingPolicy returns one member's stored preference. Absence reports
// ErrNotFound and means automatic sharing is off.
func (d *Database) GetSharingPolicy(ownerID, groupID string) (store.SharingPolicy, error) {
	if !validSharingUserID(ownerID) || !validSharingGroupID(groupID) {
		return store.SharingPolicy{}, fmt.Errorf("%w: policy owner and group must identify one preference", store.ErrGroupInvalid)
	}
	policy, err := scanSharingPolicy(d.db.QueryRow(
		`SELECT owner_user_id, group_id, enabled, account_ids_json, start_date, end_date, version, updated_at FROM sharing_policies WHERE owner_user_id = ? AND group_id = ?`,
		ownerID, groupID))
	if errors.Is(err, sql.ErrNoRows) {
		return store.SharingPolicy{}, store.ErrNotFound
	}
	return policy, err
}

// ListSharingPolicies returns every stored preference for one member in
// stable group order.
func (d *Database) ListSharingPolicies(ownerID string) ([]store.SharingPolicy, error) {
	if !validSharingUserID(ownerID) {
		return nil, fmt.Errorf("%w: policy owner must be a user ID", store.ErrGroupInvalid)
	}
	rows, err := d.db.Query(`SELECT owner_user_id, group_id, enabled, account_ids_json, start_date, end_date, version, updated_at FROM sharing_policies WHERE owner_user_id = ? ORDER BY group_id`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	policies := []store.SharingPolicy{}
	for rows.Next() {
		policy, err := scanSharingPolicy(rows)
		if err != nil {
			return nil, err
		}
		policies = append(policies, policy)
	}
	return policies, rows.Err()
}

// policyPosting carries the columns eligibility needs without the amount
// payload: preview and list paths must never move financial content. It
// converts to a minimal types.Posting so every path evaluates through the
// single store.PolicyCoversPosting contract.
type policyPosting struct {
	id           string
	source       *string
	destinations []string
	txnTime      int64
	void         bool
}

func (p policyPosting) toPosting() types.Posting {
	return types.Posting{
		ID:              p.id,
		SourceAccountID: p.source,
		Destinations:    p.destinations,
		TransactionTime: p.txnTime,
		Void:            p.void,
	}
}

func loadPolicyPostings(db *sql.DB, ownerID string) ([]policyPosting, error) {
	rows, err := db.Query(`SELECT id, source_account_id, destination_account_ids, transaction_time, void FROM postings WHERE user_id = ?`, ownerID)
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

func policyPostingEligible(policy store.SharingPolicy, posting policyPosting) bool {
	return store.PolicyCoversPosting(policy, posting.toPosting())
}

// PreviewSharingPolicy counts the currently eligible postings for one
// member's stored policy plus the current audience size. Existing and
// late-imported in-range rows qualify alike; there is no sync-date filter.
// The caller (consent UI) pairs these counts with the historical-disclosure
// warning before enabling.
func (d *Database) PreviewSharingPolicy(ownerID, groupID string) (store.SharingPolicyPreview, error) {
	policy, err := d.GetSharingPolicy(ownerID, groupID)
	if err != nil {
		return store.SharingPolicyPreview{}, err
	}
	postings, err := loadPolicyPostings(d.db, ownerID)
	if err != nil {
		return store.SharingPolicyPreview{}, err
	}
	eligible := 0
	for _, posting := range postings {
		if policyPostingEligible(policy, posting) {
			eligible++
		}
	}
	var members int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM group_members WHERE group_id = ?`, groupID).Scan(&members); err != nil {
		return store.SharingPolicyPreview{}, err
	}
	return store.SharingPolicyPreview{
		OwnerUserID: policy.OwnerUserID, GroupID: policy.GroupID, Enabled: policy.Enabled,
		AccountIDs: policy.AccountIDs, StartDate: policy.StartDate, EndDate: policy.EndDate,
		Version: policy.Version, EligiblePostings: eligible, MemberCount: members,
	}, nil
}

// stripSharingPolicyAccount removes one deleted account from the owner's
// policies in the same write, bumping each touched version so stale
// generations fence immediately. A policy narrowed to zero accounts keeps
// its row and flag but matches nothing. Each touched (owner, group) index
// slice is re-derived at the bumped version in the same transaction, and
// one audit row per touched policy records before/after coverage.
func stripSharingPolicyAccount(tx *userTx, accountID string) error {
	rows, err := tx.Query(`SELECT group_id, account_ids_json, version FROM sharing_policies WHERE owner_user_id = :user_id`)
	if err != nil {
		return err
	}
	type stripped struct {
		group         string
		before, after []string
		version       int64
	}
	var touched []stripped
	for rows.Next() {
		var group, accountsJSON string
		var version int64
		if err := rows.Scan(&group, &accountsJSON, &version); err != nil {
			rows.Close()
			return err
		}
		var accounts []string
		if err := json.Unmarshal([]byte(accountsJSON), &accounts); err != nil {
			rows.Close()
			return fmt.Errorf("parse sharing policy accounts: %w", err)
		}
		// Snapshot before filtering: kept compacts a fresh slice so the
		// audit's before-coverage keeps the original selection.
		before := append([]string(nil), accounts...)
		kept := make([]string, 0, len(accounts))
		removed := false
		for _, id := range accounts {
			if id == accountID {
				removed = true
				continue
			}
			kept = append(kept, id)
		}
		if removed {
			if kept == nil {
				kept = []string{}
			}
			touched = append(touched, stripped{group: group, before: before, after: kept, version: version + 1})
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	now := time.Now().Unix()
	for _, item := range touched {
		encoded, err := json.Marshal(item.after)
		if err != nil {
			return fmt.Errorf("encode sharing policy accounts: %w", err)
		}
		if _, err := tx.Exec(`UPDATE sharing_policies SET account_ids_json = ?, version = ?, updated_at = ? WHERE group_id = ? AND owner_user_id = :user_id`,
			string(encoded), item.version, now, item.group); err != nil {
			return fmt.Errorf("strip sharing account %s: %w", accountID, err)
		}
		if err := rebuildVisibilityForOwnerGroupScoped(tx, item.group); err != nil {
			return err
		}
		before, after := item.before, item.after
		if before == nil {
			before = []string{}
		}
		if after == nil {
			after = []string{}
		}
		beforeJSON, _ := json.Marshal(map[string]any{"accounts": before})
		afterJSON, _ := json.Marshal(map[string]any{"accounts": after, "version": item.version})
		if err := auditSharingScoped(tx, tx.userID, "policy-strip", "", "", "", item.group,
			fmt.Sprintf(`{"before":%s,"after":%s,"stripped_account":%q}`, beforeJSON, afterJSON, accountID)); err != nil {
			return err
		}
	}
	return nil
}

// automaticPolicyAccess evaluates the policy-derived automatic reason for
// one posting: an enabled policy of the owner for a group where both the
// owner and the requester hold current membership, covering the posting's
// current accounts and transaction date. Exclusions are checked by the
// caller before this runs, so a surviving policy always composes under
// them, never over them.
func (d *Database) automaticPolicyAccess(ownerID, postingID, requesterID string) (store.SharedPostingAccess, error) {
	denied := store.SharedPostingAccess{Allowed: false}
	rows, err := d.db.Query(`SELECT sp.owner_user_id, sp.group_id, sp.enabled, sp.account_ids_json, sp.start_date, sp.end_date, sp.version, sp.updated_at
		FROM sharing_policies sp
		JOIN group_members requester ON requester.group_id = sp.group_id AND requester.user_id = ?
		JOIN group_members owner ON owner.group_id = sp.group_id AND owner.user_id = sp.owner_user_id
		WHERE sp.owner_user_id = ? AND sp.enabled = 1`, requesterID, ownerID)
	if err != nil {
		return denied, err
	}
	var policies []store.SharingPolicy
	for rows.Next() {
		policy, err := scanSharingPolicy(rows)
		if err != nil {
			rows.Close()
			return denied, err
		}
		policies = append(policies, policy)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return denied, err
	}
	rows.Close()
	if len(policies) == 0 {
		return denied, nil
	}
	var source sql.NullString
	var destinationsJSON string
	var txnTime int64
	var voided int
	err = d.db.QueryRow(`SELECT source_account_id, destination_account_ids, transaction_time, void FROM postings WHERE user_id = ? AND id = ?`,
		ownerID, postingID).Scan(&source, &destinationsJSON, &txnTime, &voided)
	if errors.Is(err, sql.ErrNoRows) {
		return denied, nil
	}
	if err != nil {
		return denied, err
	}
	posting := policyPosting{txnTime: txnTime, void: voided != 0}
	if source.Valid {
		value := source.String
		posting.source = &value
	}
	if destinationsJSON != "" && destinationsJSON != "null" {
		if err := json.Unmarshal([]byte(destinationsJSON), &posting.destinations); err != nil {
			return denied, fmt.Errorf("parse posting destinations: %w", err)
		}
	}
	for _, policy := range policies {
		if policyPostingEligible(policy, posting) {
			return store.SharedPostingAccess{Allowed: true, Reason: store.SharingPolicyReasonAutomatic}, nil
		}
	}
	return denied, nil
}

// deleteGroupSharingPolicies drops preference rows naming a deleted group
// audience in the same transaction as the group delete. Reads already deny
// through missing membership; this keeps policy lists from surfacing dead
// audiences. Group deletion also cascades to this table as a backstop.
func deleteGroupSharingPolicies(tx *sql.Tx, groupID string) error {
	if _, err := tx.Exec(`DELETE FROM sharing_policies WHERE group_id = ?`, groupID); err != nil {
		return fmt.Errorf("clear group sharing policies: %w", err)
	}
	return nil
}

// clearSharingPoliciesForUser removes preferences the user issued when
// their model is replaced or cleared: post-import account IDs are new
// rows, and old selections must not attach to them.
func clearSharingPoliciesForUser(tx *userTx) error {
	if _, err := tx.Exec(`DELETE FROM sharing_policies WHERE owner_user_id = :user_id`); err != nil {
		return fmt.Errorf("clear sharing policies: %w", err)
	}
	return nil
}
