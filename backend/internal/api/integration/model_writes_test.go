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

type countingModelStore struct {
	store.Store
	loads int
}

func (s *countingModelStore) LoadModel() (*types.FinancialModel, error) {
	s.loads++
	return s.Store.LoadModel()
}

func decodePlanEntrySave[T any](t *testing.T, response *httptest.ResponseRecorder) rowResultBody[T] {
	t.Helper()
	if response.Code != http.StatusOK {
		t.Fatalf("save status = %d, body %s", response.Code, response.Body.String())
	}
	var result rowResultBody[T]
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
	database := &countingModelStore{Store: openAPIStore(t)}
	handler := New(database, Config{})
	created := decodePlanEntrySave[types.Account](t, doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"name":"Probe","kind":"cash","enabled":true}`))
	if !created.Persisted || created.Row.ID == "" {
		t.Fatalf("create = %+v", created)
	}
	if database.loads != 2 {
		t.Errorf("create complete-plan loads = %d, want 2", database.loads)
	}
	model := assertSavedModelIdentity(t, database.Store, created.Revision)
	if len(model.Accounts) != 1 || model.Accounts[0].ID != created.Row.ID || model.Accounts[0].Name != created.Row.Name {
		t.Fatalf("generated account identity/name differs from stored content: %+v", model.Accounts)
	}
	if created.Row.MinBalance != nil || created.Row.MaxBalance != nil ||
		model.Accounts[0].MinBalance == nil || *model.Accounts[0].MinBalance != types.NoFloor ||
		model.Accounts[0].MaxBalance == nil || *model.Accounts[0].MaxBalance != types.NoCeiling {
		t.Fatalf("stored bounds must normalize without changing the response: response %+v, stored %+v", created.Row, model.Accounts[0])
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
		!strings.Contains(created.Issues[0].Message, created.Row.ID) {
		t.Fatalf("warnings must use the generated stored ID: %+v", created.Issues)
	}

	previousRevision := created.Revision
	for _, name := range []string{"Renamed", "Last write"} {
		database.loads = 0
		updated := decodePlanEntrySave[types.Account](t, doRowRequest(t, handler, http.MethodPatch, "/v1/accounts/"+created.Row.ID,
			`{"name":"`+name+`","kind":"cash","enabled":false}`))
		if !updated.Persisted || updated.Row.ID != created.Row.ID || updated.Row.Name != name {
			t.Fatalf("update = %+v", updated)
		}
		if database.loads != 2 {
			t.Errorf("update complete-plan loads = %d, want 2", database.loads)
		}
		model = assertSavedModelIdentity(t, database.Store, updated.Revision)
		if model.Accounts[0].ID != created.Row.ID || model.Accounts[0].Name != name || model.Accounts[0].Enabled || len(updated.Issues) != 0 {
			t.Fatalf("update must return stored content and empty issues: %+v", updated)
		}
		if updated.Revision == previousRevision {
			t.Fatal("changed plan must have a new identity")
		}
		previousRevision = updated.Revision
	}
}

func TestBalanceCheckSaveUsesStoredOwnership(t *testing.T) {
	database := &countingModelStore{Store: openAPIStore(t)}
	if _, err := database.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash}); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	if _, err := database.ApplySyncPlan([]store.SyncCheckpoint{
		{AccountID: "checking", Balance: 10, ObservedAt: 1785974399},
		{AccountID: "checking", Balance: 20, ObservedAt: 1786060799},
	}, nil); err != nil {
		t.Fatalf("seed synced balance checks: %v", err)
	}
	handler := New(database, Config{})
	saved := decodePlanEntrySave[types.Checkpoint](t, doRowRequest(t, handler, http.MethodPost, "/v1/checkpoints",
		`{"AccountId":"checking","Balance":30,"source":"simplefin","observedAt":1785974399}`))
	if !saved.Persisted || saved.Row.Source != store.SourceUser || saved.Row.Balance != 30 {
		t.Fatalf("owner balance check = %+v", saved)
	}
	if database.loads != 2 {
		t.Errorf("balance-check complete-plan loads = %d, want 2", database.loads)
	}
	model := assertSavedModelIdentity(t, database.Store, saved.Revision)
	if len(model.Checkpoints) != 2 || !reflect.DeepEqual(model.Checkpoints[0], saved.Row) ||
		model.Checkpoints[1].Source != store.SourceSimpleFIN || model.Checkpoints[1].Balance != 20 {
		t.Fatalf("balance-check ownership/key changed: %+v", model.Checkpoints)
	}
	if len(saved.Issues) != 0 {
		t.Fatalf("balance-check issues = %+v", saved.Issues)
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
		{"uninitialized", false, http.MethodPost, "/v1/checkpoints", `{"AccountId":"ghost","Balance":10,"observedAt":1785974399}`},
		{"invalid creation", true, http.MethodPost, "/v1/checkpoints", `{"AccountId":"ghost","Balance":10,"observedAt":1785974399}`},
		{"invalid update", true, http.MethodPatch, "/v1/accounts/checking", `{"name":"Invalid","kind":"cash","minBalance":10,"maxBalance":5,"enabled":true}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			database := &countingModelStore{Store: openAPIStore(t)}
			if test.seed {
				if _, err := database.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash}); err != nil {
					t.Fatalf("seed account: %v", err)
				}
			}
			before, err := database.Store.LoadModel()
			if err != nil {
				t.Fatalf("load original plan: %v", err)
			}
			rejected := decodePlanEntrySave[json.RawMessage](t, doRowRequest(t, New(database, Config{}), test.method, test.path, test.body))
			if rejected.Persisted || !hasErrorIssues(rejected.Issues) {
				t.Fatalf("invalid save = %+v", rejected)
			}
			if database.loads != 2 {
				t.Errorf("rejected-save complete-plan loads = %d, want 2", database.loads)
			}
			after := assertSavedModelIdentity(t, database.Store, rejected.Revision)
			if !reflect.DeepEqual(before, after) {
				t.Fatal("rejected save changed stored content")
			}
		})
	}
}

func TestAccountLinkWritesKeepIdentityLookup(t *testing.T) {
	database := &countingModelStore{Store: openAPIStore(t)}
	// Links do not use whole-plan validation, even if stored content has errors.
	if _, err := database.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "unknown"}); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	model, err := database.Store.LoadModel()
	if err != nil || !hasErrorIssues(domainValidate(model)) {
		t.Fatalf("seed must have validation errors: model %+v, error %v", model, err)
	}
	handler := New(database, Config{})
	linked := doRowRequest(t, handler, http.MethodPut, "/v1/sync/simplefin/accounts/bridge-1", `{"modelAccountId":"checking"}`)
	if linked.Code != http.StatusOK {
		t.Fatalf("link status = %d, body %s", linked.Code, linked.Body.String())
	}
	var saved struct {
		Link     store.AccountLink `json:"link"`
		Revision string            `json:"revision"`
	}
	if err := json.Unmarshal(linked.Body.Bytes(), &saved); err != nil {
		t.Fatalf("decode link: %v", err)
	}
	if database.loads != 1 || saved.Link.ModelAccountID != "checking" || saved.Link.Origin != store.LinkOriginManual {
		t.Fatalf("link must retain direct identity lookup: loads %d, response %+v", database.loads, saved)
	}
	assertSavedModelIdentity(t, database.Store, saved.Revision)
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(linked.Body.Bytes(), &fields); err != nil {
		t.Fatalf("decode link fields: %v", err)
	}
	for _, field := range []string{"row", "issues", "persisted"} {
		if _, exists := fields[field]; exists {
			t.Fatalf("link response must retain its distinct shape: %s", linked.Body.String())
		}
	}

	database.loads = 0
	unlinked := doRowRequest(t, handler, http.MethodDelete, "/v1/sync/simplefin/accounts/bridge-1", "")
	if unlinked.Code != http.StatusOK || database.loads != 1 {
		t.Fatalf("unlink status = %d, loads %d, body %s", unlinked.Code, database.loads, unlinked.Body.String())
	}
	var deleted struct {
		Revision string `json:"revision"`
	}
	if err := json.Unmarshal(unlinked.Body.Bytes(), &deleted); err != nil {
		t.Fatalf("decode unlink: %v", err)
	}
	assertSavedModelIdentity(t, database.Store, deleted.Revision)
	links, err := database.ListAccountLinks()
	if err != nil || len(links) != 0 {
		t.Fatalf("links after delete = %+v, error %v", links, err)
	}
}
