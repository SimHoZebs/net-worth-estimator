package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

func decodePinned(t *testing.T, response string) []string {
	t.Helper()
	var payload struct {
		InstanceIDs []string `json:"instanceIds"`
	}
	if err := json.Unmarshal([]byte(response), &payload); err != nil {
		t.Fatalf("decode pinned: %v", err)
	}
	if payload.InstanceIDs == nil {
		return []string{}
	}
	return payload.InstanceIDs
}

func TestPinnedEvaluationsEndToEnd(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})

	created := doRowRequest(t, handler, http.MethodPost, "/v1/evaluations", `{"type":"netWorthThreshold","name":"Target","enabled":true,"config":{"target":100}}`)
	if created.Code != http.StatusOK {
		t.Fatalf("create status = %d, body %s", created.Code, created.Body.String())
	}
	var createdPayload struct {
		Row struct {
			InstanceID string `json:"instanceId"`
		} `json:"row"`
		Persisted bool `json:"persisted"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createdPayload); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if !createdPayload.Persisted || createdPayload.Row.InstanceID == "" {
		t.Fatalf("create = %+v", createdPayload)
	}
	id := createdPayload.Row.InstanceID

	empty := doRowRequest(t, handler, http.MethodGet, "/v1/pinned-evaluations", "")
	if empty.Code != http.StatusOK {
		t.Fatalf("get status = %d, body %s", empty.Code, empty.Body.String())
	}
	if got := decodePinned(t, empty.Body.String()); len(got) != 0 {
		t.Fatalf("get pins = %v, want none", got)
	}

	set := doRowRequest(t, handler, http.MethodPut, "/v1/pinned-evaluations", `{"instanceIds":["`+id+`"]}`)
	if set.Code != http.StatusOK {
		t.Fatalf("put status = %d, body %s", set.Code, set.Body.String())
	}
	if got := decodePinned(t, set.Body.String()); len(got) != 1 || got[0] != id {
		t.Fatalf("put pins = %v, want [%s]", got, id)
	}

	unknown := doRowRequest(t, handler, http.MethodPut, "/v1/pinned-evaluations", `{"instanceIds":["missing"]}`)
	if unknown.Code != http.StatusNotFound {
		t.Fatalf("unknown put status = %d, want 404", unknown.Code)
	}

	deleted := doRowRequest(t, handler, http.MethodDelete, "/v1/evaluations/"+id, "")
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete status = %d, body %s", deleted.Code, deleted.Body.String())
	}
	after := doRowRequest(t, handler, http.MethodGet, "/v1/pinned-evaluations", "")
	if got := decodePinned(t, after.Body.String()); len(got) != 0 {
		t.Fatalf("pins after delete = %v, want none", got)
	}
}

func TestPinnedEvaluationsGuarded(t *testing.T) {
	database := openAPIStore(t)

	readOnly := New(database, Config{ReadOnly: true})
	blocked := doRowRequest(t, readOnly, http.MethodPut, "/v1/pinned-evaluations", `{"instanceIds":[]}`)
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("read-only put status = %d, want 403", blocked.Code)
	}
	open := doRowRequest(t, readOnly, http.MethodGet, "/v1/pinned-evaluations", "")
	if open.Code != http.StatusOK {
		t.Fatalf("read-only get status = %d, want 200", open.Code)
	}

	guarded := New(database, Config{AuthToken: "secret"})
	unauthorized := doRowRequest(t, guarded, http.MethodPut, "/v1/pinned-evaluations", `{"instanceIds":[]}`)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized put status = %d, want 401", unauthorized.Code)
	}
}
