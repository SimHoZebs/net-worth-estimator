package sqlite

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestReceiptImageReplacementClearsContentAtomically(t *testing.T) {
	d := openSharedTestDatabase(t)
	s := privateTestPlan(t, d, "replace-image")
	p := seedReceiptPosting(t, s)
	before, _ := s.LoadDocument()
	financialRevision, _ := DocumentETag(before)
	r, err := s.CreateReceipt(context.Background(), p.ID, "old.png", types.ReceiptImage{Bytes: []byte("old pixels"), MediaType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	details := &types.ReceiptDetails{Merchant: "Old content"}
	provenance := &types.ReceiptProvenance{Producer: "test", Version: "1", Simulated: true}
	r.Extraction = &types.ReceiptExtraction{Details: *details, Provenance: *provenance}
	r.Draft, r.Confirmed, r.DraftProvenance, r.ConfirmedProvenance = details, details, provenance, provenance
	r.Status, r.ExtractionStartedAt, r.Problem = "extracting", 123, &types.ReceiptProblem{Code: "old"}
	r, err = s.SaveReceipt(r, r.Revision)
	if err != nil {
		t.Fatal(err)
	}
	image := types.ReceiptImage{Bytes: []byte("replacement pixels"), MediaType: "image/png"}
	updated, err := s.ReplaceReceiptImage(context.Background(), r.ID, r.Revision, "new.png", image)
	if err != nil {
		t.Fatal(err)
	}
	if updated.ID != r.ID || updated.PostingID != r.PostingID || updated.CreatedAt != r.CreatedAt || updated.Revision != r.Revision+1 || updated.Digest == r.Digest || updated.Filename != "new.png" {
		t.Fatalf("replacement = %+v", updated)
	}
	if updated.Status != "attached" || updated.ExtractionStartedAt != 0 || updated.Extraction != nil || updated.Draft != nil || updated.Confirmed != nil || updated.Problem != nil || updated.DraftProvenance != nil || updated.ConfirmedProvenance != nil {
		t.Fatalf("replacement kept old content: %+v", updated)
	}
	pixels, err := s.GetReceiptImage(context.Background(), r.ID)
	if err != nil || !bytes.Equal(pixels.Bytes, image.Bytes) {
		t.Fatalf("pixels = %+v, %v", pixels, err)
	}
	if _, err := s.ReplaceReceiptImage(context.Background(), r.ID, r.Revision, "stale.png", image); !errors.Is(err, ErrReceiptConflict) {
		t.Fatalf("stale replacement = %v", err)
	}
	if _, err := s.SaveReceipt(r, r.Revision); !errors.Is(err, ErrReceiptConflict) {
		t.Fatalf("stale review = %v", err)
	}
	if _, err := s.ReplaceReceiptImage(context.Background(), r.ID, updated.Revision, "invalid.png", types.ReceiptImage{}); err == nil {
		t.Fatal("invalid image accepted")
	}
	stored, err := s.GetReceipt(r.ID)
	if err != nil || !reflect.DeepEqual(stored, updated) {
		t.Fatal("failed replacement changed receipt", err)
	}
	after, _ := s.LoadDocument()
	got, _ := DocumentETag(after)
	if got != financialRevision {
		t.Fatal("image replacement changed financial revision")
	}
}

func TestReceiptReplacementIsolationDuplicateAndQuota(t *testing.T) {
	d := openSharedTestDatabase(t)
	a, b := privateTestPlan(t, d, "replace-a"), privateTestPlan(t, d, "replace-b")
	for _, s := range []store.Store{a, b} {
		seedReceiptPosting(t, s)
	}
	image := types.ReceiptImage{Bytes: []byte("old image pixels"), MediaType: "image/png"}
	r, err := a.CreateReceipt(context.Background(), receiptPostingID, "old.png", image)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.ReplaceReceiptImage(context.Background(), r.ID, r.Revision, "new.png", image); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatalf("cross-plan replace = %v", err)
	}
	otherImage := types.ReceiptImage{Bytes: []byte("other pixels"), MediaType: "image/png"}
	other, err := a.CreateReceipt(context.Background(), receiptPostingID, "other.png", otherImage)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.ReplaceReceiptImage(context.Background(), r.ID, r.Revision, "duplicate.png", otherImage); !errors.Is(err, ErrReceiptDuplicate) {
		t.Fatalf("duplicate replace = %v", err)
	}
	if _, err := a.db.Exec(`UPDATE receipts SET size = ? WHERE id = ? AND account_id = :account_id`, ReceiptStorageLimit-r.Size, other.ID); err != nil {
		t.Fatal(err)
	}
	image.Bytes = bytes.Repeat([]byte("x"), 100)
	if _, err := a.ReplaceReceiptImage(context.Background(), r.ID, r.Revision, "large.png", image); !errors.Is(err, ErrReceiptQuota) {
		t.Fatalf("quota replace = %v", err)
	}
	stored, err := a.GetReceipt(r.ID)
	if err != nil || !reflect.DeepEqual(stored, r) {
		t.Fatal("failed replacement removed old receipt", err)
	}
	image.Bytes = []byte("x")
	if _, err := a.ReplaceReceiptImage(context.Background(), r.ID, r.Revision, "smaller.png", image); err != nil {
		t.Fatalf("replacement did not reclaim old image quota: %v", err)
	}
}

func TestReceiptImageReadsStayConsistentDuringReplacement(t *testing.T) {
	d := openSharedTestDatabase(t)
	s := privateTestPlan(t, d, "replace-read")
	p := seedReceiptPosting(t, s)
	images := []types.ReceiptImage{
		{Bytes: []byte("PNG pixels"), MediaType: "image/png"},
		{Bytes: []byte("JPEG pixels"), MediaType: "image/jpeg"},
	}
	r, err := s.CreateReceipt(context.Background(), p.ID, "receipt", images[0])
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		current := r
		for i := 0; i < 100; i++ {
			var err error
			current, err = s.ReplaceReceiptImage(context.Background(), current.ID, current.Revision, "receipt", images[(i+1)%2])
			if err != nil {
				done <- err
				return
			}
		}
		done <- nil
	}()
	var readErr error
	for i := 0; i < 100; i++ {
		image, err := s.GetReceiptImage(context.Background(), r.ID)
		if err != nil {
			readErr = err
			break
		}
		for _, expected := range images {
			if bytes.Equal(image.Bytes, expected.Bytes) && image.MediaType != expected.MediaType {
				readErr = fmt.Errorf("pixels %q use media type %q, want %q", image.Bytes, image.MediaType, expected.MediaType)
			}
		}
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if readErr != nil {
		t.Fatal(readErr)
	}
}
