package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPlannedPurchaseHTTPRoundTrip(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	account := doRowRequest(t, handler, "POST", "/v1/accounts", `{"id":"cash","name":"Cash","kind":"cash","enabled":true}`)
	if account.Code != 200 {
		t.Fatal(account.Body.String())
	}
	const id = "01900000-0000-7000-8000-000000000022"
	body := `{"id":"` + id + `","name":"Laptop","fundingAccountId":"cash","cost":500,"earliestDate":"2026-02-01","enabled":true,"priority":3}`
	created := doRowRequest(t, handler, "POST", "/v1/planned-purchases", body)
	var result rowResultBody[types.PlannedPurchase]
	if created.Code != 200 {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	if err := json.Unmarshal(created.Body.Bytes(), &result); err != nil || !result.Persisted || result.Row.Priority != 3 {
		t.Fatalf("create: %s %v", created.Body.String(), err)
	}
	if w := doRowRequest(t, handler, "POST", "/v1/planned-purchases", body); w.Code != 409 {
		t.Fatalf("retry: %d %s", w.Code, w.Body.String())
	}
	row := result.Row
	row.Cost = 600
	update, _ := json.Marshal(row)
	if w := doRowRequest(t, handler, "PATCH", "/v1/planned-purchases/"+id, string(update)); w.Code != 200 {
		t.Fatalf("update: %d %s", w.Code, w.Body.String())
	}
	list := doRowRequest(t, handler, "GET", "/v1/planned-purchases", "")
	if list.Code != 200 || !strings.Contains(list.Body.String(), `"cost":600`) {
		t.Fatalf("list: %d %s", list.Code, list.Body.String())
	}
	doc, err := database.LoadDocument()
	if err != nil || len(doc.Postings) != 0 || len(doc.PlannedPurchases) != 1 {
		t.Fatalf("purchase became a posting: %+v %v", doc, err)
	}
	for _, change := range []string{`"cost":-1`, `"cost":0`, `"earliestDate":"2026-02-30"`, `"fundingAccountId":"missing"`, `"priority":-1`} {
		var invalid map[string]any
		json.Unmarshal([]byte(body), &invalid)
		json.Unmarshal([]byte("{"+change+"}"), &invalid)
		data, _ := json.Marshal(invalid)
		w := doRowRequest(t, handler, "PATCH", "/v1/planned-purchases/"+id, string(data))
		if w.Code == 200 {
			var rejected rowResultBody[types.PlannedPurchase]
			json.Unmarshal(w.Body.Bytes(), &rejected)
			if rejected.Persisted {
				t.Fatalf("invalid purchase persisted: %s", change)
			}
		} else if w.Code != 422 {
			t.Fatalf("invalid purchase: %d %s", w.Code, w.Body.String())
		}
	}
	for _, method := range []string{"POST", "PATCH", "DELETE"} {
		path := "/v1/planned-purchases"
		if method != "POST" {
			path += "/" + id
		}
		if w := doRowRequest(t, New(database, Config{ReadOnly: true}), method, path, body); w.Code != http.StatusForbidden {
			t.Fatalf("read-only %s: %d", method, w.Code)
		}
	}
	if w := doRowRequest(t, handler, "DELETE", "/v1/planned-purchases/"+id, ""); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := doRowRequest(t, handler, "DELETE", "/v1/planned-purchases/"+id, ""); w.Code != 404 {
		t.Fatalf("delete missing: %d", w.Code)
	}
}

func TestPlannedPurchaseAppendAndReorder(t *testing.T) {
	database := openAPIStore(t)
	_, _ = database.CreateAccount(types.Account{ID: "cash", Name: "Cash", Kind: "cash", Enabled: true})
	handler := New(database, Config{})
	for i := 0; i < 3; i++ {
		body := fmt.Sprintf(`{"id":"01900000-0000-7000-8000-%012d","name":"Item","fundingAccountId":"cash","cost":100,"earliestDate":"2026-02-01","enabled":true}`, i)
		w := doRowRequest(t, handler, "POST", "/v1/planned-purchases", body)
		var result rowResultBody[types.PlannedPurchase]
		json.Unmarshal(w.Body.Bytes(), &result)
		if w.Code != 200 || !result.Persisted || result.Row.Priority != i {
			t.Fatalf("append: %d %s", w.Code, w.Body.String())
		}
	}
	w := doRowRequest(t, handler, "POST", "/v1/planned-purchases/reorder", `{"id":"01900000-0000-7000-8000-000000000002","beforeId":"01900000-0000-7000-8000-000000000000"}`)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	doc, _ := database.LoadDocument()
	if doc.PlannedPurchases[0].ID != "01900000-0000-7000-8000-000000000002" || doc.PlannedPurchases[0].Priority != 0 {
		t.Fatalf("order: %+v", doc.PlannedPurchases)
	}
}
