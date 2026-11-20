package sqlite

import (
	"database/sql"
	"encoding/json"
	"errors"
	"math"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// jsonSettingReader and jsonSettingWriter are the two scope shapes used by the
// single-row JSON settings pattern. Both userDB and userTx satisfy them.
type jsonSettingReader interface {
	QueryRow(query string, args ...any) *sql.Row
}

type jsonSettingWriter interface {
	jsonSettingReader
	Exec(query string, args ...any) (sql.Result, error)
}

// readSettingsJSON reads one single-row JSON column. A missing row is not an
// error: found distinguishes it from a stored empty string so callers keep
// their existing missing-versus-corrupt behavior.
func readSettingsJSON(reader jsonSettingReader, query string) (raw string, found bool, err error) {
	err = reader.QueryRow(query).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return raw, true, nil
}

// writeSettingsJSON marshals value and persists it through the supplied
// single-row statement. Callers wrap the error with their own context.
func writeSettingsJSON(writer jsonSettingWriter, query string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = writer.Exec(query, string(raw))
	return err
}

func (s *sqliteStore) GetSafeSpendingSettings() (*types.SafeSpendingSettings, error) {
	raw, found, err := readSettingsJSON(s.db, `SELECT settings_json FROM safe_spending_settings WHERE id = 1 AND user_id = :user_id`)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, nil
	}
	return decodeSafeSpendingSettings(raw)
}

func decodeSafeSpendingSettings(raw string) (*types.SafeSpendingSettings, error) {
	settings := &types.SafeSpendingSettings{}
	doc := struct {
		*types.SafeSpendingSettings
		SavingsTarget *float64 `json:"savingsTarget"`
	}{SafeSpendingSettings: settings}
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return nil, err
	}
	if doc.SavingsTarget == nil {
		return nil, errors.New("savings target must be present")
	}
	settings.SavingsTarget = *doc.SavingsTarget
	if err := validateSafeSpendingSettings(*settings); err != nil {
		return nil, err
	}
	return settings, nil
}

func (s *sqliteStore) SetSafeSpendingSettings(settings types.SafeSpendingSettings) error {
	// Programmatic writers can use the zero value for an unspecified day.
	// The HTTP schema distinguishes omissions from explicitly invalid days.
	if settings.CycleStartDay == 0 {
		settings.CycleStartDay = types.DefaultSafeSpendingCycleStartDay
	}
	if settings.PaydayDay == 0 {
		settings.PaydayDay = types.DefaultSafeSpendingPaydayDay
	}
	if err := validateSafeSpendingSettings(settings); err != nil {
		return err
	}
	return writeSettingsJSON(s.db, `INSERT INTO safe_spending_settings (id, settings_json, user_id) VALUES (1, ?, :user_id)
		ON CONFLICT(user_id, id) DO UPDATE SET settings_json = excluded.settings_json`, settings)
}

func validateSafeSpendingSettings(settings types.SafeSpendingSettings) error {
	if settings.CycleStartDay < 1 || settings.CycleStartDay > 31 {
		return errors.New("cycle start day must be between 1 and 31")
	}
	if settings.PaydayDay < 1 || settings.PaydayDay > 31 {
		return errors.New("payday day must be between 1 and 31")
	}
	if settings.SavingsTarget < 0 || math.IsNaN(settings.SavingsTarget) || math.IsInf(settings.SavingsTarget, 0) {
		return errors.New("savings target must be finite and nonnegative")
	}
	return nil
}
