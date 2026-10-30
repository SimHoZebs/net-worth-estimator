package storetest

import (
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func testPlannedPurchases(t *testing.T, newStore func(*testing.T) store.Store) {
	s := newStore(t)
	account := "purchase-cash"
	if _, err := s.CreateAccount(types.Account{ID: account, Name: "Cash", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	a, err := s.CreatePlannedPurchase(types.PlannedPurchase{Name: "Desk", FundingAccountID: &account, Cost: 500, EarliestDate: "2026-02-01", Enabled: true, Priority: 4})
	if err != nil || a.ID == "" {
		t.Fatalf("create: %+v %v", a, err)
	}
	b, err := s.CreatePlannedPurchase(types.PlannedPurchase{Name: "Chair", FundingAccountID: &account, Cost: 100, EarliestDate: "2026-02-01", Enabled: true, Priority: 7})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePlannedPurchase(a); !store.IsIDConflict(err) {
		t.Fatalf("duplicate ID: %v", err)
	}
	if err := s.MovePlannedPurchase(b.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	doc, err := s.LoadDocument()
	if err != nil || len(doc.Postings) != 0 || len(doc.PlannedPurchases) != 2 || doc.PlannedPurchases[0].ID != b.ID || doc.PlannedPurchases[0].Priority != 0 {
		t.Fatalf("queue: %+v %v", doc, err)
	}
	imported, err := s.ImportDocument(doc)
	if err != nil || !reflect.DeepEqual(doc.PlannedPurchases, imported.PlannedPurchases) {
		t.Fatalf("import lost purchases: %+v %v", imported, err)
	}
	for _, id := range []string{a.ID, b.ID} {
		if _, err := s.CreateAccount(types.Account{ID: id}); !store.IsIDConflict(err) {
			t.Fatalf("shared identity namespace: %v", err)
		}
	}
	b = imported.PlannedPurchases[0]
	b.Name, b.Cost, b.Enabled = "Edited chair", 150, false
	if _, err := s.UpdatePlannedPurchase(b); err != nil {
		t.Fatal(err)
	}
	if err := s.DeletePlannedPurchase(a.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeletePlannedPurchase(a.ID); !store.IsNotFound(err) {
		t.Fatalf("delete missing: %v", err)
	}
	if _, err := s.UpdatePlannedPurchase(a); !store.IsNotFound(err) {
		t.Fatalf("update missing: %v", err)
	}
	if err := s.MovePlannedPurchase("missing", b.ID); !store.IsNotFound(err) {
		t.Fatalf("move missing: %v", err)
	}
	if err := s.MovePlannedPurchase(b.ID, "missing"); !store.IsNotFound(err) {
		t.Fatalf("move target missing: %v", err)
	}
	doc, _ = s.LoadDocument()
	if len(doc.PlannedPurchases) != 1 || !reflect.DeepEqual(doc.PlannedPurchases[0], b) {
		t.Fatalf("update lost values: %+v", doc.PlannedPurchases)
	}
	if err := s.Clear(); err != nil {
		t.Fatal(err)
	}
	doc, err = s.LoadDocument()
	if err != nil || doc != nil {
		t.Fatalf("clear: %+v %v", doc, err)
	}
}
