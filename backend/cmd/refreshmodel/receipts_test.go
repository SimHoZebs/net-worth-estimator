package main

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestRefreshCopiesPrivateReceiptsButNeverPublishesThem(t *testing.T) {
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
	p, err := s.CreatePosting(types.Posting{Name: "Private receipt expense", SourceAccountID: &account, Amount: types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}}, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.CreateReceipt(context.Background(), p.ID, "private.png", types.ReceiptImage{Bytes: []byte("private image"), MediaType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	if err := refresh(target, source, "other", "owner", false); err != nil {
		t.Fatal(err)
	}
	if got := query(t, target, "SELECT CAST(b.data AS TEXT) FROM receipts r JOIN blob_data b ON b.key=r.blob_key WHERE r.user_id='owner' AND r.id=?", r.ID); got != "private image" {
		t.Fatal("refresh dropped receipt image")
	}
	if err := refresh(target, source, "other", "owner", true); err != nil {
		t.Fatal(err)
	}
	if got := query(t, target, "SELECT COUNT(*) FROM receipts WHERE user_id='owner'"); got != "0" {
		t.Fatal("financial-only published private receipt", got)
	}
}

func TestRefreshPreservesPostingReceiptFieldPrivatelyButClearsItForFinancialOnly(t *testing.T) {
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
	p, err := s.CreatePosting(types.Posting{Name: "Field expense", SourceAccountID: &account, Amount: types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}}, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	r, err := s.CreateReceipt(context.Background(), p.ID, "field.png", types.ReceiptImage{Bytes: []byte("field image"), MediaType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	if err := refresh(target, source, "other", "owner", false); err != nil {
		t.Fatal(err)
	}
	if got := query(t, target, "SELECT receipt_ids FROM postings WHERE user_id='owner' AND id=?", p.ID); got != `["`+r.ID+`"]` {
		t.Fatalf("private posting field = %s", got)
	}
	// A second ordinary destination proves the private copy above stays
	// intact while a financial-only copy strips receipt references.
	db, err = sqlite.OpenDatabase(target)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.EnsureUser("second", "https://issuer.invalid", "second"); err != nil {
		db.Close()
		t.Fatal(err)
	}
	db.Close()
	if err := refresh(target, source, "other", "second", true); err != nil {
		t.Fatal(err)
	}
	if got := query(t, target, "SELECT receipt_ids FROM postings WHERE user_id='second' AND id=?", p.ID); got != `[]` {
		t.Fatalf("financial-only posting field = %s", got)
	}
	if got := query(t, target, "SELECT receipt_ids FROM postings WHERE user_id='owner' AND id=?", p.ID); got != `["`+r.ID+`"]` {
		t.Fatalf("financial-only publication changed private posting field = %s", got)
	}
}
