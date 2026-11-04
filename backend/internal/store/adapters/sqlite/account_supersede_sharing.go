package sqlite

import (
	"encoding/json"
	"fmt"
	"time"
)

func replaceSharingPolicyAccount(tx *userTx, oldID, newID string) error {
	rows, err := tx.Query(`SELECT group_id, account_ids_json, version FROM sharing_policies WHERE owner_user_id = :user_id`)
	if err != nil {
		return err
	}
	type replacedPolicy struct {
		group         string
		before, after []string
		version       int64
	}
	var touched []replacedPolicy
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
		if !supersedeContains(accounts, oldID) {
			continue
		}
		before := append([]string(nil), accounts...)
		after := supersedeReplaceIDs(accounts, oldID, newID)
		touched = append(touched, replacedPolicy{group: group, before: before, after: after, version: version + 1})
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
			return fmt.Errorf("replace sharing account %s: %w", oldID, err)
		}
		if err := rebuildVisibilityForOwnerGroupScoped(tx, item.group); err != nil {
			return err
		}
		beforeJSON, _ := json.Marshal(map[string]any{"accounts": item.before})
		afterJSON, _ := json.Marshal(map[string]any{"accounts": item.after, "version": item.version})
		if err := auditSharingScoped(tx, tx.userID, "policy-set", "", "", "", item.group,
			fmt.Sprintf(`{"reason":"account-superseded","before":%s,"after":%s,"replaced_account":%q,"replacement_account":%q}`, beforeJSON, afterJSON, oldID, newID)); err != nil {
			return err
		}
	}
	return nil
}
