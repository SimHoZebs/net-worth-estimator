package sqlite

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/simhozebs/net-worth-estimator/backend/internal/testseed"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func openSharedTestDatabase(t *testing.T) *Database {
	t.Helper()
	d, err := SetupDatabase(filepath.Join(t.TempDir(), "shared.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func privateTestPlan(t *testing.T, d *Database, name string) *sqliteStore {
	t.Helper()
	s, err := d.EnsurePrivateAccount(name, "https://issuer.test", name)
	if err != nil {
		t.Fatal(err)
	}
	return s.(*sqliteStore)
}

// Capture every financial table, not only the model document. This catches
// changes to preferences, identity registries, private sync keys, and caches.
func planSnapshot(t *testing.T, s *sqliteStore) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, table := range expectedSchemaTables() {
		if table == "app_accounts" || table == "schema_migrations" || table == "blob_objects" || table == "blob_data" {
			continue
		}
		if table == "user_groups" || table == "group_members" || table == "group_invites" {
			continue
		}
		if table == "sessions" || table == "identity_grants" || table == "identity_logout_marks" || table == "identity_logout_tokens" {
			continue
		}
		rows, err := s.db.Query(`SELECT * FROM ` + table + ` WHERE account_id = :account_id ORDER BY rowid`)
		if err != nil {
			t.Fatal(err)
		}
		cols, err := rows.Columns()
		if err != nil {
			rows.Close()
			t.Fatal(err)
		}
		var values [][]any
		for rows.Next() {
			row := make([]any, len(cols))
			pointers := make([]any, len(cols))
			for i := range row {
				pointers[i] = &row[i]
			}
			if err := rows.Scan(pointers...); err != nil {
				rows.Close()
				t.Fatal(err)
			}
			values = append(values, row)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		rows.Close()
		raw, err := json.Marshal(values)
		if err != nil {
			t.Fatal(err)
		}
		out[table] = string(raw)
	}
	return out
}

func TestSharedDatabaseSameIDsStayIsolated(t *testing.T) {
	d := openSharedTestDatabase(t)
	a, b := privateTestPlan(t, d, "a"), privateTestPlan(t, d, "b")
	const postingID = "01900000-0000-7000-8000-000000000077"
	const pendingID = "01900000-0000-7000-8000-000000000078"
	preset := testPresetFixture("same-recipe")
	preset.ID = "same-preset"
	eval := EvaluationUpdate{Type: "netWorthThreshold", InstanceID: "same-evaluation", Name: "Same evaluation", Config: map[string]any{}}
	for _, s := range []*sqliteStore{a, b} {
		seedModelAccount(t, s, "checking")
		seedModelAccount(t, s, "second")
		if _, err := s.CreatePosting(testPostingFixture(postingID)); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateRule(testRuleFixture("same-rule")); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateRule(testRuleFixture("second-rule")); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateEvaluation(eval); err != nil {
			t.Fatal(err)
		}
		secondEval := eval
		secondEval.InstanceID = "second-evaluation"
		if _, err := s.CreateEvaluation(secondEval); err != nil {
			t.Fatal(err)
		}
		if _, err := s.SaveCheckpoint(types.Checkpoint{AccountID: "checking", Date: "2026-01-01", Balance: 10}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.SavePaymentTerms(types.PaymentTerms{AccountID: "checking", DueDay: 1}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateAmountPreset(preset); err != nil {
			t.Fatal(err)
		}
		if _, err := s.SaveAccountLink(AccountLink{BridgeAccountID: "same-bridge", ModelAccountID: "checking"}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.SetPinnedEvaluations([]string{eval.InstanceID}); err != nil {
			t.Fatal(err)
		}
		if err := s.SetSafeSpendingSettings(types.SafeSpendingSettings{Reserve: 12}); err != nil {
			t.Fatal(err)
		}
		if err := s.SetLastSyncTime("before"); err != nil {
			t.Fatal(err)
		}
		if err := s.PutArtifact("same-artifact", "deterministic", s.db.accountID); err != nil {
			t.Fatal(err)
		}
		// Migrated sources may contain the exact same local sync UUID.
		tx, err := s.db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		pending := syncPendingPosting("same-transaction", "checking", "2026-08-02")
		pending.ID = pendingID
		if err := insertPosting(tx, 1, &pending.Posting, SourceSimpleFIN); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if err := insertPostingSyncKey(tx, postingSyncKey{SourceSimpleFIN, pending.ProviderAccountID, pending.TransactionID, pendingID}); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	before := planSnapshot(t, b)
	checkOther := func() {
		t.Helper()
		if got := planSnapshot(t, b); !reflect.DeepEqual(got, before) {
			t.Fatalf("another plan changed:\nbefore %v\nafter %v", before, got)
		}
	}
	for _, operation := range []func() error{
		func() error { _, err := a.UpdateAccount(types.Account{ID: "checking", Name: "A only"}); return err },
		func() error { return a.MoveAccount("second", "checking") },
		func() error {
			p := testPostingFixture(postingID)
			p.Purchase = &types.PurchasePolicy{Priority: 9}
			_, err := a.UpdatePosting(p)
			return err
		},
		func() error { return a.MovePosting(postingID, pendingID) },
		func() error {
			r := testRuleFixture("same-rule")
			r.Name = "A only"
			_, err := a.UpdateRule(r)
			return err
		},
		func() error { return a.MoveRule("second-rule", "same-rule") },
		func() error { e := eval; e.Name = "A only"; _, err := a.UpdateEvaluation(e); return err },
		func() error { return a.MoveEvaluation(eval.Type, "second-evaluation", eval.InstanceID) },
		func() error {
			_, err := a.SaveCheckpoint(types.Checkpoint{AccountID: "checking", Date: "2026-01-01", Balance: 99})
			return err
		},
		func() error {
			_, err := a.SavePaymentTerms(types.PaymentTerms{AccountID: "checking", DueDay: 2})
			return err
		},
		func() error { p := preset; p.Label = "A only"; _, err := a.UpdateAmountPreset(p); return err },
		func() error { return a.MoveAmountPreset(preset.ID, "") },
		func() error { _, err := a.SetPinnedEvaluations([]string{"second-evaluation"}); return err },
		func() error { return a.SetSafeSpendingSettings(types.SafeSpendingSettings{Reserve: 99}) },
		func() error {
			_, err := a.SaveAccountLink(AccountLink{BridgeAccountID: "same-bridge", ModelAccountID: "checking", BridgeName: "A only"})
			return err
		},
		func() error {
			_, _, _, err := a.ProvisionSyncAccounts([]SyncProvision{{BridgeID: "same-bridge", Name: "A touched"}, {BridgeID: "new-bridge", Name: "A created"}})
			return err
		},
		func() error {
			item := syncPendingPosting("same-transaction", "checking", "2026-08-03")
			_, err := a.ApplySyncPlan([]SyncCheckpoint{{AccountID: "checking", Date: "2026-02-01", Balance: 50}}, []BankDirective{syncPendingDirective(item)})
			return err
		},
		func() error { return a.SetLastSyncTime("after") },
		func() error { _, err := a.ApplySyncPlan(nil, nil); return err },
		func() error { return a.DeletePosting(postingID) },
		func() error { return a.DeleteRule("same-rule") },
		func() error { return a.DeleteEvaluation(eval.InstanceID) },
		func() error { return a.DeleteCheckpoint("checking", "2026-01-01") },
		func() error { return a.DeletePaymentTerms("checking") },
		func() error { return a.DeleteAmountPreset(preset.ID) },
		func() error { return a.DeleteAccountLink("same-bridge") },
		func() error { return a.DeleteAccount("second") },
		func() error {
			_, err := testseed.Seed(a, filepath.Join(projectRoot(t), "frontend", "tests", "fixtures", "model"))
			return err
		},
		func() error { return a.Clear() },
	} {
		if err := operation(); err != nil {
			t.Fatal(err)
		}
		checkOther()
	}
	if payload, ok, err := b.GetArtifact("same-artifact"); err != nil || !ok || payload != "b" {
		t.Fatalf("artifact = %q, %v, %v", payload, ok, err)
	}
	if exists, err := a.DocumentExists(); err != nil || exists {
		t.Fatalf("cleared presence = %v, %v", exists, err)
	}
	if _, ok, err := a.GetArtifact("same-artifact"); err != nil || ok {
		t.Fatalf("cleared artifact = %v, %v", ok, err)
	}
}

func TestNormalizeAccountIDMapsOnlyUnambiguousLegacyShapes(t *testing.T) {
	hash := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	if got := NormalizeAccountID("plans/" + hash); got != "user:"+hash {
		t.Fatalf("hash = %q", got)
	}
	if got := NormalizeAccountID("plans/" + hash[:63]); got != "plans/"+hash[:63] {
		t.Fatalf("63-char = %q", got)
	}
	if got := NormalizeAccountID("plans/" + hash + "0"); got != "plans/"+hash+"0" {
		t.Fatalf("65-char = %q", got)
	}
	if got := NormalizeAccountID("plans/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"); got != "plans/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" {
		t.Fatalf("non-hex = %q", got)
	}
	for plan, want := range map[string]string{
		"plans/sample": "sample", "plans/fixture": "fixture", "plans/a": "plans/a",
		"sample": "sample", "user:abc": "user:abc", "owner": "owner",
	} {
		if got := NormalizeAccountID(plan); got != want {
			t.Fatalf("normalize %q = %q, want %q", plan, got, want)
		}
	}
}

func TestSharedDatabaseOwnershipLifecycleAndSeedOnce(t *testing.T) {
	d := openSharedTestDatabase(t)
	if _, err := d.Account("missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing account = %v", err)
	}
	a := privateTestPlan(t, d, "a")
	// Legacy plan pairs still resolve: a matching plans/<name> ID owned by
	// the same account name ensures the same scope.
	if _, err := d.EnsurePrivatePlan("plans/a", "a", "https://issuer.test", "a"); err != nil {
		t.Fatalf("legacy plan pair = %v", err)
	}
	// Mismatched pairs stay conflicts, as under the retired plan rule.
	for _, pair := range [][2]string{{"plans/a", "other"}, {"plans/a", "user:a"}, {"other", "a"}} {
		if _, err := d.EnsurePrivatePlan(pair[0], pair[1], "https://issuer.test", pair[1]); err == nil {
			t.Fatalf("mismatched pair %v accepted", pair)
		}
	}
	// A legacy plans/<name> ID resolves to the bare-owner scope and binds it.
	resolved, err := d.Plan("plans/a")
	if err != nil {
		t.Fatalf("legacy plan ID = %v", err)
	}
	if _, err := resolved.CreateAccount(types.Account{ID: "legacy-bind", Name: "bind"}); err != nil {
		t.Fatalf("legacy-bound write = %v", err)
	}
	if _, err := a.LoadDocument(); err != nil {
		t.Fatal(err)
	}
	loaded, err := a.LoadDocument()
	if err != nil || loaded == nil {
		t.Fatal(err)
	}
	found := false
	for _, account := range loaded.Accounts {
		if account.ID == "legacy-bind" {
			found = true
		}
	}
	if !found {
		t.Fatal("legacy plan ID did not bind the owner scope")
	}
	if _, err := d.EnsurePrivateAccount("a", "https://issuer.test", "different"); err == nil {
		t.Fatal("changed account identity")
	}
	if _, err := d.EnsurePrivateAccount("different", "https://issuer.test", "a"); err == nil {
		t.Fatal("duplicated issuer/subject")
	}
	// Reserved scopes reject private ownership.
	if _, err := d.EnsurePrivateAccount("sample", "https://issuer.test", "a"); err == nil {
		t.Fatal("sample accepted a private owner")
	}
	if _, err := d.EnsurePrivateAccount("fixture", "https://issuer.test", "a"); err == nil {
		t.Fatal("fixture accepted a private owner")
	}
	if exists, err := d.HasAccount("new"); err != nil || exists {
		t.Fatalf("failed creation persisted account: %v, %v", exists, err)
	}
	presets, err := a.ListAmountPresets()
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range presets {
		if err := a.DeleteAmountPreset(p.ID); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		privateTestPlan(t, d, "a")
		b := privateTestPlan(t, d, "b")
		if got, err := b.ListAmountPresets(); err != nil || len(got) != 8 {
			t.Fatalf("new plan presets = %d, %v", len(got), err)
		}
		if got, err := a.ListAmountPresets(); err != nil || len(got) != 0 {
			t.Fatalf("deleted presets reseeded = %d, %v", len(got), err)
		}
	}
	sample, err := d.EnsureSampleAccount()
	if err != nil {
		t.Fatal(err)
	}
	seedModelAccount(t, sample, "checking")
	if err := sample.Close(); err != nil {
		t.Fatal(err)
	}
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	if exists, err := d.HasAccount("a"); err != nil || !exists {
		t.Fatalf("scoped close closed database: %v, %v", exists, err)
	}
	if exists, err := d.HasPlan("plans/a"); err != nil || !exists {
		t.Fatalf("legacy plan ID stopped resolving: %v, %v", exists, err)
	}
}

func TestSharedDatabaseArtifactEvictionIsPlanLocal(t *testing.T) {
	d := openSharedTestDatabase(t)
	a, b := privateTestPlan(t, d, "a"), privateTestPlan(t, d, "b")
	if err := b.PutArtifact("old", "deterministic", "keep"); err != nil {
		t.Fatal(err)
	}
	before := planSnapshot(t, b)
	for i := range maxArtifacts + 4 {
		if err := a.PutArtifact(fmt.Sprint(i), "deterministic", "payload"); err != nil {
			t.Fatal(err)
		}
	}
	if got := countRows(t, a, "projection_artifacts", ""); got != maxArtifacts {
		t.Fatalf("artifact count = %d", got)
	}
	if !reflect.DeepEqual(before, planSnapshot(t, b)) {
		t.Fatal("artifact eviction crossed plans")
	}
}

func TestSharedDatabaseRejectsCrossPlanRelationalReferences(t *testing.T) {
	d := openSharedTestDatabase(t)
	a, b := privateTestPlan(t, d, "a"), privateTestPlan(t, d, "b")
	seedModelAccount(t, b, "checking")
	if _, err := a.CreatePosting(testPostingFixture("01900000-0000-7000-8000-000000000099")); err == nil {
		t.Fatal("posting referenced another plan's account")
	}
	if _, err := a.SaveCheckpoint(types.Checkpoint{AccountID: "checking", Date: "2026-01-01"}); err == nil {
		t.Fatal("checkpoint referenced another plan's account")
	}
	if _, err := a.SavePaymentTerms(types.PaymentTerms{AccountID: "checking"}); err == nil {
		t.Fatal("payment terms referenced another plan's account")
	}
	if _, err := a.SetPinnedEvaluations([]string{"missing"}); !IsNotFound(err) {
		t.Fatalf("unknown pin = %v", err)
	}
	if exists, err := a.DocumentExists(); err != nil || exists {
		t.Fatalf("failed write activated model: %v, %v", exists, err)
	}
}
