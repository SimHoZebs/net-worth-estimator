package integration

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func balancesDisplayBasis(t *testing.T, handler http.Handler, id string) string {
	t.Helper()
	response := doRowRequest(t, handler, http.MethodGet, "/v1/accounts/balances?asOf=2026-08-13", "")
	if response.Code != http.StatusOK {
		t.Fatalf("balances status = %d: %s", response.Code, response.Body.String())
	}
	var body struct {
		Accounts []struct {
			ID           string `json:"id"`
			DisplayBasis string `json:"displayBasis"`
		} `json:"accounts"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	for _, row := range body.Accounts {
		if row.ID == id {
			if row.DisplayBasis == "" {
				return "available"
			}
			return row.DisplayBasis
		}
	}
	t.Fatalf("account %s missing in %s", id, response.Body.String())
	return ""
}

func TestAccountDisplayBasisPatch(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	created := decodePlanEntrySave[types.Account](t, doRowRequest(t, handler, http.MethodPost, "/v1/accounts",
		`{"name":"Checking","kind":"cash","enabled":true}`))
	if !created.Saved {
		t.Fatalf("create = %+v", created)
	}
	if created.Result.DisplayBasis != types.DisplayBasisAvailable {
		t.Fatalf("create basis = %q", created.Result.DisplayBasis)
	}
	if got := balancesDisplayBasis(t, handler, created.Result.ID); got != "available" {
		t.Fatalf("balances basis = %q", got)
	}
	// Omitted basis keeps the default without touching the row.
	kept := decodePlanEntrySave[types.Account](t, doRowRequest(t, handler, http.MethodPatch, "/v1/accounts/"+created.Result.ID,
		`{"name":"Renamed","kind":"cash","enabled":true}`))
	if !kept.Saved || kept.Result.DisplayBasis != types.DisplayBasisAvailable {
		t.Fatalf("omitted basis = %+v", kept)
	}
	// Posted basis persists and surfaces on the balances row.
	posted := decodePlanEntrySave[types.Account](t, doRowRequest(t, handler, http.MethodPatch, "/v1/accounts/"+created.Result.ID,
		`{"name":"Renamed","kind":"cash","enabled":true,"displayBasis":"posted"}`))
	if !posted.Saved || posted.Result.DisplayBasis != types.DisplayBasisPosted {
		t.Fatalf("posted basis = %+v", posted)
	}
	if got := balancesDisplayBasis(t, handler, created.Result.ID); got != "posted" {
		t.Fatalf("balances basis = %q", got)
	}
	// Omitted basis keeps a stored posted choice.
	again := decodePlanEntrySave[types.Account](t, doRowRequest(t, handler, http.MethodPatch, "/v1/accounts/"+created.Result.ID,
		`{"name":"Renamed twice","kind":"cash","enabled":true}`))
	if !again.Saved || again.Result.DisplayBasis != types.DisplayBasisPosted {
		t.Fatalf("stored basis = %+v", again)
	}
	// Unknown basis never saves.
	rejected := doRowRequest(t, handler, http.MethodPatch, "/v1/accounts/"+created.Result.ID,
		`{"name":"Renamed twice","kind":"cash","enabled":true,"displayBasis":"ledger"}`)
	if rejected.Code != http.StatusOK {
		t.Fatalf("invalid basis status = %d: %s", rejected.Code, rejected.Body.String())
	}
	var invalid writeResult[types.Account]
	if err := json.Unmarshal(rejected.Body.Bytes(), &invalid); err != nil {
		t.Fatal(err)
	}
	if invalid.Saved {
		t.Fatalf("invalid basis saved: %+v", invalid)
	}
	found := false
	for _, issue := range invalid.Issues {
		if issue.Code == "account.displayBasis.unknown" {
			found = true
		}
	}
	if !found {
		t.Fatalf("invalid basis issues = %+v", invalid.Issues)
	}
}

func TestGroupedDisplayBasisPatch(t *testing.T) {
	st := openAPIStore(t)
	if _, err := st.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	h := New(st, Config{})
	created := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPost, "/v1/loans", loanBody))
	if !created.Saved {
		t.Fatalf("create loan = %+v", created)
	}
	id := created.Result.ID
	// Basis-only update on the grouped visible row saves.
	basisOnly := decodePlanEntrySave[types.Account](t, doRowRequest(t, h, http.MethodPatch, "/v1/accounts/"+id,
		`{"name":"Sallie Mae","kind":"debt","enabled":true,"displayBasis":"posted"}`))
	if !basisOnly.Saved || basisOnly.Result.DisplayBasis != types.DisplayBasisPosted {
		t.Fatalf("grouped basis = %+v", basisOnly)
	}
	if basisOnly.Result.Display == nil || len(basisOnly.Result.Display.Components) != 2 {
		t.Fatalf("grouped display lost: %+v", basisOnly.Result.Display)
	}
	if got := balancesDisplayBasis(t, h, id); got != "posted" {
		t.Fatalf("grouped balances basis = %q", got)
	}
	// Any other change still goes through the loan form.
	renamed := doRowRequest(t, h, http.MethodPatch, "/v1/accounts/"+id,
		`{"name":"Renamed","kind":"debt","enabled":true,"displayBasis":"posted"}`)
	if renamed.Code != http.StatusConflict {
		t.Fatalf("grouped rename status = %d, want 409: %s", renamed.Code, renamed.Body.String())
	}
	// Components stay loan-owned.
	component := created.Result.Display.Components[1].AccountID
	blocked := doRowRequest(t, h, http.MethodPatch, "/v1/accounts/"+component,
		`{"name":"Interest","kind":"debt","enabled":true,"displayBasis":"posted"}`)
	if blocked.Code != http.StatusConflict {
		t.Fatalf("component basis status = %d, want 409: %s", blocked.Code, blocked.Body.String())
	}
	if !strings.Contains(renamed.Body.String(), "loan form") {
		t.Fatalf("grouped rename must direct to the loan form: %s", renamed.Body.String())
	}
}
