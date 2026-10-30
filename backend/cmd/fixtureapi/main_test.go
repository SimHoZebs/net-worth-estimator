package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
)

func TestFixtureSessionUsesScopedProductionContract(t *testing.T) {
	handler := fixtureHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/v1/auth/session", nil))
	var session struct {
		Enabled, Authenticated, Allowed bool
		User                            map[string]string
		Resource                        struct {
			ID          string
			Permissions []string
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	if res, ok := raw["resource"].(map[string]any); ok {
		if _, hasKind := res["kind"]; hasKind {
			t.Fatalf("fixture resource must not expose kind: %s", w.Body.String())
		}
	}
	if w.Code != 200 || !session.Enabled || !session.Authenticated || !session.Allowed || session.Resource.ID != fixtureResourceID || len(session.Resource.Permissions) != 3 || session.User["subject"] == "" || session.User["subject"] != fixtureSubject {
		t.Fatalf("invalid fixture session: %s", w.Body.String())
	}
	if len(session.Resource.ID) != len("users/")+64 {
		t.Fatalf("fixture resource must be ordinary users/<64hex>: %q", session.Resource.ID)
	}
	if w.Header().Get(identity.ResourceHeader) != fixtureResourceID || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("fixture session is missing its resource or cache boundary")
	}
	for _, expected := range []string{"", fixtureResourceID, "users/sample"} {
		r := httptest.NewRequest("GET", "/v1/financial-model", nil)
		r.Header.Set(identity.ResourceHeader, expected)
		w = httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		want := http.StatusNoContent
		if expected == "users/sample" {
			want = http.StatusConflict
		}
		if w.Code != want || w.Header().Get(identity.ResourceHeader) != fixtureResourceID {
			t.Fatalf("assertion %q: status=%d want=%d", expected, w.Code, want)
		}
		if want == http.StatusConflict {
			var problem struct{ Code string }
			if err := json.Unmarshal(w.Body.Bytes(), &problem); err != nil {
				t.Fatal(err)
			}
			if problem.Code != "RESOURCE_CHANGED" {
				t.Fatalf("resource conflict lacks its production code: %+v", problem)
			}
		}
	}
}
