package store

import (
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func testPostingFixture(id string) types.Posting {
	source := "checking"
	return types.Posting{
		ID:              id,
		Name:            "Posting " + id,
		SourceAccountID: &source,
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		Date:            "2026-07-02",
		Priority:        3,
		Enabled:         true,
	}
}

func testRuleFixture(id string) types.RecurrenceRule {
	return types.RecurrenceRule{
		ID:        id,
		Name:      "Rule " + id,
		Frequency: types.FrequencyMonthly,
		Amount:    types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		StartDate: "2026-01-01",
		Priority:  3,
		Enabled:   true,
	}
}

func TestRowAccountCRUD(t *testing.T) {
	store := openTestStore(t)
	created, err := store.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	if created.ID != "checking" {
		t.Fatalf("account id = %q", created.ID)
	}
	generated, err := store.CreateAccount(types.Account{Name: "Generated", Enabled: true})
	if err != nil {
		t.Fatalf("create generated account: %v", err)
	}
	if generated.ID == "" {
		t.Fatal("generated account has no id")
	}
	if _, err := store.CreateAccount(types.Account{ID: "checking", Name: "Dupe"}); !IsIDConflict(err) {
		t.Fatalf("duplicate account err = %v, want id-conflict", err)
	}
	updated, err := store.UpdateAccount(types.Account{ID: "checking", Name: "Renamed", Enabled: false})
	if err != nil || updated.Name != "Renamed" || updated.Enabled {
		t.Fatalf("update account = %+v, err %v", updated, err)
	}
	if _, err := store.UpdateAccount(types.Account{ID: "missing", Name: "Missing"}); !IsNotFound(err) {
		t.Fatalf("update missing err = %v, want not-found", err)
	}
	if err := store.MoveAccount(generated.ID, "checking"); err != nil {
		t.Fatalf("move account: %v", err)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(loaded.Accounts) != 2 || loaded.Accounts[0].ID != generated.ID || loaded.Accounts[1].ID != "checking" {
		t.Fatalf("account order = %+v", loaded.Accounts)
	}
	if err := store.MoveAccount("ghost", ""); !IsNotFound(err) {
		t.Fatalf("move missing err = %v, want not-found", err)
	}
	if err := store.MoveAccount("checking", "ghost"); !IsNotFound(err) {
		t.Fatalf("move before missing err = %v, want not-found", err)
	}
	if err := store.DeleteAccount(generated.ID); err != nil {
		t.Fatalf("delete account: %v", err)
	}
	if err := store.DeleteAccount(generated.ID); !IsNotFound(err) {
		t.Fatalf("delete missing err = %v, want not-found", err)
	}
	// A released ID is claimable again.
	if _, err := store.CreateAccount(types.Account{ID: generated.ID, Name: "Reclaimed"}); err != nil {
		t.Fatalf("reclaim id: %v", err)
	}
}

func TestRowIDRegistrySpansTables(t *testing.T) {
	store := openTestStore(t)
	if _, err := store.CreateAccount(types.Account{ID: "shared", Name: "Account"}); err != nil {
		t.Fatalf("create account: %v", err)
	}
	if _, err := store.CreatePosting(testPostingFixture("shared")); !IsIDConflict(err) {
		t.Fatalf("posting over account id err = %v, want id-conflict", err)
	}
	if _, err := store.CreateRule(testRuleFixture("shared")); !IsIDConflict(err) {
		t.Fatalf("rule over account id err = %v, want id-conflict", err)
	}
	if _, err := store.CreateEvaluation(EvaluationUpdate{Type: "netWorthThreshold", InstanceID: "shared", Name: "Eval"}); !IsIDConflict(err) {
		t.Fatalf("evaluation over account id err = %v, want id-conflict", err)
	}
	if err := store.DeleteAccount("shared"); err != nil {
		t.Fatalf("delete account: %v", err)
	}
	if _, err := store.CreatePosting(testPostingFixture("shared")); err != nil {
		t.Fatalf("posting over released id: %v", err)
	}
}

func TestRowPostingRuleCheckpointCRUD(t *testing.T) {
	store := openTestStore(t)
	if _, err := store.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatalf("create account: %v", err)
	}
	if _, err := store.CreatePosting(testPostingFixture("")); err != nil {
		t.Fatalf("create generated posting: %v", err)
	}
	rule, err := store.CreateRule(testRuleFixture("rent"))
	if err != nil {
		t.Fatalf("create rule: %v", err)
	}
	rule.Priority = 9
	if _, err := store.UpdateRule(rule); err != nil {
		t.Fatalf("update rule: %v", err)
	}
	saved, err := store.SaveCheckpoint(types.Checkpoint{Date: "2026-08-05", AccountID: "checking", Balance: 100})
	if err != nil || saved.Source != SourceModel {
		t.Fatalf("save checkpoint = %+v, err %v", saved, err)
	}
	saved, err = store.SaveCheckpoint(types.Checkpoint{Date: "2026-08-05", AccountID: "checking", Balance: 150})
	if err != nil || saved.Balance != 150 {
		t.Fatalf("upsert checkpoint = %+v, err %v", saved, err)
	}
	if err := store.DeleteCheckpoint("checking", "2026-08-05"); err != nil {
		t.Fatalf("delete checkpoint: %v", err)
	}
	if err := store.DeleteCheckpoint("checking", "2026-08-05"); !IsNotFound(err) {
		t.Fatalf("delete missing checkpoint err = %v, want not-found", err)
	}
	terms := types.PaymentTerms{AccountID: "checking", MinimumFixed: 25, DueDay: 10}
	if _, err := store.SavePaymentTerms(terms); err != nil {
		t.Fatalf("save terms: %v", err)
	}
	if err := store.DeletePaymentTerms("checking"); err != nil {
		t.Fatalf("delete terms: %v", err)
	}
	if err := store.DeleteRule("rent"); err != nil {
		t.Fatalf("delete rule: %v", err)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(loaded.Checkpoints) != 0 || len(loaded.RecurrenceRules) != 0 || len(loaded.PaymentTerms) != 0 {
		t.Fatalf("residual rows: %+v", loaded)
	}
	if len(loaded.Postings) != 1 {
		t.Fatalf("postings = %+v, want the generated one", loaded.Postings)
	}
}

func TestRowEvaluationCRUD(t *testing.T) {
	store := openTestStore(t)
	created, err := store.CreateEvaluation(EvaluationUpdate{Type: "netWorthThreshold", Name: "Target", Enabled: true, Config: map[string]any{"target": 100}})
	if err != nil || created.InstanceID == "" {
		t.Fatalf("create evaluation = %+v, err %v", created, err)
	}
	if _, err := store.CreateEvaluation(EvaluationUpdate{Type: "bogus", Name: "Bogus"}); err == nil {
		t.Fatal("expected unknown evaluation type to fail")
	}
	created.Name = "Renamed"
	if _, err := store.UpdateEvaluation(created); err != nil {
		t.Fatalf("update evaluation: %v", err)
	}
	second, err := store.CreateEvaluation(EvaluationUpdate{Type: "netWorthThreshold", Name: "Second"})
	if err != nil {
		t.Fatalf("create second: %v", err)
	}
	if err := store.MoveEvaluation("netWorthThreshold", second.InstanceID, created.InstanceID); err != nil {
		t.Fatalf("move evaluation: %v", err)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	got := loaded.Evaluations.NetWorthThreshold
	if len(got) != 2 || got[0].InstanceID != second.InstanceID || got[1].Name != "Renamed" {
		t.Fatalf("evaluation order = %+v", got)
	}
	if err := store.DeleteEvaluation(created.InstanceID); err != nil {
		t.Fatalf("delete evaluation: %v", err)
	}
	if err := store.DeleteEvaluation(created.InstanceID); !IsNotFound(err) {
		t.Fatalf("delete missing err = %v, want not-found", err)
	}
}

func TestRowRoundTripsPreserveOrder(t *testing.T) {
	testRowRoundTripsPreserveOrder(t, openTestStore)
}

func testRowRoundTripsPreserveOrder(t *testing.T, newStore func(*testing.T) Store) {
	t.Helper()
	store := newStore(t)
	for _, id := range []string{"a", "b", "c"} {
		if _, err := store.CreateAccount(types.Account{ID: id, Name: id}); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
	}
	if err := store.MoveAccount("c", "a"); err != nil {
		t.Fatalf("move: %v", err)
	}
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	var order []string
	for _, account := range loaded.Accounts {
		order = append(order, account.ID)
	}
	if !reflect.DeepEqual(order, []string{"c", "a", "b"}) {
		t.Fatalf("order = %v, want [c a b]", order)
	}
}

func TestAccountLinksCRUD(t *testing.T) {
	store := openTestStore(t)
	if _, err := store.CreateAccount(types.Account{ID: "checking", Name: "Checking"}); err != nil {
		t.Fatalf("create account: %v", err)
	}
	if _, err := store.CreateAccount(types.Account{ID: "other", Name: "Other"}); err != nil {
		t.Fatalf("create other: %v", err)
	}
	if _, err := store.SaveAccountLink(AccountLink{BridgeAccountID: "b9", ModelAccountID: "ghost"}); !IsAccountMissing(err) {
		t.Fatalf("link missing account err = %v, want account-missing", err)
	}
	saved, err := store.SaveAccountLink(AccountLink{BridgeAccountID: "b1", ModelAccountID: "checking", BridgeName: "College", Currency: "USD"})
	if err != nil || saved.Origin != LinkOriginManual {
		t.Fatalf("save link = %+v, err %v", saved, err)
	}
	if _, err := store.SaveAccountLink(AccountLink{BridgeAccountID: "b2", ModelAccountID: "checking"}); !IsIDConflict(err) {
		t.Fatalf("double-link err = %v, want id-conflict", err)
	}
	links, err := store.ListAccountLinks()
	if err != nil || len(links) != 1 {
		t.Fatalf("links = %+v, err %v", links, err)
	}
	if err := store.DeleteAccountLink("b1"); err != nil {
		t.Fatalf("delete link: %v", err)
	}
	if err := store.DeleteAccountLink("b1"); !IsNotFound(err) {
		t.Fatalf("delete missing link err = %v, want not-found", err)
	}
}

func TestProvisionSyncAccounts(t *testing.T) {
	store := openTestStore(t)
	if _, err := store.CreateAccount(types.Account{ID: "checking", Name: "Checking"}); err != nil {
		t.Fatalf("create account: %v", err)
	}
	resolved, provisioned, err := store.ProvisionSyncAccounts([]SyncProvision{
		{BridgeID: "bridge-checking", ModelAccountID: "checking", Name: "College", Currency: "USD"},
		{BridgeID: "bridge-new", Name: "New Card", Currency: "USD", Kind: types.AccountKind("debt")},
	}, true)
	if err != nil {
		t.Fatalf("dry-run provision: %v", err)
	}
	if provisioned != 1 || resolved["bridge-checking"] != "checking" || resolved["bridge-new"] == "" {
		t.Fatalf("dry-run resolved = %v provisioned = %d", resolved, provisioned)
	}
	if links, err := store.ListAccountLinks(); err != nil || len(links) != 0 {
		t.Fatalf("dry run wrote links: %+v, err %v", links, err)
	}
	resolved, provisioned, err = store.ProvisionSyncAccounts([]SyncProvision{
		{BridgeID: "bridge-checking", ModelAccountID: "checking", Name: "College", Currency: "USD"},
		{BridgeID: "bridge-new", Name: "New Card", Currency: "USD", Kind: types.AccountKind("debt")},
	}, false)
	if err != nil {
		t.Fatalf("provision: %v", err)
	}
	if provisioned != 1 {
		t.Fatalf("provisioned = %d, want 1", provisioned)
	}
	newID := resolved["bridge-new"]
	loaded, err := store.LoadDocument()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	found := false
	for _, account := range loaded.Accounts {
		if account.ID == newID && account.Name == "New Card" && string(account.Kind) == "debt" {
			found = true
		}
	}
	if !found {
		t.Fatalf("provisioned account missing: %+v", loaded.Accounts)
	}
	links, err := store.ListAccountLinks()
	if err != nil || len(links) != 2 {
		t.Fatalf("links = %+v, err %v", links, err)
	}
	// Re-running is idempotent: links resolve, nothing new is created.
	_, provisioned, err = store.ProvisionSyncAccounts([]SyncProvision{
		{BridgeID: "bridge-new", Name: "Renamed Card", Currency: "USD", Kind: types.AccountKind("debt")},
	}, false)
	if err != nil || provisioned != 0 {
		t.Fatalf("re-provision = %d, err %v", provisioned, err)
	}
	links, err = store.ListAccountLinks()
	if err != nil {
		t.Fatalf("links: %v", err)
	}
	for _, link := range links {
		if link.BridgeAccountID == "bridge-new" && link.BridgeName != "Renamed Card" {
			t.Fatalf("snapshot not refreshed: %+v", link)
		}
	}
	if _, _, err := store.ProvisionSyncAccounts([]SyncProvision{
		{BridgeID: "bridge-ghost", ModelAccountID: "ghost", Name: "Ghost"},
	}, false); !IsAccountMissing(err) {
		t.Fatalf("bootstrap missing account err = %v, want account-missing", err)
	}
}

func TestV8MigrationBackfillsRegistryAndLinks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v7.db")
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open raw: %v", err)
	}
	tx, err := raw.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	for _, migrate := range []func(*sql.Tx) error{migrateV1, migrateV2, migrateV3, migrateV4, migrateV5, migrateV6, migrateV7} {
		if err := migrate(tx); err != nil {
			t.Fatalf("migrate: %v", err)
		}
	}
	for _, statement := range []string{
		`CREATE TABLE schema_version (version INTEGER NOT NULL)`,
		`INSERT INTO schema_version (version) VALUES (1)`,
		`INSERT INTO schema_version (version) VALUES (2)`,
		`INSERT INTO schema_version (version) VALUES (3)`,
		`INSERT INTO schema_version (version) VALUES (4)`,
		`INSERT INTO schema_version (version) VALUES (5)`,
		`INSERT INTO schema_version (version) VALUES (6)`,
		`INSERT INTO schema_version (version) VALUES (7)`,
		`INSERT INTO accounts (id, position, name, kind, enabled) VALUES ('checking', 0, 'Checking', 'cash', 1)`,
		`INSERT INTO postings (id, position, name, amount_json, date, priority, enabled, source) VALUES ('rent', 0, 'Rent', '{}', '2026-08-01', 1, 1, 'model')`,
		`INSERT INTO evaluations (type, instance_id, position, name, enabled, config_json) VALUES ('netWorthThreshold', 'eval-1', 0, 'Target', 1, '{}')`,
		`UPDATE model_metadata SET document_present = 1 WHERE id = 1`,
	} {
		if _, err := tx.Exec(statement); err != nil {
			t.Fatalf("seed v7 %q: %v", statement, err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("close raw: %v", err)
	}
	opened, err := Open(path)
	if err != nil {
		t.Fatalf("open migrates to v8: %v", err)
	}
	t.Cleanup(func() { _ = opened.Close() })
	if _, err := opened.CreatePosting(testPostingFixture("rent")); !IsIDConflict(err) {
		t.Fatalf("posting over migrated id err = %v, want id-conflict", err)
	}
	if _, err := opened.CreateAccount(types.Account{ID: "eval-1", Name: "Clash"}); !IsIDConflict(err) {
		t.Fatalf("account over migrated eval id err = %v, want id-conflict", err)
	}
	links, err := opened.ListAccountLinks()
	if err != nil || len(links) != 0 {
		t.Fatalf("links = %+v, err %v", links, err)
	}
}
