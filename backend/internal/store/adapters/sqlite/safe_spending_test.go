package sqlite

import (
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
	settings := types.SafeSpendingSettings{StatementDay: 15, Reserve: 725.25, AccountIDs: []string{"card"}, IncomeRuleIDs: []string{}, StatementDaySet: true}
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
