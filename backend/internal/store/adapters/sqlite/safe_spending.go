package sqlite

import (
	"database/sql"
	"encoding/json"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func (s *sqliteStore) GetSafeSpendingSettings() (*types.SafeSpendingSettings, error) {
	var raw string
	if err := s.db.QueryRow(`SELECT settings_json FROM safe_spending_settings WHERE id = 1 AND user_id = :user_id`).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	var settings types.SafeSpendingSettings
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return nil, err
	}
	return &settings, nil
}

func (s *sqliteStore) SetSafeSpendingSettings(settings types.SafeSpendingSettings) error {
	raw, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO safe_spending_settings (id, settings_json, user_id) VALUES (1, ?, :user_id)
		ON CONFLICT(user_id, id) DO UPDATE SET settings_json = excluded.settings_json`, string(raw))
	return err
}
