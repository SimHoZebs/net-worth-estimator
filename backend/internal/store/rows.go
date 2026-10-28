package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// RowKind identifies an ordered, ID-bearing canonical table for move
// operations. Checkpoints (date-ordered) and payment terms (account-keyed)
// have no move operation.
type RowKind string

const (
	RowAccount    RowKind = "account"
	RowPosting    RowKind = "posting"
	RowRule       RowKind = "rule"
	RowEvaluation RowKind = "evaluation"
	RowPreset     RowKind = "preset"
)

// Row errors map to API statuses: NotFound→404, IDConflict→409,
// InvalidID/SyncOwned/AccountMissing→422.
type rowError struct {
	code string
	id   string
}

func (e *rowError) Error() string { return e.code + ": " + e.id }

// IsNotFound reports a missing-row error.
func IsNotFound(err error) bool { return isRowCode(err, "not-found") }

// IsIDConflict reports a duplicate-ID error.
func IsIDConflict(err error) bool { return isRowCode(err, "id-conflict") }

// IsInvalidID reports a posting ID that is not a canonical UUID.
func IsInvalidID(err error) bool { return isRowCode(err, "invalid-id") }

// IsSyncOwned reports a write refused on a sync-owned row.
func IsSyncOwned(err error) bool { return isRowCode(err, "sync-owned") }

// IsAccountMissing reports a reference to an unknown model account.
func IsAccountMissing(err error) bool { return isRowCode(err, "account-missing") }

func isRowCode(err error, code string) bool {
	var target *rowError
	if as := asRowError(err); as != nil {
		target = as
		return target.code == code
	}
	return false
}

func asRowError(err error) *rowError {
	for err != nil {
		if re, ok := err.(*rowError); ok {
			return re
		}
		if un, ok := err.(interface{ Unwrap() error }); ok {
			err = un.Unwrap()
			continue
		}
		if un, ok := err.(interface{ Unwrap() []error }); ok {
			for _, inner := range un.Unwrap() {
				if re := asRowError(inner); re != nil {
					return re
				}
			}
			return nil
		}
		return nil
	}
	return nil
}

// AccountLink binds one SimpleFIN bridge account to one model account.
// Links are sync metadata: owner payloads never carry them, model saves
// never rewrite them, and a vanished bridge account leaves its link and
// data in place (stale, never deleted by sync).
type AccountLink struct {
	BridgeAccountID string `json:"bridgeAccountId"`
	ModelAccountID  string `json:"modelAccountId"`
	BridgeName      string `json:"bridgeName"`
	Currency        string `json:"currency"`
	Origin          string `json:"origin"`
	LastSeenAt      string `json:"lastSeenAt"`
}

// Link origins.
const (
	LinkOriginManual = "manual"
	LinkOriginAuto   = "auto"
)

// newRowID generates a time-ordered unique row ID.
func newRowID() (string, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return "", fmt.Errorf("generate row id: %w", err)
	}
	return id.String(), nil
}

func utcToday() string { return time.Now().UTC().Format("2006-01-02") }

// claimRowID reserves an ID in the plan's registry. A conflict means the
// ID exists in an ID-bearing table in this same plan.
func claimRowID(tx *planTx, id, kind string) error {
	if _, err := tx.Exec(`INSERT INTO entity_ids (id, kind, plan_id) VALUES (?,?, :plan_id)`, id, kind); err != nil {
		if isUniqueViolation(err) {
			return &rowError{code: "id-conflict", id: id}
		}
		return fmt.Errorf("claim row id %s: %w", id, err)
	}
	return nil
}

func releaseRowID(tx *planTx, id string) error {
	if _, err := tx.Exec(`DELETE FROM entity_ids WHERE id = ? AND plan_id = :plan_id`, id); err != nil {
		return fmt.Errorf("release row id %s: %w", id, err)
	}
	return nil
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

func markDocumentPresent(tx *planTx) error {
	if _, err := tx.Exec(`INSERT INTO model_metadata (id, source_path, document_present, plan_id) VALUES (1, '', 1, :plan_id)
		ON CONFLICT(plan_id, id) DO UPDATE SET document_present = 1`); err != nil {
		return fmt.Errorf("mark document present: %w", err)
	}
	return nil
}

func accountExists(tx *planTx, id string) (bool, error) {
	var present int
	if err := tx.QueryRow(`SELECT 1 FROM accounts WHERE id = ? AND plan_id = :plan_id`, id).Scan(&present); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("check account %s: %w", id, err)
	}
	return true, nil
}

// orderedIDs loads row IDs in stored order for a move operation.
func orderedIDs(tx *planTx, kind RowKind, evaluationType string) ([]string, error) {
	var query string
	var args []any
	switch kind {
	case RowAccount:
		query = `SELECT id FROM accounts WHERE plan_id = :plan_id ORDER BY position`
	case RowPosting:
		query = `SELECT id FROM postings WHERE plan_id = :plan_id ORDER BY position`
	case RowRule:
		query = `SELECT id FROM recurrence_rules WHERE plan_id = :plan_id ORDER BY position`
	case RowEvaluation:
		query = `SELECT instance_id FROM evaluations WHERE type = ? AND plan_id = :plan_id ORDER BY position`
		args = append(args, evaluationType)
	case RowPreset:
		query = `SELECT id FROM amount_presets WHERE plan_id = :plan_id ORDER BY position`
	default:
		return nil, fmt.Errorf("move unsupported for %q", kind)
	}
	rows, err := tx.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("load order for %s: %w", kind, err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return ids, rows.Close()
}

func rewritePositions(tx *planTx, kind RowKind, evaluationType string, ids []string) error {
	for position, id := range ids {
		var query string
		var args []any
		switch kind {
		case RowAccount:
			query = `UPDATE accounts SET position = ? WHERE id = ? AND plan_id = :plan_id`
			args = []any{position, id}
		case RowPosting:
			query = `UPDATE postings SET position = ? WHERE id = ? AND plan_id = :plan_id`
			args = []any{position, id}
		case RowRule:
			query = `UPDATE recurrence_rules SET position = ? WHERE id = ? AND plan_id = :plan_id`
			args = []any{position, id}
		case RowEvaluation:
			query = `UPDATE evaluations SET position = ? WHERE type = ? AND instance_id = ? AND plan_id = :plan_id`
			args = []any{position, evaluationType, id}
		case RowPreset:
			query = `UPDATE amount_presets SET position = ? WHERE id = ? AND plan_id = :plan_id`
			args = []any{position, id}
		default:
			return fmt.Errorf("move unsupported for %q", kind)
		}
		if _, err := tx.Exec(query, args...); err != nil {
			return fmt.Errorf("rewrite position for %s %s: %w", kind, id, err)
		}
	}
	return nil
}

// moveRow positions id immediately before beforeID (or appends when
// beforeID is empty) within one ordered table.
func moveRow(tx *planTx, kind RowKind, evaluationType, id, beforeID string) error {
	ids, err := orderedIDs(tx, kind, evaluationType)
	if err != nil {
		return err
	}
	found := false
	kept := ids[:0]
	for _, existing := range ids {
		if existing == id {
			found = true
			continue
		}
		kept = append(kept, existing)
	}
	if !found {
		return &rowError{code: "not-found", id: id}
	}
	if beforeID == "" {
		kept = append(kept, id)
	} else {
		placed := false
		result := make([]string, 0, len(kept)+1)
		for _, existing := range kept {
			if existing == beforeID {
				result = append(result, id)
				placed = true
			}
			result = append(result, existing)
		}
		if !placed {
			return &rowError{code: "not-found", id: beforeID}
		}
		kept = result
	}
	return rewritePositions(tx, kind, evaluationType, kept)
}

func withRowTx(db *planDB, fn func(tx *planTx) error) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return err
	}
	if err := markDocumentPresent(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("row write commit: %w", err)
	}
	return nil
}

// CreateAccount inserts one owner account. An empty ID gets a UUIDv7.
func (s *sqliteStore) CreateAccount(account types.Account) (types.Account, error) {
	if account.ID == "" {
		id, err := newRowID()
		if err != nil {
			return types.Account{}, err
		}
		account.ID = id
	}
	err := withRowTx(s.db, func(tx *planTx) error {
		if err := claimRowID(tx, account.ID, "account"); err != nil {
			return err
		}
		position, err := nextTablePosition(tx, "accounts")
		if err != nil {
			return err
		}
		minBalance := valueOr(account.MinBalance, types.NoFloor)
		maxBalance := valueOr(account.MaxBalance, types.NoCeiling)
		color := nullable(account.Color)
		if _, err := tx.Exec(
			`INSERT INTO accounts (id, position, name, kind, min_balance, max_balance, color, enabled, plan_id) VALUES (?,?,?,?,?,?,?,?, :plan_id)`,
			account.ID, position, account.Name, string(account.Kind), minBalance, maxBalance, color, boolToInt(account.Enabled),
		); err != nil {
			return fmt.Errorf("insert account %s: %w", account.ID, err)
		}
		return nil
	})
	if err != nil {
		return types.Account{}, err
	}
	return account, nil
}

// UpdateAccount replaces one owner account by ID. The ID is immutable.
func (s *sqliteStore) UpdateAccount(account types.Account) (types.Account, error) {
	if account.ID == "" {
		return types.Account{}, &rowError{code: "not-found", id: ""}
	}
	err := withRowTx(s.db, func(tx *planTx) error {
		var position int
		if err := tx.QueryRow(`SELECT position FROM accounts WHERE id = ? AND plan_id = :plan_id`, account.ID).Scan(&position); err != nil {
			if err == sql.ErrNoRows {
				return &rowError{code: "not-found", id: account.ID}
			}
			return fmt.Errorf("read account %s: %w", account.ID, err)
		}
		minBalance := valueOr(account.MinBalance, types.NoFloor)
		maxBalance := valueOr(account.MaxBalance, types.NoCeiling)
		color := nullable(account.Color)
		if _, err := tx.Exec(
			`UPDATE accounts SET name = ?, kind = ?, min_balance = ?, max_balance = ?, color = ?, enabled = ? WHERE id = ? AND plan_id = :plan_id`,
			account.Name, string(account.Kind), minBalance, maxBalance, color, boolToInt(account.Enabled), account.ID,
		); err != nil {
			return fmt.Errorf("update account %s: %w", account.ID, err)
		}
		return nil
	})
	if err != nil {
		return types.Account{}, err
	}
	return account, nil
}

// DeleteAccount removes one account and its registry entry. Bridge
// links are kept: the link is the memory of the mapping, so recreating
// the account restores sync flow, and the links endpoint keeps showing
// the last-seen snapshot. Dependent rows are validated at the API layer
// before this runs. Composite foreign keys also reject dangling financial
// references when a caller bypasses API validation. Stale account links are
// deliberate metadata and have no account-row foreign key.
func (s *sqliteStore) DeleteAccount(id string) error {
	return withRowTx(s.db, func(tx *planTx) error {
		result, err := tx.Exec(`DELETE FROM accounts WHERE id = ? AND plan_id = :plan_id`, id)
		if err != nil {
			return fmt.Errorf("delete account %s: %w", id, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return &rowError{code: "not-found", id: id}
		}
		return releaseRowID(tx, id)
	})
}

// MoveAccount positions one account before another (or appends).
func (s *sqliteStore) MoveAccount(id, beforeID string) error {
	return withRowTx(s.db, func(tx *planTx) error {
		return moveRow(tx, RowAccount, "", id, beforeID)
	})
}

// CreateRule inserts one recurrence rule. Empty IDs get a UUIDv7.
func (s *sqliteStore) CreateRule(rule types.RecurrenceRule) (types.RecurrenceRule, error) {
	if rule.ID == "" {
		id, err := newRowID()
		if err != nil {
			return types.RecurrenceRule{}, err
		}
		rule.ID = id
	}
	err := withRowTx(s.db, func(tx *planTx) error {
		if err := claimRowID(tx, rule.ID, "rule"); err != nil {
			return err
		}
		position, err := nextTablePosition(tx, "recurrence_rules")
		if err != nil {
			return err
		}
		return insertRule(tx, position, &rule)
	})
	if err != nil {
		return types.RecurrenceRule{}, err
	}
	return rule, nil
}

// UpdateRule replaces one recurrence rule by ID.
func (s *sqliteStore) UpdateRule(rule types.RecurrenceRule) (types.RecurrenceRule, error) {
	if rule.ID == "" {
		return types.RecurrenceRule{}, &rowError{code: "not-found", id: ""}
	}
	err := withRowTx(s.db, func(tx *planTx) error {
		var position int
		if err := tx.QueryRow(`SELECT position FROM recurrence_rules WHERE id = ? AND plan_id = :plan_id`, rule.ID).Scan(&position); err != nil {
			if err == sql.ErrNoRows {
				return &rowError{code: "not-found", id: rule.ID}
			}
			return fmt.Errorf("read rule %s: %w", rule.ID, err)
		}
		if _, err := tx.Exec(`DELETE FROM recurrence_rules WHERE id = ? AND plan_id = :plan_id`, rule.ID); err != nil {
			return fmt.Errorf("replace rule %s: %w", rule.ID, err)
		}
		return insertRule(tx, position, &rule)
	})
	if err != nil {
		return types.RecurrenceRule{}, err
	}
	return rule, nil
}

// DeleteRule removes one recurrence rule.
func (s *sqliteStore) DeleteRule(id string) error {
	return withRowTx(s.db, func(tx *planTx) error {
		result, err := tx.Exec(`DELETE FROM recurrence_rules WHERE id = ? AND plan_id = :plan_id`, id)
		if err != nil {
			return fmt.Errorf("delete rule %s: %w", id, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return &rowError{code: "not-found", id: id}
		}
		return releaseRowID(tx, id)
	})
}

// MoveRule positions one rule before another (or appends).
func (s *sqliteStore) MoveRule(id, beforeID string) error {
	return withRowTx(s.db, func(tx *planTx) error {
		return moveRow(tx, RowRule, "", id, beforeID)
	})
}

// SaveCheckpoint upserts one owner checkpoint by account/date. An owner
// write wins over a sync-owned row on the same key.
func (s *sqliteStore) SaveCheckpoint(checkpoint types.Checkpoint) (types.Checkpoint, error) {
	checkpoint.Source = SourceModel
	err := withRowTx(s.db, func(tx *planTx) error {
		position, err := nextTablePosition(tx, "checkpoints")
		if err != nil {
			return err
		}
		result, err := tx.Exec(
			`INSERT INTO checkpoints (position, date, account_id, balance, source, plan_id, id) VALUES (?,?,?,?,?, :plan_id, (SELECT COALESCE(MAX(id), 0) + 1 FROM checkpoints WHERE plan_id = :plan_id))
			 ON CONFLICT(plan_id, account_id, date) DO UPDATE SET balance = excluded.balance, source = excluded.source`,
			position, checkpoint.Date, checkpoint.AccountID, checkpoint.Balance, SourceModel,
		)
		if err != nil {
			return fmt.Errorf("save checkpoint %s %s: %w", checkpoint.AccountID, checkpoint.Date, err)
		}
		_ = result
		return nil
	})
	if err != nil {
		return types.Checkpoint{}, err
	}
	return checkpoint, nil
}

// DeleteCheckpoint removes the checkpoint row for one account/date,
// regardless of owner. A deleted sync row returns on the next sync.
func (s *sqliteStore) DeleteCheckpoint(accountID, date string) error {
	return withRowTx(s.db, func(tx *planTx) error {
		result, err := tx.Exec(`DELETE FROM checkpoints WHERE account_id = ? AND date = ? AND plan_id = :plan_id`, accountID, date)
		if err != nil {
			return fmt.Errorf("delete checkpoint %s %s: %w", accountID, date, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return &rowError{code: "not-found", id: accountID + "/" + date}
		}
		return nil
	})
}

func validEvaluationType(evalType string) bool {
	for _, ordered := range types.EvaluationTypeOrder {
		if ordered == evalType {
			return true
		}
	}
	return false
}

// EvaluationUpdate is one generic evaluation row for create/update.
type EvaluationUpdate struct {
	Type       string         `json:"type"`
	InstanceID string         `json:"instanceId,omitempty"`
	Name       string         `json:"name"`
	Enabled    bool           `json:"enabled"`
	Config     map[string]any `json:"config,omitempty"`
}

// CreateEvaluation inserts one evaluation instance. Empty instance IDs
// get a UUIDv7. Instance IDs share the plan's registry.
func (s *sqliteStore) CreateEvaluation(item EvaluationUpdate) (EvaluationUpdate, error) {
	if !validEvaluationType(item.Type) {
		return EvaluationUpdate{}, fmt.Errorf("unknown evaluation type %q", item.Type)
	}
	if item.InstanceID == "" {
		id, err := newRowID()
		if err != nil {
			return EvaluationUpdate{}, err
		}
		item.InstanceID = id
	}
	if item.Config == nil {
		item.Config = map[string]any{}
	}
	err := withRowTx(s.db, func(tx *planTx) error {
		if err := claimRowID(tx, item.InstanceID, "evaluation"); err != nil {
			return err
		}
		var position int
		if err := tx.QueryRow(`SELECT COALESCE(MAX(position), -1) + 1 FROM evaluations WHERE type = ? AND plan_id = :plan_id`, item.Type).Scan(&position); err != nil {
			return fmt.Errorf("next evaluation position: %w", err)
		}
		return saveEvaluationTable(tx, item.Type, []evaluationRow{{
			instanceID: item.InstanceID, position: position, name: item.Name, enabled: item.Enabled, configValue: item.Config,
		}})
	})
	if err != nil {
		return EvaluationUpdate{}, err
	}
	return item, nil
}

// UpdateEvaluation replaces one evaluation instance. The type and
// instance ID are immutable.
func (s *sqliteStore) UpdateEvaluation(item EvaluationUpdate) (EvaluationUpdate, error) {
	if item.InstanceID == "" {
		return EvaluationUpdate{}, &rowError{code: "not-found", id: ""}
	}
	if item.Config == nil {
		item.Config = map[string]any{}
	}
	err := withRowTx(s.db, func(tx *planTx) error {
		var position int
		var storedType string
		if err := tx.QueryRow(`SELECT type, position FROM evaluations WHERE instance_id = ? AND plan_id = :plan_id`, item.InstanceID).Scan(&storedType, &position); err != nil {
			if err == sql.ErrNoRows {
				return &rowError{code: "not-found", id: item.InstanceID}
			}
			return fmt.Errorf("read evaluation %s: %w", item.InstanceID, err)
		}
		if item.Type != "" && item.Type != storedType {
			return fmt.Errorf("evaluation %s type is immutable", item.InstanceID)
		}
		configJSON, err := json.Marshal(item.Config)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(
			`UPDATE evaluations SET name = ?, enabled = ?, config_json = ? WHERE instance_id = ? AND plan_id = :plan_id`,
			item.Name, boolToInt(item.Enabled), configJSON, item.InstanceID,
		); err != nil {
			return fmt.Errorf("update evaluation %s: %w", item.InstanceID, err)
		}
		return nil
	})
	if err != nil {
		return EvaluationUpdate{}, err
	}
	if item.Type == "" {
		var storedType string
		if err := s.db.QueryRow(`SELECT type FROM evaluations WHERE instance_id = ? AND plan_id = :plan_id`, item.InstanceID).Scan(&storedType); err != nil {
			return EvaluationUpdate{}, err
		}
		item.Type = storedType
	}
	return item, nil
}

// DeleteEvaluation removes one evaluation instance. Its pin, if any,
// is dropped in the same transaction so pins never dangle.
func (s *sqliteStore) DeleteEvaluation(instanceID string) error {
	return withRowTx(s.db, func(tx *planTx) error {
		result, err := tx.Exec(`DELETE FROM evaluations WHERE instance_id = ? AND plan_id = :plan_id`, instanceID)
		if err != nil {
			return fmt.Errorf("delete evaluation %s: %w", instanceID, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return &rowError{code: "not-found", id: instanceID}
		}
		if _, err := tx.Exec(`DELETE FROM pinned_evaluations WHERE instance_id = ? AND plan_id = :plan_id`, instanceID); err != nil {
			return fmt.Errorf("unpin evaluation %s: %w", instanceID, err)
		}
		return releaseRowID(tx, instanceID)
	})
}

// MoveEvaluation positions one instance before another within its type.
func (s *sqliteStore) MoveEvaluation(evalType, instanceID, beforeID string) error {
	if !validEvaluationType(evalType) {
		return fmt.Errorf("unknown evaluation type %q", evalType)
	}
	return withRowTx(s.db, func(tx *planTx) error {
		return moveRow(tx, RowEvaluation, evalType, instanceID, beforeID)
	})
}

// SavePaymentTerms upserts the terms row for one account.
func (s *sqliteStore) SavePaymentTerms(terms types.PaymentTerms) (types.PaymentTerms, error) {
	err := withRowTx(s.db, func(tx *planTx) error {
		position, err := nextTablePosition(tx, "payment_terms")
		if err != nil {
			return err
		}
		minimumPercent := nullable(terms.MinimumPercent)
		statementDay := nullable(terms.StatementDay)
		if _, err := tx.Exec(
			`INSERT INTO payment_terms (account_id, position, minimum_fixed, minimum_percent, due_day, statement_day, plan_id) VALUES (?,?,?,?,?,?, :plan_id)
			 ON CONFLICT(plan_id, account_id) DO UPDATE SET minimum_fixed = excluded.minimum_fixed, minimum_percent = excluded.minimum_percent,
			 due_day = excluded.due_day, statement_day = excluded.statement_day`,
			terms.AccountID, position, terms.MinimumFixed, minimumPercent, terms.DueDay, statementDay,
		); err != nil {
			return fmt.Errorf("save payment terms %s: %w", terms.AccountID, err)
		}
		return nil
	})
	if err != nil {
		return types.PaymentTerms{}, err
	}
	return terms, nil
}

// DeletePaymentTerms removes the terms row for one account.
func (s *sqliteStore) DeletePaymentTerms(accountID string) error {
	return withRowTx(s.db, func(tx *planTx) error {
		result, err := tx.Exec(`DELETE FROM payment_terms WHERE account_id = ? AND plan_id = :plan_id`, accountID)
		if err != nil {
			return fmt.Errorf("delete payment terms %s: %w", accountID, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return &rowError{code: "not-found", id: accountID}
		}
		return nil
	})
}

// ListAccountLinks returns all bridge-to-model bindings.
func (s *sqliteStore) ListAccountLinks() ([]AccountLink, error) {
	rows, err := s.db.Query(`SELECT bridge_account_id, model_account_id, bridge_name, currency, origin, last_seen_at FROM account_links WHERE plan_id = :plan_id ORDER BY bridge_account_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	links := []AccountLink{}
	for rows.Next() {
		var link AccountLink
		if err := rows.Scan(&link.BridgeAccountID, &link.ModelAccountID, &link.BridgeName, &link.Currency, &link.Origin, &link.LastSeenAt); err != nil {
			return nil, err
		}
		links = append(links, link)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return links, rows.Close()
}

// SaveAccountLink creates or replaces the binding for one bridge
// account. The model account must exist; use EnsureLinkedAccount to
// provision one first.
func (s *sqliteStore) SaveAccountLink(link AccountLink) (AccountLink, error) {
	if link.BridgeAccountID == "" {
		return AccountLink{}, fmt.Errorf("bridge account id is required")
	}
	if link.Origin == "" {
		link.Origin = LinkOriginManual
	}
	if link.Origin != LinkOriginManual && link.Origin != LinkOriginAuto {
		return AccountLink{}, fmt.Errorf("unknown link origin %q", link.Origin)
	}
	err := withRowTx(s.db, func(tx *planTx) error {
		exists, err := accountExists(tx, link.ModelAccountID)
		if err != nil {
			return err
		}
		if !exists {
			return &rowError{code: "account-missing", id: link.ModelAccountID}
		}
		if _, err := tx.Exec(
			`INSERT INTO account_links (bridge_account_id, model_account_id, bridge_name, currency, origin, last_seen_at, plan_id) VALUES (?,?,?,?,?,?, :plan_id)
			 ON CONFLICT(plan_id, bridge_account_id) DO UPDATE SET model_account_id = excluded.model_account_id, bridge_name = excluded.bridge_name,
			 currency = excluded.currency, origin = excluded.origin, last_seen_at = excluded.last_seen_at`,
			link.BridgeAccountID, link.ModelAccountID, link.BridgeName, link.Currency, link.Origin, link.LastSeenAt,
		); err != nil {
			if isUniqueViolation(err) {
				return &rowError{code: "id-conflict", id: link.ModelAccountID}
			}
			return fmt.Errorf("save account link %s: %w", link.BridgeAccountID, err)
		}
		return nil
	})
	if err != nil {
		return AccountLink{}, err
	}
	return link, nil
}

// DeleteAccountLink removes one binding. Data stays; the bridge account
// simply stops resolving until relinked.
func (s *sqliteStore) DeleteAccountLink(bridgeAccountID string) error {
	return withRowTx(s.db, func(tx *planTx) error {
		result, err := tx.Exec(`DELETE FROM account_links WHERE bridge_account_id = ? AND plan_id = :plan_id`, bridgeAccountID)
		if err != nil {
			return fmt.Errorf("delete account link %s: %w", bridgeAccountID, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return &rowError{code: "not-found", id: bridgeAccountID}
		}
		return nil
	})
}

// EnsureLinkedAccount resolves a bridge account to a model account,
// provisioning both the account and an auto link when unknown. It runs
// inside the caller's sync transaction so errors roll everything back.
func EnsureLinkedAccount(tx *planTx, bridgeAccountID, bridgeName, currency string, kind types.AccountKind) (string, bool, error) {
	var modelAccountID string
	if err := tx.QueryRow(`SELECT model_account_id FROM account_links WHERE bridge_account_id = ? AND plan_id = :plan_id`, bridgeAccountID).Scan(&modelAccountID); err == nil {
		if _, err := tx.Exec(
			`UPDATE account_links SET bridge_name = ?, currency = ?, last_seen_at = ? WHERE bridge_account_id = ? AND plan_id = :plan_id`,
			bridgeName, currency, utcToday(), bridgeAccountID,
		); err != nil {
			return "", false, fmt.Errorf("touch account link %s: %w", bridgeAccountID, err)
		}
		return modelAccountID, false, nil
	} else if err != sql.ErrNoRows {
		return "", false, fmt.Errorf("read account link %s: %w", bridgeAccountID, err)
	}
	id, err := newRowID()
	if err != nil {
		return "", false, err
	}
	if err := claimRowID(tx, id, "account"); err != nil {
		return "", false, err
	}
	position, err := nextTablePosition(tx, "accounts")
	if err != nil {
		return "", false, err
	}
	name := bridgeName
	if strings.TrimSpace(name) == "" {
		name = "Synced account"
	}
	if _, err := tx.Exec(
		`INSERT INTO accounts (id, position, name, kind, min_balance, max_balance, color, enabled, plan_id) VALUES (?,?,?,?,?,?,?,?, :plan_id)`,
		id, position, name, string(kind), types.NoFloor, types.NoCeiling, nil, 1,
	); err != nil {
		return "", false, fmt.Errorf("provision account for %s: %w", bridgeAccountID, err)
	}
	if _, err := tx.Exec(
		`INSERT INTO account_links (bridge_account_id, model_account_id, bridge_name, currency, origin, last_seen_at, plan_id) VALUES (?,?,?,?,?,?, :plan_id)`,
		bridgeAccountID, id, bridgeName, currency, LinkOriginAuto, utcToday(),
	); err != nil {
		return "", false, fmt.Errorf("link provisioned account %s: %w", bridgeAccountID, err)
	}
	return id, true, nil
}

// TouchAccountLink refreshes the snapshot and last-seen date.
func TouchAccountLink(tx *planTx, bridgeAccountID, bridgeName, currency string) error {
	if _, err := tx.Exec(
		`UPDATE account_links SET bridge_name = ?, currency = ?, last_seen_at = ? WHERE bridge_account_id = ? AND plan_id = :plan_id`,
		bridgeName, currency, utcToday(), bridgeAccountID,
	); err != nil {
		return fmt.Errorf("touch account link %s: %w", bridgeAccountID, err)
	}
	return nil
}
