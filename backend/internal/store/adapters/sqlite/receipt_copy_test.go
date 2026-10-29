package sqlite

import (
	"bytes"
	"testing"

	blobsqlite "github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestReceiptCopyUsesBlobPortsAndRollsBackUnpublishedObjects(t *testing.T) {
	source := openSharedTestDatabase(t)
	s := privateTestPlan(t, source, "copy-source")
	p := seedReceiptPosting(t, s)
	image := types.ReceiptImage{Bytes: []byte("source pixels"), MediaType: "image/png"}
	r, err := s.CreateReceipt(t.Context(), p.ID, "source.png", image)
	if err != nil {
		t.Fatal(err)
	}
	r.Confirmed = &types.ReceiptDetails{Merchant: "Reviewed source"}
	r, err = s.SaveReceipt(r, r.Revision)
	if err != nil {
		t.Fatal(err)
	}
	d, target, blobs, _ := externalBlobFixture(t)
	for _, commit := range []bool{false, true} {
		copy, err := d.PrepareReceiptCopy(t.Context(), source.SQL(), blobsqlite.New(source.SQL()), s.db.userID)
		if err != nil {
			t.Fatal(err)
		}
		tx, err := d.SQL().Begin()
		if err != nil {
			copy.Close()
			t.Fatal(err)
		}
		if err := copy.Apply(tx, target.db.userID); err != nil {
			tx.Rollback()
			copy.Close()
			t.Fatal(err)
		}
		if commit {
			err = tx.Commit()
		} else {
			err = tx.Rollback()
		}
		copy.Close()
		if err != nil {
			t.Fatal(err)
		}
		if !commit {
			var count int
			if err := d.db.QueryRow(`SELECT COUNT(*) FROM blob_objects`).Scan(&count); err != nil || count != 0 {
				t.Fatalf("rolled back copy leaked objects: %d %v", count, err)
			}
			continue
		}
		got, err := target.GetReceiptImage(t.Context(), r.ID)
		if err != nil || !bytes.Equal(got.Bytes, image.Bytes) {
			t.Fatalf("cross-adapter copy = %+v %v", got, err)
		}
		stored, err := target.GetReceipt(r.ID)
		if err != nil || stored.Confirmed.Merchant != "Reviewed source" {
			t.Fatal("copy lost review", err)
		}
		if receiptBlobKey(t, target, r.ID) == receiptBlobKey(t, s, r.ID) {
			t.Fatal("copy reused source object identity")
		}
		if blobs.puts != 2 {
			t.Fatalf("copy bypassed target blob port: %d", blobs.puts)
		}
	}
	got, err := s.GetReceiptImage(t.Context(), r.ID)
	if err != nil || !bytes.Equal(got.Bytes, image.Bytes) {
		t.Fatal("copy changed source evidence", err)
	}
}
