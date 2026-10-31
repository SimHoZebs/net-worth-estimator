package sqlite

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
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
	s, err := d.EnsureUser(name, "https://issuer.test", name)
	if err != nil {
		t.Fatal(err)
	}
	return s.(*sqliteStore)
}

// Capture every financial table, not only the model. This catches
// changes to preferences, identity registries, private sync keys, and caches.
func planSnapshot(t *testing.T, s *sqliteStore) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, table := range expectedSchemaTables() {
		if table == "users" || table == "schema_migrations" || table == "blob_objects" || table == "blob_data" {
			continue
		}
		if table == "user_groups" || table == "group_members" || table == "group_invites" {
			continue
		}
		if table == "sessions" || table == "identity_grants" || table == "identity_logout_marks" || table == "identity_logout_tokens" {
			continue
		}
		rows, err := s.db.Query(`SELECT * FROM ` + table + ` WHERE user_id = :user_id ORDER BY rowid`)
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
		seedAccount(t, s, "checking")
		seedAccount(t, s, "second")
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
		if _, err := s.SaveCheckpoint(types.Checkpoint{AccountID: "checking", Balance: 10, ObservedAt: 1767311999}); err != nil {
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
		if err := s.PutArtifact("same-artifact", "deterministic", s.db.userID); err != nil {
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
			p.Name = "A only"
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
			_, err := a.SaveCheckpoint(types.Checkpoint{AccountID: "checking", Balance: 99, ObservedAt: 1767311999})
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
			_, err := a.ApplySyncPlan([]SyncCheckpoint{{AccountID: "checking", Balance: 50, Source: SourceSimpleFIN, ObservedAt: 1769990399}}, []BankDirective{syncPendingDirective(item)})
			return err
		},
		func() error { return a.SetLastSyncTime("after") },
		func() error { _, err := a.ApplySyncPlan(nil, nil); return err },
		func() error { return a.DeletePosting(postingID) },
		func() error { return a.DeleteRule("same-rule") },
		func() error { return a.DeleteEvaluation(eval.InstanceID) },
		func() error { return a.DeleteCheckpointAt("checking", 1767311999) },
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
	if exists, err := a.ModelExists(); err != nil || exists {
		t.Fatalf("cleared presence = %v, %v", exists, err)
	}
	if _, ok, err := a.GetArtifact("same-artifact"); err != nil || ok {
		t.Fatalf("cleared artifact = %v, %v", ok, err)
	}
}

func TestSharedDatabaseOwnershipLifecycleAndSeedOnce(t *testing.T) {
	d := openSharedTestDatabase(t)
	if _, err := d.User("missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing user = %v", err)
	}
	a := privateTestPlan(t, d, "a")
	if _, err := d.EnsureUser("a", "https://issuer.test", "other"); err == nil {
		t.Fatal("changed user identity")
	}
	if _, err := d.EnsureUser("different", "https://issuer.test", "a"); err == nil {
		t.Fatal("duplicated issuer/subject")
	}
	if exists, err := d.HasUser("new"); err != nil || exists {
		t.Fatalf("failed creation persisted user: %v, %v", exists, err)
	}
	// Reopening an ensured user resolves to the same user scope.
	shimUser := "user:shimtest"
	if _, err := d.EnsureUser(shimUser, "https://issuer.test", "shimuser"); err != nil {
		t.Fatalf("user ensure = %v", err)
	}
	if _, err := d.User(shimUser); err != nil {
		t.Fatalf("user reopen = %v", err)
	}
	if exists, err := d.HasUser(shimUser); err != nil || !exists {
		t.Fatalf("user has = %v, %v", exists, err)
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
			t.Fatalf("new user presets = %d, %v", len(got), err)
		}
		if got, err := a.ListAmountPresets(); err != nil || len(got) != 0 {
			t.Fatalf("deleted presets reseeded = %d, %v", len(got), err)
		}
	}
	ordinaryID := authorization.ActorKey("https://issuer.test", "ordinarytest")
	ordinary, err := d.EnsureUser(ordinaryID, "https://issuer.test", "ordinarytest")
	if err != nil {
		t.Fatal(err)
	}
	seedAccount(t, ordinary, "checking")
	if err := ordinary.Close(); err != nil {
		t.Fatal(err)
	}
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	if exists, err := d.HasUser("a"); err != nil || !exists {
		t.Fatalf("scoped close closed database: %v, %v", exists, err)
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
	seedAccount(t, b, "checking")
	if _, err := a.CreatePosting(testPostingFixture("01900000-0000-7000-8000-000000000099")); err == nil {
		t.Fatal("posting referenced another plan's account")
	}
	if _, err := a.SaveCheckpoint(types.Checkpoint{AccountID: "checking", ObservedAt: 1767311999}); err == nil {
		t.Fatal("checkpoint referenced another plan's account")
	}
	if _, err := a.SavePaymentTerms(types.PaymentTerms{AccountID: "checking"}); err == nil {
		t.Fatal("payment terms referenced another plan's account")
	}
	if _, err := a.SetPinnedEvaluations([]string{"missing"}); !IsNotFound(err) {
		t.Fatalf("unknown pin = %v", err)
	}
	if exists, err := a.ModelExists(); err != nil || exists {
		t.Fatalf("failed write activated model: %v, %v", exists, err)
	}
}

func TestTimestampedRowsStayIsolatedAcrossUsers(t *testing.T) {
	d := openSharedTestDatabase(t)
	a, b := privateTestPlan(t, d, "a"), privateTestPlan(t, d, "b")
	for _, s := range []*sqliteStore{a, b} {
		seedAccount(t, s, "checking")
	}
	const instant = int64(1785903600)
	// Identical account IDs and identical instant keys in one shared file.
	if _, err := a.SaveCheckpoint(types.Checkpoint{AccountID: "checking", Balance: 100, ObservedAt: instant}); err != nil {
		t.Fatal(err)
	}
	if _, err := b.SaveCheckpoint(types.Checkpoint{AccountID: "checking", Balance: 200, ObservedAt: instant}); err != nil {
		t.Fatal(err)
	}
	if _, err := b.SaveCheckpoint(types.Checkpoint{AccountID: "checking", Balance: 250, ObservedAt: 1785974399}); err != nil {
		t.Fatal(err)
	}
	settledDirective := func(item SyncPosting) BankDirective {
		item.Source = SourceSimpleFIN
		return BankDirective{Upsert: &BankUpsert{
			Posting: item.Posting,
			Keys:    []BankKey{{Provider: SourceSimpleFIN, AccountID: item.ProviderAccountID, TransactionID: item.TransactionID}},
		}}
	}
	for user, s := range map[string]*sqliteStore{"a": a, "b": b} {
		if _, err := s.ApplySyncPlan(
			[]SyncCheckpoint{{AccountID: "checking", Balance: 10, Source: SourceSimpleFIN, ObservedAt: instant + 86400}},
			[]BankDirective{settledDirective(syncSettledPosting("tx-"+user, "checking", "Settled "+user, "2026-08-06"))},
		); err != nil {
			t.Fatal(err)
		}
	}
	bankID := func(s *sqliteStore) string {
		loaded, err := s.LoadModel()
		if err != nil {
			t.Fatal(err)
		}
		for _, posting := range loaded.Postings {
			if posting.Source == SourceSimpleFIN && !posting.Pending {
				return posting.ID
			}
		}
		t.Fatalf("no settled bank row for user")
		return ""
	}
	bankA, bankB := bankID(a), bankID(b)
	if bankA == bankB {
		t.Fatalf("bank row IDs collided across users: %s", bankA)
	}
	checking := "checking"
	if _, err := a.CreatePosting(types.Posting{
		ID: "01900000-0000-7000-8000-000000000091", Name: "Manual",
		SourceAccountID: &checking,
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      1785817200, TransactionTime: 1785817200, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	loadedA, err := a.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	loadedB, err := b.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	countA, countB := 0, 0
	for _, checkpoint := range loadedA.Checkpoints {
		if checkpoint.AccountID == "checking" && checkpoint.ObservedAt != instant+86400 {
			countA++
			if checkpoint.ObservedAt == instant && checkpoint.Balance != 100 {
				t.Fatalf("user A instant row changed: %+v", checkpoint)
			}
		}
	}
	for _, checkpoint := range loadedB.Checkpoints {
		if checkpoint.AccountID == "checking" && checkpoint.ObservedAt != instant+86400 {
			countB++
		}
	}
	if countA != 1 || countB != 2 {
		t.Fatalf("same-day rows leaked: a=%d b=%d", countA, countB)
	}
	for _, posting := range loadedB.Postings {
		if posting.ID == "01900000-0000-7000-8000-000000000091" {
			t.Fatalf("user A manual posting visible to user B")
		}
		if posting.ID == bankA {
			t.Fatalf("user A bank row visible to user B")
		}
	}
	found := false
	for _, posting := range loadedA.Postings {
		if posting.ID == "01900000-0000-7000-8000-000000000091" {
			found = true
		}
	}
	if !found {
		t.Fatalf("user A manual posting missing")
	}
}
