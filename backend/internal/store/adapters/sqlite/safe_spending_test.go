package sqlite

import (
	"math"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestSafeSpendingSettingsPersistAndClear(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.db")
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	empty, err := database.GetSafeSpendingSettings()
	if err != nil || empty != nil {
		t.Fatalf("fresh = %v, %v", empty, err)
	}
	if err := database.SetSafeSpendingSettings(types.SafeSpendingSettings{}); err != nil {
		t.Fatal(err)
	}
	defaults, err := database.GetSafeSpendingSettings()
	if err != nil || defaults == nil || defaults.CycleStartDay != 20 || defaults.PaydayDay != 30 || defaults.SavingsTarget != 0 {
		t.Fatalf("defaults = %+v, %v", defaults, err)
	}
	settings := types.SafeSpendingSettings{
		Reserve: 725.25, CycleStartDay: 18, PaydayDay: 31, SavingsTarget: 345.67,
		AccountIDs: []string{"card"}, IncomeScheduleIDs: []string{},
	}
	if err := database.SetSafeSpendingSettings(settings); err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	database, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	for _, invalid := range []types.SafeSpendingSettings{
		{CycleStartDay: -1}, {CycleStartDay: 32}, {PaydayDay: -1}, {PaydayDay: 32},
		{SavingsTarget: -1}, {SavingsTarget: math.NaN()}, {SavingsTarget: math.Inf(1)},
	} {
		if err := database.SetSafeSpendingSettings(invalid); err == nil {
			t.Errorf("saved invalid settings: %+v", invalid)
		}
	}
	got, err := database.GetSafeSpendingSettings()
	if err != nil || !reflect.DeepEqual(got, &settings) {
		t.Fatalf("reload = %#v, %v", got, err)
	}
	if err := database.Clear(); err != nil {
		t.Fatal(err)
	}
	got, err = database.GetSafeSpendingSettings()
	if err != nil || got != nil {
		t.Fatalf("clear = %v, %v", got, err)
	}
}

func TestSafeSpendingSettingsRequiresCurrentStoredDocument(t *testing.T) {
	for _, raw := range []string{
		`null`,
		`{"reserve":100}`,
		`{"cycleStartDay":20,"paydayDay":30}`,
		`{"cycleStartDay":20,"paydayDay":30,"savingsTarget":null}`,
	} {
		if settings, err := decodeSafeSpendingSettings(raw); err == nil {
			t.Errorf("decoded invalid document %s: %+v", raw, settings)
		}
	}
}
