package integration

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func decodePlanEntrySave[T any](t *testing.T, response *httptest.ResponseRecorder) writeResult[T] {
	t.Helper()
	if response.Code != http.StatusOK {
		t.Fatalf("save status = %d, body %s", response.Code, response.Body.String())
	}
	var result writeResult[T]
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode save: %v", err)
	}
	if result.Issues == nil {
		t.Fatal("save issues must be an array")
	}
	return result
}

func assertSavedModelIdentity(t *testing.T, database store.Store, revision string) *types.FinancialModel {
	t.Helper()
	model, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load stored plan: %v", err)
	}
	want, err := store.ModelETag(model)
	if err != nil {
		t.Fatalf("hash stored plan: %v", err)
	}
	if revision != want {
		t.Fatalf("response identity = %q, stored identity = %q", revision, want)
	}
	return model
}

func TestPlanEntrySaveReusesStoredSnapshot(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	created := decodePlanEntrySave[types.Account](t, doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"name":"Probe","kind":"cash","enabled":true}`))
	if !created.Saved || created.Result.ID == "" {
		t.Fatalf("create = %+v", created)
	}
	model := assertSavedModelIdentity(t, database, created.Revision)
	if len(model.Accounts) != 1 || model.Accounts[0].ID != created.Result.ID || model.Accounts[0].Name != created.Result.Name {
		t.Fatalf("generated account identity/name differs from stored content: %+v", model.Accounts)
	}
	if created.Result.MinBalance != nil || created.Result.MaxBalance != nil ||
		model.Accounts[0].MinBalance == nil || *model.Accounts[0].MinBalance != types.NoFloor ||
		model.Accounts[0].MaxBalance == nil || *model.Accounts[0].MaxBalance != types.NoCeiling {
		t.Fatalf("stored bounds must normalize without changing the response: response %+v, stored %+v", created.Result, model.Accounts[0])
	}
	wantIssues, err := json.Marshal(domainValidate(model))
	if err != nil {
		t.Fatalf("encode stored warnings: %v", err)
	}
	gotIssues, err := json.Marshal(created.Issues)
	if err != nil {
		t.Fatalf("encode response warnings: %v", err)
	}
	if string(gotIssues) != string(wantIssues) || len(created.Issues) != 1 ||
		!strings.Contains(created.Issues[0].Message, created.Result.ID) {
		t.Fatalf("warnings must use the generated stored ID: %+v", created.Issues)
	}

	previousRevision := created.Revision
	for _, name := range []string{"Renamed", "Last write"} {
		updated := decodePlanEntrySave[types.Account](t, doRowRequest(t, handler, http.MethodPatch, "/v1/accounts/"+created.Result.ID,
			`{"name":"`+name+`","kind":"cash","enabled":false}`))
		if !updated.Saved || updated.Result.ID != created.Result.ID || updated.Result.Name != name {
			t.Fatalf("update = %+v", updated)
		}
		model = assertSavedModelIdentity(t, database, updated.Revision)
		if model.Accounts[0].ID != created.Result.ID || model.Accounts[0].Name != name || model.Accounts[0].Enabled || len(updated.Issues) != 0 {
			t.Fatalf("update must return stored content and empty issues: %+v", updated)
		}
		if updated.Revision == previousRevision {
			t.Fatal("changed plan must have a new identity")
		}
		previousRevision = updated.Revision
	}
}

func TestRejectedPlanEntrySaveUsesStoredIdentity(t *testing.T) {
	for _, test := range []struct {
		name   string
		seed   bool
		method string
		path   string
		body   string
	}{
		{"invalid update", true, http.MethodPatch, "/v1/accounts/checking", `{"name":"Invalid","kind":"cash","minBalance":10,"maxBalance":5,"enabled":true}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			database := openAPIStore(t)
			if test.seed {
				if _, err := database.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash}); err != nil {
					t.Fatalf("seed account: %v", err)
				}
			}
			before, err := database.LoadModel()
			if err != nil {
				t.Fatalf("load original plan: %v", err)
			}
			rejected := decodePlanEntrySave[json.RawMessage](t, doRowRequest(t, New(database, Config{}), test.method, test.path, test.body))
			if rejected.Saved || !hasErrorIssues(rejected.Issues) {
				t.Fatalf("invalid save = %+v", rejected)
			}
			after := assertSavedModelIdentity(t, database, rejected.Revision)
			if !reflect.DeepEqual(before, after) {
				t.Fatal("rejected save changed stored content")
			}
		})
	}
}
