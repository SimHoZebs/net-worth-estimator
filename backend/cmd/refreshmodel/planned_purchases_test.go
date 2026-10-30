package main

import (
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestRefreshCopiesStandalonePurchasesWithoutPostings(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "target.db")
	seed(t, source)
	seed(t, target)
	db, err := sqlite.OpenDatabase(source)
	if err != nil {
		t.Fatal(err)
	}
	s, err := db.User("other")
	if err != nil {
		t.Fatal(err)
	}
	account := "checking"
	p, err := s.CreatePlannedPurchase(types.PlannedPurchase{Name: "Desk", FundingAccountID: &account, Cost: 125.50, EarliestDate: "2026-02-01", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	if err := refresh(target, source, "other", "owner", false); err != nil {
		t.Fatal(err)
	}
	if got := query(t, target, `SELECT name FROM planned_purchases WHERE user_id='owner' AND id=?`, p.ID); got != "Desk" {
		t.Fatal("private refresh lost purchase", got)
	}
	if err := refresh(target, source, "other", "owner", true); err != nil {
		t.Fatal(err)
	}
	if got := query(t, target, `SELECT COUNT(*) FROM planned_purchases WHERE user_id='owner' AND id=?`, p.ID); got != "1" {
		t.Fatal("financial-only publication lost purchase", got)
	}
	if got := query(t, target, `SELECT COUNT(*) FROM postings WHERE id=?`, p.ID); got != "0" {
		t.Fatal("purchase became a posting", got)
	}
}
