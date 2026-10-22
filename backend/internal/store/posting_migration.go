package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// migratePostingIdentity runs only as part of Open's schema transaction.
// Prefix knowledge is confined to this one-way upgrade, never runtime policy.
func migratePostingIdentity(tx *sql.Tx) error {
	const migration = "posting-uuid-and-pending-v1"
	var applied int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE name = ?`, migration).Scan(&applied); err != nil {
		return err
	}
	if applied != 0 {
		return nil
	}
	columns, err := tx.Query(`PRAGMA table_info(postings)`)
	if err != nil {
		return err
	}
	hasPending := false
	hasExecutionOrder := false
	for columns.Next() {
		var cid, notNull, primaryKey int
		var name, kind string
		var defaultValue any
		if err := columns.Scan(&cid, &name, &kind, &notNull, &defaultValue, &primaryKey); err != nil {
			columns.Close()
			return err
		}
		hasPending = hasPending || name == "pending"
		hasExecutionOrder = hasExecutionOrder || name == "execution_order"
	}
	if err := columns.Err(); err != nil {
		columns.Close()
		return err
	}
	columns.Close()
	if !hasPending {
		if _, err := tx.Exec(`ALTER TABLE postings ADD COLUMN pending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1))`); err != nil {
			return fmt.Errorf("add posting pending state: %w", err)
		}
	}
	if !hasExecutionOrder {
		if _, err := tx.Exec(`ALTER TABLE postings ADD COLUMN execution_order INTEGER NOT NULL DEFAULT 0 CHECK (execution_order >= 0)`); err != nil {
			return fmt.Errorf("add posting execution order: %w", err)
		}
	}
	// Capture the former equal-time ID tie-break as numeric order before rekeying.
	// Display positions remain untouched. Runtime execution never reads ID order.
	rows, err := tx.Query(`SELECT id, source FROM postings ORDER BY id`)
	if err != nil {
		return err
	}
	ids := map[string]string{}
	var pendingIDs []string
	var orderedIDs []string
	for rows.Next() {
		var id, source string
		if err := rows.Scan(&id, &source); err != nil {
			rows.Close()
			return err
		}
		orderedIDs = append(orderedIDs, id)
		if source != SourceModel && (strings.HasPrefix(id, "sync-pending-") || strings.HasPrefix(id, "sfin-pending-")) {
			pendingIDs = append(pendingIDs, id)
		}
		parsed, err := uuid.Parse(id)
		if err != nil || parsed.String() != id {
			next, err := newRowID()
			if err != nil {
				rows.Close()
				return err
			}
			ids[id] = next
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for index, id := range orderedIDs {
		if _, err := tx.Exec(`UPDATE postings SET execution_order = ? WHERE id = ?`, index+1, id); err != nil {
			return err
		}
	}
	for _, id := range pendingIDs {
		if _, err := tx.Exec(`UPDATE postings SET pending = 1 WHERE id = ?`, id); err != nil {
			return err
		}
	}
	for old, next := range ids {
		if err := claimRowID(tx, next, "posting"); err != nil {
			return err
		}
		// Copy first so purchase policy foreign keys remain valid throughout.
		if _, err := tx.Exec(`INSERT INTO postings
			(id, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, fulfills_rule_id, fulfills_occurrence_date, enabled, source, pending, execution_order)
			SELECT ?, position, name, source_account_id, destinations, amount_resolution_json, posted_time, transaction_time, fulfills_rule_id, fulfills_occurrence_date, enabled, source, pending, execution_order
			FROM postings WHERE id = ?`, next, old); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE purchase_policies SET posting_id = ? WHERE posting_id = ?`, next, old); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM postings WHERE id = ?`, old); err != nil {
			return err
		}
		if err := releaseRowID(tx, old); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO posting_id_migrations (old_id, new_id) VALUES (?, ?)`, old, next); err != nil {
			return err
		}
	}
	if len(ids) > 0 {
		if err := remapStoredPostingReferences(tx, ids); err != nil {
			return err
		}
		// Artifacts contain old posting identities. They are derived caches.
		if _, err := tx.Exec(`DELETE FROM projection_artifacts`); err != nil {
			return err
		}
	}
	// Rebuild posting claims, including UUID rows and old orphaned claims.
	if _, err := tx.Exec(`DELETE FROM entity_ids WHERE kind = 'posting'`); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO entity_ids (id, kind) SELECT id, 'posting' FROM postings`); err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO schema_migrations (name) VALUES (?)`, migration)
	return err
}

func remapStoredPostingReferences(tx *sql.Tx, ids map[string]string) error {
	document, err := loadDocument(tx)
	if err != nil {
		return err
	}
	if document != nil {
		types.RemapPostingReferences(document, ids)
		for _, posting := range document.Postings {
			payload, err := json.Marshal(posting.Amount)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE postings SET amount_resolution_json = ? WHERE id = ?`, string(payload), posting.ID); err != nil {
				return err
			}
		}
		for _, rule := range document.RecurrenceRules {
			payload, err := json.Marshal(rule.Amount)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE recurrence_rules SET amount_resolution_json = ? WHERE id = ?`, string(payload), rule.ID); err != nil {
				return err
			}
		}
		for _, table := range document.Evaluations.Tables() {
			for _, evaluation := range *table.Rows {
				payload, err := json.Marshal(evaluation.Config)
				if err != nil {
					return err
				}
				if _, err := tx.Exec(`UPDATE evaluations SET config_json = ? WHERE type = ? AND instance_id = ?`, string(payload), table.Type, evaluation.InstanceID); err != nil {
					return err
				}
			}
		}
	}
	presets, err := tx.Query(`SELECT id, amount_json FROM amount_presets`)
	if err != nil {
		return err
	}
	values := map[string]string{}
	for presets.Next() {
		var id, raw string
		if err := presets.Scan(&id, &raw); err != nil {
			presets.Close()
			return err
		}
		var amount types.PostingAmountResolution
		if err := json.Unmarshal([]byte(raw), &amount); err != nil {
			presets.Close()
			return err
		}
		types.RemapPostingAmountReferences(&amount, ids)
		payload, err := json.Marshal(amount)
		if err != nil {
			presets.Close()
			return err
		}
		values[id] = string(payload)
	}
	if err := presets.Err(); err != nil {
		presets.Close()
		return err
	}
	presets.Close()
	for id, payload := range values {
		if _, err := tx.Exec(`UPDATE amount_presets SET amount_json = ? WHERE id = ?`, payload, id); err != nil {
			return err
		}
	}
	return nil
}
