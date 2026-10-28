package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func TestCapabilitiesDriveReadOnlyStatusWithoutIdentityFallback(t *testing.T) {
	db, err := sqlite.Open(filepath.Join(t.TempDir(), "model.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, canWrite := range []bool{false, true} {
		h := New(db, Config{CanWrite: func(context.Context) bool { return canWrite }})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
		var status struct {
			ReadOnly bool `json:"readOnly"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
			t.Fatal(err)
		}
		if status.ReadOnly == canWrite {
			t.Fatalf("viewer status=%+v", status)
		}
		w = httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/auth/session", nil))
		if w.Code != http.StatusNotFound {
			t.Fatalf("bare API must not provide an authentication bypass: %d %s", w.Code, w.Body.String())
		}
	}
}

func TestBareAPIStatusForFixtureHarness(t *testing.T) {
	db, err := sqlite.Open(filepath.Join(t.TempDir(), "model.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := New(db, Config{})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/status", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("fixture status=%d", w.Code)
	}
}
