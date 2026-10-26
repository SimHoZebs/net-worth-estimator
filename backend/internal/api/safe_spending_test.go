package api

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
	const valid = `{"statementDay":15,"statementDaySet":true,"reserve":725.25,"accountIds":["card"],"spendingAccountIds":null,"incomeAccountIds":null,"incomeRuleIds":[],"movementIds":["rent"]}`
	saved := doRowRequest(t, handler, http.MethodPut, path, valid)
	if saved.Code != 200 {
		t.Fatalf("PUT = %d %s", saved.Code, saved.Body.String())
	}
	for _, invalid := range []string{
		`{"statementDay":0,"reserve":0,"incomeRuleIds":[]}`,
		`{"statementDay":29,"reserve":0,"incomeRuleIds":[]}`,
		`{"statementDay":20,"reserve":-1,"incomeRuleIds":[]}`,
	} {
		response := doRowRequest(t, handler, http.MethodPut, path, invalid)
		if response.Code != 422 {
			t.Fatalf("invalid PUT = %d %s", response.Code, response.Body.String())
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
