package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestCurrentPositionHTTP(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{ReadOnly: true})
	// Reuse the complete golden request, but ask only for its historical position.
	var fixture struct {
		Document *types.FinancialModelDocument   `json:"document"`
		Settings types.ProjectionRuntimeSettings `json:"settings"`
	}
	if err := json.Unmarshal(deterministicTestBody(t), &fixture); err != nil {
		t.Fatal(err)
	}
	if err := database.InitializeDocument(); err != nil {
		t.Fatal(err)
	}
	account := fixture.Document.Accounts[0]
	if _, err := database.CreateAccount(account); err != nil {
		t.Fatal(err)
	}
	if _, err := database.SaveCheckpoint(types.Checkpoint{AccountID: account.ID, Date: fixture.Settings.FallbackProjectionStartDate, Balance: 100}); err != nil {
		t.Fatal(err)
	}
	for _, supplied := range []bool{true, false} {
		body := positionRequestBody{AsOfDate: fixture.Settings.FallbackProjectionStartDate}
		if supplied {
			body.Document = fixture.Document
		}
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/position", bytes.NewReader(encoded)))
		if response.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
		var payload struct {
			Result *types.CurrentPosition `json:"result"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		want := 100.0
		if supplied {
			want = 1600
		}
		if payload.Result == nil || payload.Result.NetWorth != want || payload.Result.AsOfDate != body.AsOfDate {
			t.Fatalf("unexpected position: %+v", payload.Result)
		}
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/v1/position", bytes.NewBufferString(`{"asOfDate":"invalid"}`)))
	if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"issues"`)) || bytes.Contains(response.Body.Bytes(), []byte(`"result"`)) {
		t.Fatalf("invalid date: %d %s", response.Code, response.Body.String())
	}
}
