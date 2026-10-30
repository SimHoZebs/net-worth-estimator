package sqlite

import (
	"path/filepath"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestPurchaseEvaluationPersistsThroughRowAndModelWrites(t *testing.T) {
	database := openTestStore(t)
	item := EvaluationUpdate{Type: types.EvaluationTypePlannedPurchases, InstanceID: "purchases", Name: "Purchases", Enabled: true, Config: map[string]any{}}
	if _, err := database.CreateEvaluation(item); err != nil {
		t.Fatal(err)
	}
	model, err := database.LoadModel()
	if err != nil || len(model.Evaluations.PlannedPurchases) != 1 {
		t.Fatalf("model: %+v %v", model, err)
	}
	before := model.Evaluations
	loaded, err := database.ImportModel(model)
	if err != nil || !reflect.DeepEqual(before, loaded.Evaluations) {
		t.Fatalf("model replacement lost evaluation: %+v %v", loaded, err)
	}
}

func TestStandalonePurchasePersistsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "purchases.db")
	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	seedAccount(t, database, "checking")
	account := "checking"
	purchase := types.PlannedPurchase{ID: "01900000-0000-7000-8000-000000000021", Name: "Laptop", FundingAccountID: &account, Cost: 500, EarliestDate: "2026-02-01", Priority: 7, Enabled: true}
	if _, err := database.CreatePlannedPurchase(purchase); err != nil {
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
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Postings) != 0 || len(loaded.PlannedPurchases) != 1 || !reflect.DeepEqual(loaded.PlannedPurchases[0], purchase) {
		t.Fatalf("loaded = %+v %v", loaded, err)
	}
	purchase.Priority = 1
	if _, err := database.UpdatePlannedPurchase(purchase); err != nil {
		t.Fatal(err)
	}
	loaded, err = database.LoadModel()
	if err != nil || loaded.PlannedPurchases[0].Priority != 1 {
		t.Fatalf("updated = %+v %v", loaded, err)
	}
	if err := database.DeletePlannedPurchase(purchase.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.CreatePosting(testPostingFixture(purchase.ID)); err != nil {
		t.Fatal(err)
	}
	loaded, err = database.LoadModel()
	if err != nil || len(loaded.PlannedPurchases) != 0 || len(loaded.Postings) != 1 {
		t.Fatalf("stale purchase survived: %+v %v", loaded, err)
	}
}
