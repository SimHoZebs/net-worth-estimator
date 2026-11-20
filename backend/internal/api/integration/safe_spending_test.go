package integration

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestSafeSpendingSettingsHTTP(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	const path = "/v1/safe-spending-settings"
	readSettings := func(status int, body []byte) *types.SafeSpendingSettings {
		t.Helper()
		var doc struct {
			Settings *types.SafeSpendingSettings `json:"settings"`
		}
		if status != 200 || json.Unmarshal(body, &doc) != nil {
			t.Fatalf("settings response = %d %s", status, body)
		}
		return doc.Settings
	}
	empty := doRowRequest(t, handler, http.MethodGet, path, "")
	if settings := readSettings(empty.Code, empty.Body.Bytes()); settings != nil {
		t.Fatalf("GET returned unsaved settings: %+v", settings)
	}
	const base = `{"accountIds":["card"],"spendingAccountIds":null,"incomeScheduleIds":[],"transactionIds":["rent"]`
	defaulted := doRowRequest(t, handler, http.MethodPut, path, base+`}`)
	if settings := readSettings(defaulted.Code, defaulted.Body.Bytes()); settings == nil ||
		settings.CycleStartDay != 20 || settings.PaydayDay != 30 || settings.SavingsTarget != 0 {
		t.Fatalf("defaulted settings = %+v", settings)
	}
	const valid = base + `,"cycleStartDay":1,"paydayDay":31,"savingsTarget":123.45}`
	saved := doRowRequest(t, handler, http.MethodPut, path, valid)
	if settings := readSettings(saved.Code, saved.Body.Bytes()); settings == nil ||
		settings.CycleStartDay != 1 || settings.PaydayDay != 31 || settings.SavingsTarget != 123.45 {
		t.Fatalf("saved settings = %+v", settings)
	}
	for _, invalid := range []struct {
		payload string
		status  int
	}{
		{`{"reserve":-1,"incomeScheduleIds":[]}`, 422}, // retired setting is not writable
		{base + `,"cycleStartDay":0}`, 422},
		{base + `,"cycleStartDay":32}`, 422},
		{base + `,"paydayDay":0}`, 422},
		{base + `,"paydayDay":32}`, 422},
		{base + `,"paydayDay":1.5}`, 422},
		{base + `,"cycleStartDay":null}`, 422},
		{base + `,"paydayDay":null}`, 422},
		{base + `,"savingsTarget":-0.01}`, 422},
		{base + `,"savingsTarget":null}`, 422},
		{base + `,"savingsTarget":1e400}`, 400},
	} {
		if got := doRowRequest(t, handler, http.MethodPut, path, invalid.payload); got.Code != invalid.status {
			t.Errorf("PUT %s = %d %s, want %d", invalid.payload, got.Code, got.Body.String(), invalid.status)
		}
	}
	readOnly := New(database, Config{ReadOnly: true})
	if got := doRowRequest(t, readOnly, http.MethodPut, path, valid); got.Code != 403 {
		t.Fatalf("read-only PUT = %d", got.Code)
	}
	loaded := doRowRequest(t, readOnly, http.MethodGet, path, "")
	if loaded.Code != 200 || loaded.Body.String() != saved.Body.String() {
		t.Fatalf("GET changed settings: %d %s", loaded.Code, loaded.Body.String())
	}
}
