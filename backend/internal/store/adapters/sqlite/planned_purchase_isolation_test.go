package sqlite

import (
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestStandalonePurchaseWritesStayUserScoped(t *testing.T) {
	db := openSharedTestDatabase(t)
	a, b := privateTestPlan(t, db, "alice"), privateTestPlan(t, db, "bob")
	account := "checking"
	for _, s := range []*sqliteStore{a, b} {
		seedAccount(t, s, account)
		for _, id := range []string{"01900000-0000-7000-8000-000000000001", "01900000-0000-7000-8000-000000000002"} {
			if _, err := s.CreatePlannedPurchase(types.PlannedPurchase{ID: id, Name: "Desk", FundingAccountID: &account, Cost: 50, EarliestDate: "2026-02-01", Enabled: true}); err != nil {
				t.Fatal(err)
			}
		}
	}
	before := planSnapshot(t, b)
	doc, _ := a.LoadDocument()
	p := doc.PlannedPurchases[0]
	p.Name = "Only Alice"
	if _, err := a.UpdatePlannedPurchase(p); err != nil {
		t.Fatal(err)
	}
	if err := a.MovePlannedPurchase(doc.PlannedPurchases[1].ID, p.ID); err != nil {
		t.Fatal(err)
	}
	if err := a.DeletePlannedPurchase(p.ID); err != nil {
		t.Fatal(err)
	}
	if err := a.Clear(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, planSnapshot(t, b)) {
		t.Fatal("another user's purchase data changed")
	}
}
