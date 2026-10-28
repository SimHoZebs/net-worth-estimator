package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const receiptPostingID = "01900000-0000-7000-8000-000000000099"

func testReceiptConformance(t *testing.T, newStore func(*testing.T) Store) {
	s := newStore(t)
	p := seedReceiptPosting(t, s)
	r, err := s.CreateReceipt(context.Background(), p.ID, "receipt.png", types.ReceiptImage{Bytes: []byte("pixels"), MediaType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	list, err := s.ListReceipts(p.ID)
	if err != nil || len(list) != 1 || list[0].ID != r.ID {
		t.Fatalf("receipt list: %+v %v", list, err)
	}
	r.Draft = &types.ReceiptDetails{Merchant: "Draft"}
	r, err = s.SaveReceipt(r, r.Revision)
	if err != nil || r.Revision != 2 {
		t.Fatalf("receipt review: %+v %v", r, err)
	}
	if _, err := s.SaveReceipt(r, 1); !errors.Is(err, ErrReceiptConflict) {
		t.Fatalf("stale review: %v", err)
	}
	p.Name = "Updated"
	if _, err := s.UpdatePosting(p); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetReceipt(r.ID); err != nil {
		t.Fatal("posting update removed evidence", err)
	}
	r, err = s.ReplaceReceiptImage(context.Background(), r.ID, r.Revision, "replacement.png", types.ReceiptImage{Bytes: []byte("new pixels"), MediaType: "image/png"})
	if err != nil || r.Draft != nil || r.Status != "attached" {
		t.Fatalf("replacement: %+v %v", r, err)
	}
	if err := s.DeleteReceipt(context.Background(), r.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetReceiptImage(context.Background(), r.ID); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatal(err)
	}
}

func seedReceiptPosting(t *testing.T, s Store) types.Posting {
	t.Helper()
	seedAccount(t, s, "checking")
	p, err := s.CreatePosting(testPostingFixture(receiptPostingID))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestReceiptsStayPlanScopedAndPreserveModel(t *testing.T) {
	d := openSharedTestDatabase(t)
	a, b := privateTestPlan(t, d, "receipt-a"), privateTestPlan(t, d, "receipt-b")
	for _, s := range []Store{a, b} {
		seedReceiptPosting(t, s)
	}
	before, _ := a.LoadDocument()
	revision, _ := DocumentETag(before)
	image := types.ReceiptImage{Bytes: []byte("normalized pixels"), MediaType: "image/png"}
	r, err := a.CreateReceipt(context.Background(), receiptPostingID, "receipt.png", image)
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := a.CreateReceipt(context.Background(), receiptPostingID, "renamed.png", image)
	if err != nil || duplicate.ID != r.ID {
		t.Fatalf("duplicate = %+v, %v", duplicate, err)
	}
	if _, err := b.GetReceipt(r.ID); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatalf("cross-plan read = %v", err)
	}
	if _, err := b.GetReceiptImage(context.Background(), r.ID); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatalf("cross-plan image = %v", err)
	}
	if _, err := b.SaveReceipt(r, r.Revision); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatalf("cross-plan update = %v", err)
	}
	if err := b.DeleteReceipt(context.Background(), r.ID); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatalf("cross-plan delete = %v", err)
	}
	rb, err := b.CreateReceipt(context.Background(), receiptPostingID, "other.png", image)
	if err != nil {
		t.Fatal(err)
	}
	// Identical receipt identities in the same physical file must still isolate.
	for _, pair := range []struct {
		store   *sqliteStore
		receipt types.Receipt
	}{{a, r}, {b, rb}} {
		oldID := pair.receipt.ID
		pair.receipt.ID = "identical-receipt-id"
		payload, _ := json.Marshal(pair.receipt)
		if _, err := pair.store.db.Exec(`UPDATE receipts SET id = ?, payload = ? WHERE id = ? AND plan_id = :plan_id`, pair.receipt.ID, string(payload), oldID); err != nil {
			t.Fatal(err)
		}
	}
	r, _ = a.GetReceipt("identical-receipt-id")
	details := types.ReceiptDetails{Merchant: "Owner A", Items: []types.ReceiptItem{}}
	r.Draft = &details
	r, err = a.SaveReceipt(r, r.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.SaveReceipt(r, r.Revision-1); !errors.Is(err, ErrReceiptConflict) {
		t.Fatalf("stale review = %v", err)
	}
	other, err := b.GetReceipt(r.ID)
	if err != nil || other.Draft != nil {
		t.Fatalf("other plan = %+v, %v", other, err)
	}
	if err := a.DeleteReceipt(context.Background(), r.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := b.GetReceipt(r.ID); err != nil {
		t.Fatalf("other plan deleted: %v", err)
	}
	if pixels, err := b.GetReceiptImage(context.Background(), r.ID); err != nil || !bytes.Equal(pixels.Bytes, image.Bytes) {
		t.Fatalf("cleanup changed another plan's pixels: %+v %v", pixels, err)
	}
	after, _ := a.LoadDocument()
	got, _ := DocumentETag(after)
	if got != revision {
		t.Fatalf("receipt changed model revision: %s != %s", got, revision)
	}
}

func TestReceiptLifecyclePostingEditsAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "receipts.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	p := seedReceiptPosting(t, s)
	image := types.ReceiptImage{Bytes: []byte("image"), MediaType: "image/png"}
	r, err := s.CreateReceipt(context.Background(), p.ID, "receipt.png", image)
	if err != nil {
		t.Fatal(err)
	}
	p.Name = "Updated expense"
	p.Purchase = &types.PurchasePolicy{Priority: 2}
	updated, err := s.UpdatePosting(p)
	if err != nil || updated.ExecutionOrder != p.ExecutionOrder {
		t.Fatalf("posting = %+v, %v", updated, err)
	}
	if err := s.MovePosting(p.ID, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetReceipt(r.ID); err != nil {
		t.Fatalf("edit removed receipt: %v", err)
	}
	loaded, _ := s.LoadDocument()
	if loaded.Postings[0].Purchase == nil || loaded.Postings[0].Purchase.Priority != 2 {
		t.Fatal("purchase policy not replaced")
	}
	p.Purchase = nil
	if _, err := s.UpdatePosting(p); err != nil {
		t.Fatal(err)
	}
	loaded, _ = s.LoadDocument()
	if loaded.Postings[0].Purchase != nil {
		t.Fatal("purchase policy not removed")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	saved, err := s.GetReceiptImage(context.Background(), r.ID)
	if err != nil || !bytes.Equal(saved.Bytes, image.Bytes) {
		t.Fatalf("restored image = %+v, %v", saved, err)
	}
	if err := s.DeletePosting(p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetReceipt(r.ID); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatalf("deleted parent kept receipt: %v", err)
	}
}

func TestReceiptEligibilityQuotaAndClear(t *testing.T) {
	d := openSharedTestDatabase(t)
	s := privateTestPlan(t, d, "receipt-quota")
	p := seedReceiptPosting(t, s)
	image := types.ReceiptImage{Bytes: []byte("pixels"), MediaType: "image/png"}
	if _, err := s.CreateReceipt(context.Background(), "missing", "a.png", image); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatal(err)
	}
	p.Purchase = &types.PurchasePolicy{}
	if _, err := s.UpdatePosting(p); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateReceipt(context.Background(), p.ID, "a.png", image); !errors.Is(err, ErrReceiptIneligible) {
		t.Fatal(err)
	}
	p.Purchase = nil
	if _, err := s.UpdatePosting(p); err != nil {
		t.Fatal(err)
	}
	r, err := s.CreateReceipt(context.Background(), p.ID, "a.png", image)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE receipts SET size = ? WHERE id = ? AND plan_id = :plan_id`, ReceiptStorageLimit, r.ID); err != nil {
		t.Fatal(err)
	}
	image.Bytes = []byte("other pixels")
	if _, err := s.CreateReceipt(context.Background(), p.ID, "b.png", image); !errors.Is(err, ErrReceiptQuota) {
		t.Fatal(err)
	}
	if err := s.Clear(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetReceipt(r.ID); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatal(err)
	}
}

func TestReceiptSchemaRequiresExplicitSetup(t *testing.T) {
	d := openSharedTestDatabase(t)
	if _, err := d.db.Exec(`DROP TABLE receipts`); err != nil {
		t.Fatal(err)
	}
	if err := checkExistingSchema(d.db); !errors.Is(err, ErrSetupRequired) {
		t.Fatalf("missing receipt schema = %v", err)
	}
	if err := d.setupSchema(); err != nil {
		t.Fatal(err)
	}
	if err := checkExistingSchema(d.db); err != nil {
		t.Fatal(err)
	}
}

func TestReceiptCSVReplacementAndOwnerPendingMetadata(t *testing.T) {
	d := openSharedTestDatabase(t)
	s := privateTestPlan(t, d, "receipt-replacement")
	p := seedReceiptPosting(t, s)
	r, err := s.CreateReceipt(context.Background(), p.ID, "receipt.png", types.ReceiptImage{Bytes: []byte("pixels"), MediaType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	// The old replace-on-write path always recomputed owner pending state.
	if _, err := s.db.Exec(`UPDATE postings SET pending=1 WHERE id=? AND plan_id=:plan_id`, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdatePosting(p); err != nil {
		t.Fatal(err)
	}
	doc, err := s.LoadDocument()
	if err != nil || doc.Postings[0].Pending {
		t.Fatal("owner update did not recompute pending metadata", err)
	}
	if _, err := s.GetReceipt(r.ID); err != nil {
		t.Fatal("owner update removed receipt", err)
	}
	if _, err := s.ImportCSV(filepath.Join(projectRoot(t), "frontend", "tests", "fixtures", "model")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetReceipt(r.ID); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatalf("replacement retained dependent receipt: %v", err)
	}
}

