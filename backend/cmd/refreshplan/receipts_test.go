package main

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestRefreshCopiesPrivateReceiptsButNeverPublishesThem(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "target.db")
	seed(t, source)
	seed(t, target)
	db, err := store.OpenDatabase(source)
	if err != nil {
		t.Fatal(err)
	}
	s, err := db.Plan("plans/other")
	if err != nil {
		t.Fatal(err)
	}
	account := "checking"
	p, err := s.CreatePosting(types.Posting{Name: "Private receipt expense", SourceAccountID: &account, Amount: types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}}, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.CreateReceipt(context.Background(), p.ID, "private.png", types.ReceiptImage{Bytes: []byte("private image"), MediaType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	if err := refresh(target, source, "plans/other", "plans/owner", false); err != nil {
		t.Fatal(err)
	}
	if got := query(t, target, "SELECT CAST(b.data AS TEXT) FROM receipts r JOIN blob_data b ON b.key=r.blob_key WHERE r.plan_id='plans/owner' AND r.id=?", r.ID); got != "private image" {
		t.Fatal("refresh dropped receipt image")
	}
	if err := refresh(target, source, "plans/other", "", true); err != nil {
		t.Fatal(err)
	}
	if got := query(t, target, "SELECT COUNT(*) FROM receipts WHERE plan_id='plans/sample'"); got != "0" {
		t.Fatal("published private receipt", got)
	}
	if got := query(t, target, "SELECT COUNT(*) FROM receipts WHERE plan_id='plans/owner'"); got != "1" {
		t.Fatal("sample publication changed private receipts", got)
	}
}

