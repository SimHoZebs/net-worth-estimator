package sqlite

import (
	"path/filepath"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPurchaseEvaluationPersistsThroughRowAndModelWrites(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "evaluations.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	item := EvaluationUpdate{Type: types.EvaluationTypePlannedPurchases, InstanceID: "purchases", Name: "Purchases", Enabled: true, Config: map[string]any{}}
	if _, err := database.CreateEvaluation(item); err != nil {
		t.Fatal(err)
	}
	document, err := database.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	if len(document.Evaluations.PlannedPurchases) != 1 {
		t.Fatalf("evaluations = %+v", document.Evaluations)
	}
	before := document.Evaluations
	tx, err := database.(*sqliteStore).db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := replaceDocument(tx, document); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	loaded, err := database.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, loaded.Evaluations) {
		t.Fatal("model replacement lost evaluation")
	}
}

func TestPurchasePolicyPersistsWithPosting(t *testing.T) {
	path := filepath.Join(t.TempDir(), "purchases.db")
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	posting := testPostingFixture("01900000-0000-7000-8000-000000000021")
	seedAccount(t, database, "checking")
	posting.Purchase = &types.PurchasePolicy{Priority: 7}
	if _, err := database.CreatePosting(posting); err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	database, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	loaded, err := database.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Postings[0].Purchase == nil || loaded.Postings[0].Purchase.Priority != 7 {
		t.Fatalf("loaded = %+v", loaded.Postings)
	}
	posting.Purchase.Priority = 1
	if _, err := database.UpdatePosting(posting); err != nil {
		t.Fatal(err)
	}
	loaded, err = database.LoadDocument()
	if err != nil || loaded.Postings[0].Purchase.Priority != 1 {
		t.Fatalf("updated = %+v, %v", loaded, err)
	}
	posting.Purchase = nil
	if _, err := database.UpdatePosting(posting); err != nil {
		t.Fatal(err)
	}
	loaded, err = database.LoadDocument()
	if err != nil || loaded.Postings[0].Purchase == nil || loaded.Postings[0].Purchase.Priority != 1 {
		t.Fatalf("omitted policy must keep the stored policy: %+v, %v", loaded, err)
	}
	posting.Purchase = &types.PurchasePolicy{Priority: 0}
	if _, err := database.UpdatePosting(posting); err != nil {
		t.Fatal(err)
	}
	if err := database.DeletePosting(posting.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.CreatePosting(testPostingFixture(posting.ID)); err != nil {
		t.Fatal(err)
	}
	loaded, err = database.LoadDocument()
	if err != nil || loaded.Postings[0].Purchase != nil {
		t.Fatalf("stale policy survived deletion: %+v, %v", loaded, err)
	}
	if err := database.Clear(); err != nil {
		t.Fatal(err)
	}
}
