package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func presetRequest(t *testing.T, handler http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal preset body: %v", err)
		}
		reader = bytes.NewReader(payload)
	}
	request := httptest.NewRequest(method, path, reader)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func decodePresetOutput(t *testing.T, response *httptest.ResponseRecorder) presetResultBody {
	t.Helper()
	var payload struct {
		Row       types.AmountPreset           `json:"row"`
		Issues    []types.ModelValidationIssue `json:"issues"`
		Persisted bool                         `json:"persisted"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode preset response: %v", err)
	}
	return presetResultBody(payload)
}

func validPresetBody() types.AmountPreset {
	return types.AmountPreset{
		Name: "custom", Label: "Custom", Enabled: true,
		Amount: types.PostingAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": "10"},
			Inputs:   map[string]types.AmountInputBinding{},
		},
	}
}

func TestPresetListServesSeeds(t *testing.T) {
	handler := New(openAPIStore(t), Config{})
	response := presetRequest(t, handler, http.MethodGet, "/v1/amount-presets", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("GET status = %d, body %s", response.Code, response.Body.String())
	}
	var payload struct {
		Presets []types.AmountPreset `json:"presets"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode preset list: %v", err)
	}
	if len(payload.Presets) != 8 {
		t.Fatalf("seeded presets = %d, want 8", len(payload.Presets))
	}
}

func TestPresetCreateRoundTrip(t *testing.T) {
	handler := New(openAPIStore(t), Config{})
	response := presetRequest(t, handler, http.MethodPost, "/v1/amount-presets", validPresetBody())
	if response.Code != http.StatusOK {
		t.Fatalf("POST status = %d, body %s", response.Code, response.Body.String())
	}
	out := decodePresetOutput(t, response)
	if !out.Persisted || out.Row.ID == "" || out.Row.Name != "custom" {
		t.Fatalf("create preset = %+v", out)
	}
	id := out.Row.ID

	dup := presetRequest(t, handler, http.MethodPost, "/v1/amount-presets", validPresetBody())
	if dup.Code != http.StatusConflict {
		t.Fatalf("duplicate POST status = %d, want 409", dup.Code)
	}

	out.Row.Label = "Renamed"
	update := presetRequest(t, handler, http.MethodPatch, "/v1/amount-presets/"+id, out.Row)
	if update.Code != http.StatusOK {
		t.Fatalf("PATCH status = %d, body %s", update.Code, update.Body.String())
	}
	updated := decodePresetOutput(t, update)
	if !updated.Persisted || updated.Row.Label != "Renamed" {
		t.Fatalf("update preset = %+v", updated)
	}

	renamed := updated.Row
	renamed.Name = "other"
	immutable := presetRequest(t, handler, http.MethodPatch, "/v1/amount-presets/"+id, renamed)
	if immutable.Code != http.StatusUnprocessableEntity {
		t.Fatalf("rename PATCH status = %d, want 422", immutable.Code)
	}

	moved := presetRequest(t, handler, http.MethodPost, "/v1/amount-presets/reorder", map[string]string{"id": id})
	if moved.Code != http.StatusOK {
		t.Fatalf("reorder POST status = %d, body %s", moved.Code, moved.Body.String())
	}

	deleted := presetRequest(t, handler, http.MethodDelete, "/v1/amount-presets/"+id, nil)
	if deleted.Code != http.StatusOK {
		t.Fatalf("DELETE status = %d, body %s", deleted.Code, deleted.Body.String())
	}
	missing := presetRequest(t, handler, http.MethodDelete, "/v1/amount-presets/"+id, nil)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("second DELETE status = %d, want 404", missing.Code)
	}
}

func TestPresetCreateRejectsBadAmount(t *testing.T) {
	handler := New(openAPIStore(t), Config{})
	body := validPresetBody()
	body.Amount = types.PostingAmountResolution{
		Resolver: "nope",
		Config:   map[string]any{},
		Inputs:   map[string]types.AmountInputBinding{},
	}
	response := presetRequest(t, handler, http.MethodPost, "/v1/amount-presets", body)
	if response.Code != http.StatusOK {
		t.Fatalf("POST status = %d, body %s", response.Code, response.Body.String())
	}
	out := decodePresetOutput(t, response)
	if out.Persisted {
		t.Fatalf("bad preset persisted: %+v", out)
	}
	hasAmountIssue := false
	for _, issue := range out.Issues {
		if issue.Severity == types.SeverityError {
			hasAmountIssue = true
		}
	}
	if !hasAmountIssue {
		t.Fatalf("bad preset issues = %+v, want error", out.Issues)
	}
}

func TestPresetCreateRejectsBlankLabel(t *testing.T) {
	handler := New(openAPIStore(t), Config{})
	body := validPresetBody()
	body.Label = "  "
	response := presetRequest(t, handler, http.MethodPost, "/v1/amount-presets", body)
	out := decodePresetOutput(t, response)
	if out.Persisted {
		t.Fatalf("blank-label preset persisted: %+v", out)
	}
}
