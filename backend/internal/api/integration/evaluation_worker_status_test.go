package integration

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestEvaluationsStatusIsPassive(t *testing.T) {
	scoped := openAPIStore(t)
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.GetProjectionState(); err != nil {
		t.Fatal(err)
	}
	handler := New(scoped, Config{})
	request := func(handler http.Handler, method, path string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(""))
		handler.ServeHTTP(response, req)
		return response
	}
	response := request(handler, "GET", "/v1/evaluations/status")
	if response.Code != 200 || response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("status=%d %s", response.Code, response.Body.String())
	}
	var output struct {
		Status struct {
			State               string `json:"state"`
			CurrentRevision     int64  `json:"currentRevision"`
			Fingerprint         string `json:"fingerprint"`
			ProjectionAvailable bool   `json:"projectionAvailable"`
		} `json:"status"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &output); err != nil {
		t.Fatal(err)
	}
	if output.Status.State != "queued" && output.Status.State != "idle" {
		t.Fatalf("state=%q want queued/idle", output.Status.State)
	}
	runs, _, _, err := scoped.ListEvaluationWorkerRuns()
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 0 {
		t.Fatal("GET started evaluation work")
	}
}
