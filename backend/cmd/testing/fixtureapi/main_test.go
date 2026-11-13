package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	"github.com/simhozebs/net-worth-estimator/backend/internal/integrationfixtures"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
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
	for _, expected := range []string{"", fixtureResourceID, "users/mismatched-user"} {
		r := httptest.NewRequest("GET", "/v1/financial-model", nil)
		r.Header.Set(identity.ResourceHeader, expected)
		w = httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		want := http.StatusNoContent
		if expected == "users/mismatched-user" {
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

// The reset body names bridge accounts with camelCase wire fields. This pins
// the contract browser and demo seeding rely on.
func TestFixtureBankAccountSeedWireContract(t *testing.T) {
	var entries []bankAccountSeed
	if err := json.Unmarshal([]byte(`[{
		"bridgeAccountId": "bridge-checking",
		"bridgeName": "Checking",
		"modelAccountId": "checking",
		"transactions": [{"id": "out-1", "posted": 1781476800, "amount": "-500.00", "description": "Transfer to loan"}]
	}]`), &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].BridgeAccountID != "bridge-checking" ||
		entries[0].BridgeName != "Checking" || entries[0].ModelAccountID != "checking" ||
		len(entries[0].Transactions) != 1 || entries[0].Transactions[0].Amount != "-500.00" {
		t.Fatalf("bankAccountTransactions wire shape changed: %+v", entries)
	}
}

func TestFixtureResetMultiBridgeSeedsTransferLegs(t *testing.T) {
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "multi-bridge.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	scoped, _, err := integrationfixtures.SeedUser(db, "https://issuer.test", "multi-bridge-seed", integrationfixtures.PackBaseline)
	if err != nil {
		t.Fatal(err)
	}
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	known := map[string]bool{}
	for _, account := range model.Accounts {
		known[account.ID] = true
	}
	posted := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC).Unix()
	entries := []bankAccountSeed{
		{BridgeAccountID: "bridge-checking", BridgeName: "Checking", ModelAccountID: "checking", Transactions: []simplefin.Transaction{
			{ID: "transfer-out", Posted: posted, Amount: "-500.00", Description: "Transfer to loan"},
		}},
		{BridgeAccountID: "bridge-loan", BridgeName: "Student loan", ModelAccountID: "loan", Transactions: []simplefin.Transaction{
			{ID: "transfer-in", Posted: posted, Amount: "500.00", Description: "Transfer from checking"},
		}},
		{BridgeAccountID: "bridge-empty", ModelAccountID: "savings"},
	}
	active := activeBankAccountSeeds(entries)
	if len(active) != 2 {
		t.Fatalf("active seeds = %d, want empty entry skipped leaving 2", len(active))
	}
	if err := validateBankAccountSeeds(active, known, ""); err != nil {
		t.Fatal(err)
	}
	accounts, resolved, covered := fixtureBankSnapshot(nil, entries)
	if len(accounts) != 2 {
		t.Fatalf("snapshot accounts = %d, want one per bridge", len(accounts))
	}
	translation, err := simplefin.Translate(&simplefin.AccountSet{Accounts: accounts}, resolved, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, covered)); err != nil {
		t.Fatal(err)
	}
	rows, err := scoped.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("bank rows = %d, want one outflow leg plus one inflow leg", len(rows))
	}
	legs := map[string]string{}
	for _, row := range rows {
		switch {
		case row.Transaction.SourceAccountID != nil:
			legs["outflow"] = *row.Transaction.SourceAccountID
		case len(row.Transaction.Destinations) > 0:
			legs["inflow"] = row.Transaction.Destinations[0]
		default:
			t.Fatalf("bank row carries neither side: %+v", row.Transaction)
		}
	}
	if legs["outflow"] != "checking" || legs["inflow"] != "loan" {
		t.Fatalf("legs = %+v, want outflow on checking plus inflow on loan", legs)
	}
	_, snapshot, claimed, err := scoped.ClaimAnalysis(analysis.Transfer{}.Type(), analysis.Transfer{}.Version())
	if err != nil {
		t.Fatal(err)
	}
	if !claimed {
		t.Fatal("analysis snapshot was not claimed")
	}
	if len(snapshot.Transactions) != 2 {
		t.Fatalf("snapshot transactions = %d, want both legs with source facts", len(snapshot.Transactions))
	}
	byDirection := map[string]string{}
	bridgeAccounts := map[string]bool{}
	for _, item := range snapshot.Transactions {
		if item.Facts.Currency != "USD" || item.Facts.Description == "" {
			t.Fatalf("leg lacks source facts: %+v", item)
		}
		bridgeAccounts[item.AccountID] = true
		amount, err := strconv.ParseFloat(item.Facts.Amount, 64)
		if err != nil {
			t.Fatal(err)
		}
		if amount < 0 {
			byDirection["outflow"] = item.TransactionID
		} else if amount > 0 {
			byDirection["inflow"] = item.TransactionID
		} else {
			t.Fatalf("leg amount is not directional: %+v", item.Facts)
		}
	}
	if byDirection["outflow"] == "" || byDirection["inflow"] == "" {
		t.Fatalf("snapshot legs lack opposite signs: %+v", snapshot.Transactions)
	}
	if len(bridgeAccounts) != 2 {
		t.Fatalf("snapshot legs share one bridge account, transfer pairing stays impossible: %+v", snapshot.Transactions)
	}
	detections, err := analysis.Transfer{}.Analyze(context.Background(), snapshot)
	if err != nil {
		t.Fatal(err)
	}
	paired := false
	for _, detection := range detections {
		if detection.Kind != "transfer" || len(detection.Evidence) == 0 {
			continue
		}
		seen := map[string]bool{detection.TransactionID: true}
		for _, id := range detection.Evidence[0].TransactionIDs {
			seen[id] = true
		}
		if seen[byDirection["outflow"]] && seen[byDirection["inflow"]] {
			paired = true
		}
	}
	if !paired {
		t.Fatalf("transfer detector did not pair the seeded legs: %+v", detections)
	}
}

// The legacy single-account path keeps its exact shape: every row lands on
// fixture-bank mapped to checking, with no multi-bridge entries involved.
func TestFixtureLegacyBankSnapshotUnchanged(t *testing.T) {
	legacy := []simplefin.Transaction{
		{ID: "legacy-1", Posted: time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC).Unix(), Amount: "-12.34", Description: "Coffee"},
	}
	accounts, resolved, covered := fixtureBankSnapshot(legacy, nil)
	if len(accounts) != 1 || accounts[0].ID != "fixture-bank" || accounts[0].ConnID != "fixture-conn" ||
		accounts[0].Currency != "USD" || accounts[0].Balance != "0" || len(accounts[0].Transactions) != 1 {
		t.Fatalf("legacy snapshot account changed: %+v", accounts)
	}
	if len(resolved) != 1 || resolved[simplefin.AccountKey("fixture-conn", "fixture-bank")] != "checking" {
		t.Fatalf("legacy bridge mapping changed: %+v", resolved)
	}
	if len(covered) != 1 || !covered["checking"] {
		t.Fatalf("legacy owned-account set changed: %+v", covered)
	}
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "legacy-bank.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	scoped, _, err := integrationfixtures.SeedUser(db, "https://issuer.test", "legacy-bank-seed", integrationfixtures.PackBaseline)
	if err != nil {
		t.Fatal(err)
	}
	translation, err := simplefin.Translate(&simplefin.AccountSet{Accounts: accounts}, resolved, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, covered)); err != nil {
		t.Fatal(err)
	}
	rows, err := scoped.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Transaction.SourceAccountID == nil || *rows[0].Transaction.SourceAccountID != "checking" {
		t.Fatalf("legacy row did not land on checking: %+v", rows)
	}
}

func TestFixtureBankAccountValidation(t *testing.T) {
	known := map[string]bool{"checking": true, "loan": true}
	posted := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC).Unix()
	leg := func(bridge, model string) bankAccountSeed {
		return bankAccountSeed{BridgeAccountID: bridge, ModelAccountID: model, Transactions: []simplefin.Transaction{
			{ID: bridge + "-tx", Posted: posted, Amount: "1.00", Description: "Seed"},
		}}
	}
	for name, entries := range map[string][]bankAccountSeed{
		"duplicate bridge": {
			leg("bridge-a", "checking"),
			leg("bridge-a", "loan"),
		},
		"unknown model account": {
			leg("bridge-a", "missing"),
		},
		"legacy bridge collision": {
			leg("fixture-bank", "checking"),
		},
		"missing bridge id": {
			leg("", "checking"),
		},
	} {
		t.Run(name, func(t *testing.T) {
			legacy := ""
			if name == "legacy bridge collision" {
				legacy = "fixture-bank"
			}
			err := validateBankAccountSeeds(activeBankAccountSeeds(entries), known, legacy)
			var inputErr *fixtureInputError
			if !errors.As(err, &inputErr) {
				t.Fatalf("validation error = %v, want a 400 fixture input error", err)
			}
		})
	}
	if err := validateBankAccountSeeds(activeBankAccountSeeds([]bankAccountSeed{
		leg("bridge-a", "checking"),
		leg("bridge-b", "loan"),
	}), known, ""); err != nil {
		t.Fatalf("distinct bridges on known accounts must validate: %v", err)
	}
}
