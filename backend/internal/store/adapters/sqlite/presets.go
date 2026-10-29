package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Amount presets are saved amount recipes. They live outside the canonical
// financial model document, so they never affect the document ETag,
// validation, or the row-sync diff — exactly like pinned evaluations.
// Table definition and seed rows live in schema.go (SetupDatabase);
// this file owns only preset row methods.
// Preset writes run in their own transaction and never mark the model
// document present: saving a preset into an empty database must not fake
// a model. Clear and CSV import leave presets alone: presets are user
// configuration, not model data.
//
// Referential rule: none. The amount descriptor may reference placeholder
// IDs; placeholders resolve at authoring time when the UI copies the
// descriptor into a posting or rule. Names are unique and immutable: the
// name is the stable key the UI binds to, while IDs stay internal.

// ListAmountPresets returns presets in stored order.
func (s *sqliteStore) ListAmountPresets() ([]types.AmountPreset, error) {
	rows, err := s.db.Query(`SELECT id, name, label, summary, when_use, amount_json, enabled FROM amount_presets WHERE user_id = :user_id ORDER BY position`)
	if err != nil {
		return nil, fmt.Errorf("list amount presets: %w", err)
	}
	defer rows.Close()
	presets := []types.AmountPreset{}
	for rows.Next() {
		preset, err := scanPresetRow(rows)
		if err != nil {
			return nil, err
		}
		presets = append(presets, preset)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return presets, rows.Close()
}

func scanPresetRow(rows *sql.Rows) (types.AmountPreset, error) {
	var preset types.AmountPreset
	var summary, whenUse sql.NullString
	var amountJSON string
	var enabled int64
	if err := rows.Scan(&preset.ID, &preset.Name, &preset.Label, &summary, &whenUse, &amountJSON, &enabled); err != nil {
		return types.AmountPreset{}, err
	}
	if summary.Valid {
		preset.Summary = summary.String
	}
	if whenUse.Valid {
		preset.WhenUse = whenUse.String
	}
	if err := json.Unmarshal([]byte(amountJSON), &preset.Amount); err != nil {
		return types.AmountPreset{}, fmt.Errorf("parse preset amount %s: %w", preset.ID, err)
	}
	preset.Enabled = enabled != 0
	return preset, nil
}

// presetTx runs a preset write without marking the model document present.
func presetTx(db *userDB, fn func(tx *userTx) error) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("preset write commit: %w", err)
	}
	return nil
}

func insertPreset(tx *userTx, position int, preset *types.AmountPreset) error {
	amountJSON, err := json.Marshal(preset.Amount)
	if err != nil {
		return fmt.Errorf("marshal preset amount %s: %w", preset.ID, err)
	}
	if _, err := tx.Exec(
		`INSERT INTO amount_presets (id, position, name, label, summary, when_use, amount_json, enabled, user_id) VALUES (?,?,?,?,?,?,?,?, :user_id)`,
		preset.ID, position, preset.Name, preset.Label, preset.Summary, preset.WhenUse, string(amountJSON), boolToInt(preset.Enabled),
	); err != nil {
		if isUniqueViolation(err) {
			return IDConflict(preset.Name)
		}
		return fmt.Errorf("insert amount preset %s: %w", preset.ID, err)
	}
	return nil
}

// CreateAmountPreset inserts one preset. An empty ID gets a UUIDv7; names
// are unique. IDs carry no ownership meaning.
func (s *sqliteStore) CreateAmountPreset(preset types.AmountPreset) (types.AmountPreset, error) {
	if err := ValidateAmountPresetName(preset.Name); err != nil {
		return types.AmountPreset{}, err
	}
	if preset.ID == "" {
		id, err := newRowID()
		if err != nil {
			return types.AmountPreset{}, err
		}
		preset.ID = id
	}
	err := presetTx(s.db, func(tx *userTx) error {
		position, err := nextTablePosition(tx, "amount_presets")
		if err != nil {
			return err
		}
		return insertPreset(tx, position, &preset)
	})
	if err != nil {
		return types.AmountPreset{}, err
	}
	return preset, nil
}

// UpdateAmountPreset replaces one preset by ID. The name is immutable: it
// is the stable key the UI binds to.
func (s *sqliteStore) UpdateAmountPreset(preset types.AmountPreset) (types.AmountPreset, error) {
	if preset.ID == "" {
		return types.AmountPreset{}, NotFound("")
	}
	if err := ValidateAmountPresetName(preset.Name); err != nil {
		return types.AmountPreset{}, err
	}
	err := presetTx(s.db, func(tx *userTx) error {
		var position int
		var storedName string
		if err := tx.QueryRow(`SELECT position, name FROM amount_presets WHERE id = ? AND user_id = :user_id`, preset.ID).Scan(&position, &storedName); err != nil {
			if err == sql.ErrNoRows {
				return NotFound(preset.ID)
			}
			return fmt.Errorf("read amount preset %s: %w", preset.ID, err)
		}
		if preset.Name != storedName {
			return fmt.Errorf("amount preset %s name is immutable", preset.ID)
		}
		if _, err := tx.Exec(`DELETE FROM amount_presets WHERE id = ? AND user_id = :user_id`, preset.ID); err != nil {
			return fmt.Errorf("replace amount preset %s: %w", preset.ID, err)
		}
		return insertPreset(tx, position, &preset)
	})
	if err != nil {
		return types.AmountPreset{}, err
	}
	return preset, nil
}

// DeleteAmountPreset removes one preset.
func (s *sqliteStore) DeleteAmountPreset(id string) error {
	return presetTx(s.db, func(tx *userTx) error {
		result, err := tx.Exec(`DELETE FROM amount_presets WHERE id = ? AND user_id = :user_id`, id)
		if err != nil {
			return fmt.Errorf("delete amount preset %s: %w", id, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return NotFound(id)
		}
		return nil
	})
}

// MoveAmountPreset positions one preset before another (or appends).
func (s *sqliteStore) MoveAmountPreset(id, beforeID string) error {
	return presetTx(s.db, func(tx *userTx) error {
		return moveRow(tx, RowPreset, "", id, beforeID)
	})
}
