package integration

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestSafeSpendingSettingsHTTP(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	const path = "/v1/safe-spending-settings"
	empty := doRowRequest(t, handler, http.MethodGet, path, "")
	if empty.Code != 200 || !json.Valid(empty.Body.Bytes()) {
		t.Fatalf("GET = %d %s", empty.Code, empty.Body.String())
	}
	const valid = `{"reserve":725.25,"accountIds":["card"],"spendingAccountIds":null,"incomeScheduleIds":[],"transactionIds":["rent"]}`
	saved := doRowRequest(t, handler, http.MethodPut, path, valid)
	if saved.Code != 200 {
		t.Fatalf("PUT = %d %s", saved.Code, saved.Body.String())
	}
	if got := doRowRequest(t, handler, http.MethodPut, path, `{"reserve":-1,"incomeScheduleIds":[]}`); got.Code != 422 {
		t.Fatalf("negative reserve = %d", got.Code)
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
