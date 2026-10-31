package sqlite

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/testseed"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const receiptPostingID = "01900000-0000-7000-8000-000000000099"

func seedReceiptPosting(t *testing.T, s store.Store) types.Posting {
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
	for _, s := range []store.Store{a, b} {
		seedReceiptPosting(t, s)
	}
	before, _ := a.LoadModel()
	revision, _ := ModelETag(before)
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
		if _, err := pair.store.db.Exec(`UPDATE receipts SET id = ?, payload = ? WHERE id = ? AND user_id = :user_id`, pair.receipt.ID, string(payload), oldID); err != nil {
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
	after, _ := a.LoadModel()
	got, _ := ModelETag(after)
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
	account := "checking"
	purchase, err := s.CreatePlannedPurchase(types.PlannedPurchase{Name: "Desk", FundingAccountID: &account, Cost: 100, EarliestDate: "2026-02-01", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateReceipt(context.Background(), purchase.ID, "a.png", image); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatal("standalone purchase accepted posting evidence", err)
	}
	if _, err := s.db.Exec(`UPDATE postings SET pending = 1, source = 'simplefin' WHERE id = ? AND user_id = :user_id`, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateReceipt(context.Background(), p.ID, "b.png", image); !errors.Is(err, ErrReceiptIneligible) {
		t.Fatal("pending sync row accepted evidence")
	}
	if _, err := s.db.Exec(`UPDATE postings SET pending = 0, source = 'user' WHERE id = ? AND user_id = :user_id`, p.ID); err != nil {
		t.Fatal(err)
	}
	r, err := s.CreateReceipt(context.Background(), p.ID, "a.png", image)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE receipts SET size = ? WHERE id = ? AND user_id = :user_id`, ReceiptStorageLimit, r.ID); err != nil {
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

func TestSetupRejectsMissingReceiptSchema(t *testing.T) {
	d := openSharedTestDatabase(t)
	if _, err := d.db.Exec(`DROP TABLE receipts`); err != nil {
		t.Fatal(err)
	}
	if err := checkExistingSchema(d.db); !errors.Is(err, ErrSetupRequired) {
		t.Fatalf("missing receipt schema = %v", err)
	}
	before := databaseSchemaSnapshot(t, d)
	if err := d.setupSchema(); !errors.Is(err, ErrSetupRequired) {
		t.Fatalf("setup accepted missing receipt schema: %v", err)
	}
	if after := databaseSchemaSnapshot(t, d); !reflect.DeepEqual(before, after) {
		t.Fatal("setup repaired an existing schema")
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
	if _, err := s.db.Exec(`UPDATE postings SET pending=1 WHERE id=? AND user_id=:user_id`, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdatePosting(p); err != nil {
		t.Fatal(err)
	}
	doc, err := s.LoadModel()
	if err != nil || doc.Postings[0].Pending {
		t.Fatal("owner update did not recompute pending metadata", err)
	}
	if _, err := s.GetReceipt(r.ID); err != nil {
		t.Fatal("owner update removed receipt", err)
	}
	if _, err := testseed.Seed(s, filepath.Join(projectRoot(t), "frontend", "tests", "fixtures", "model")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetReceipt(r.ID); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatalf("replacement retained dependent receipt: %v", err)
	}
}

func TestPostingReceiptLinksTrackLifecycle(t *testing.T) {
	d := openSharedTestDatabase(t)
	s := privateTestPlan(t, d, "receipt-field")
	p := seedReceiptPosting(t, s)
	image := types.ReceiptImage{Bytes: []byte("pixels"), MediaType: "image/png"}
	r, err := s.CreateReceipt(context.Background(), p.ID, "a.png", image)
	if err != nil {
		t.Fatal(err)
	}
	links := func() []string {
		t.Helper()
		got, err := s.ListPostingReceiptIDs()
		if err != nil {
			t.Fatal(err)
		}
		return got[p.ID]
	}
	stored := func() []string {
		t.Helper()
		rows, err := s.db.Query(`SELECT id FROM receipts WHERE posting_id = ? AND user_id = :user_id ORDER BY id`, p.ID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				t.Fatal(err)
			}
			ids = append(ids, id)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return ids
	}
	if got, want := links(), []string{r.ID}; !reflect.DeepEqual(got, want) {
		t.Fatalf("links = %v, want %v", got, want)
	}
	if got := stored(); !reflect.DeepEqual(got, []string{r.ID}) {
		t.Fatalf("stored receipts = %v", got)
	}
	// Duplicate uploads reuse the receipt and must not duplicate the link.
	image.Bytes = []byte("pixels")
	if _, err := s.CreateReceipt(context.Background(), p.ID, "renamed.png", image); err != nil {
		t.Fatal(err)
	}
	if got := links(); !reflect.DeepEqual(got, []string{r.ID}) {
		t.Fatalf("links after duplicate = %v", got)
	}
	otherImage := types.ReceiptImage{Bytes: []byte("other pixels"), MediaType: "image/png"}
	other, err := s.CreateReceipt(context.Background(), p.ID, "b.png", otherImage)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{r.ID, other.ID}
	sort.Strings(want)
	if got := links(); !reflect.DeepEqual(got, want) {
		t.Fatalf("links = %v, want %v", got, want)
	}
	// Ordinary posting edits preserve the links and keep them out of the model.
	p.Name = "Updated"
	if _, err := s.UpdatePosting(p); err != nil {
		t.Fatal(err)
	}
	if got := links(); !reflect.DeepEqual(got, want) {
		t.Fatalf("links after edit = %v, want %v", got, want)
	}
	doc, _ := s.LoadModel()
	raw, _ := json.Marshal(doc)
	if strings.Contains(string(raw), r.ID) || strings.Contains(string(raw), "receipt") {
		t.Fatal("receipt link leaked into the financial model")
	}
	if err := s.DeleteReceipt(context.Background(), r.ID); err != nil {
		t.Fatal(err)
	}
	if got := links(); !reflect.DeepEqual(got, []string{other.ID}) {
		t.Fatalf("links after delete = %v", got)
	}
	if err := s.DeleteReceipt(context.Background(), other.ID); err != nil {
		t.Fatal(err)
	}
	if got, err := s.ListPostingReceiptIDs(); err != nil || len(got) != 0 {
		t.Fatalf("links after full delete = %+v, %v", got, err)
	}
	if got := stored(); len(got) != 0 {
		t.Fatalf("stored receipts after full delete = %v", got)
	}
}

func TestRepeatedSetupPreservesPostingReceipts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "receipt-field.db")
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	s := privateTestPlan(t, d, "owner")
	p := seedReceiptPosting(t, s)
	r, err := s.CreateReceipt(context.Background(), p.ID, "a.png", types.ReceiptImage{Bytes: []byte("pixels"), MediaType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.CreateReceipt(context.Background(), p.ID, "b.png", types.ReceiptImage{Bytes: []byte("other pixels"), MediaType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	// Receipt links live in the receipts table now. Snapshot the stored
	// rows and the derived links, then prove reopening preserves them.
	snapshot := func() (string, map[string][]string) {
		t.Helper()
		rows, err := d.SQL().Query(`SELECT user_id, id, posting_id, digest, size, blob_key, revision, payload FROM receipts ORDER BY user_id, id`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var values [][]any
		for rows.Next() {
			row := make([]any, 8)
			pointers := make([]any, len(row))
			for i := range row {
				pointers[i] = &row[i]
			}
			if err := rows.Scan(pointers...); err != nil {
				t.Fatal(err)
			}
			values = append(values, row)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(values)
		if err != nil {
			t.Fatal(err)
		}
		links, err := s.ListPostingReceiptIDs()
		if err != nil {
			t.Fatal(err)
		}
		return string(raw), links
	}
	wantRows, wantLinks := snapshot()
	if len(wantLinks[p.ID]) != 2 {
		t.Fatalf("links = %+v, want both %s and %s", wantLinks, r.ID, other.ID)
	}
	d.Close()
	for range 2 {
		d, err = SetupDatabase(path)
		if err != nil {
			t.Fatal(err)
		}
		s = privateTestPlan(t, d, "owner")
		gotRows, gotLinks := snapshot()
		if gotRows != wantRows {
			t.Fatalf("setup rewrote stored receipts:\nbefore %s\nafter %s", wantRows, gotRows)
		}
		if !reflect.DeepEqual(gotLinks, wantLinks) {
			t.Fatalf("setup rewrote receipt links: %+v, want %+v", gotLinks, wantLinks)
		}
		if err := d.Close(); err != nil {
			t.Fatal(err)
		}
	}
}
