package sqlite

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/adapters/filesystem"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type faultBlobs struct {
	blobstore.Store
	put                  func(context.Context, string, io.Reader, int64) error
	open                 func(context.Context, string) (io.ReadCloser, error)
	deleteErr            error
	puts, opens, deletes int
}

func (s *faultBlobs) Put(ctx context.Context, key string, reader io.Reader, size int64) error {
	s.puts++
	if s.put != nil {
		return s.put(ctx, key, reader, size)
	}
	return s.Store.Put(ctx, key, reader, size)
}
func (s *faultBlobs) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	s.opens++
	if s.open != nil {
		return s.open(ctx, key)
	}
	return s.Store.Open(ctx, key)
}
func (s *faultBlobs) Delete(ctx context.Context, key string) error {
	s.deletes++
	if s.deleteErr != nil {
		return s.deleteErr
	}
	return s.Store.Delete(ctx, key)
}

func externalBlobFixture(t *testing.T) (*Database, *sqliteStore, *faultBlobs, string) {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	files, err := filesystem.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { files.Close() })
	blobs := &faultBlobs{Store: files}
	path := filepath.Join(t.TempDir(), "application.db")
	d, err := SetupDatabase(path, WithBlobStore(blobs))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	s := privateTestPlan(t, d, "external")
	seedReceiptPosting(t, s)
	return d, s, blobs, path
}

func receiptBlobKey(t *testing.T, s *sqliteStore, id string) string {
	t.Helper()
	var key string
	if err := s.db.QueryRow(`SELECT blob_key FROM receipts WHERE id=? AND plan_id=:plan_id`, id).Scan(&key); err != nil {
		t.Fatal(err)
	}
	return key
}

func TestReceiptBlobAdapterSwapAndAuthorization(t *testing.T) {
	d, a, blobs, _ := externalBlobFixture(t)
	b := privateTestPlan(t, d, "other")
	seedReceiptPosting(t, b)
	ctx := t.Context()
	image := types.ReceiptImage{Bytes: []byte("external pixels"), MediaType: "image/png"}
	r, err := a.CreateReceipt(ctx, receiptPostingID, "receipt.png", image)
	if err != nil {
		t.Fatal(err)
	}
	key := receiptBlobKey(t, a, r.ID)
	payload, _ := json.Marshal(r)
	if strings.Contains(string(payload), key) || !blobstore.ValidKey(key) {
		t.Fatal("blob reference leaked into receipt response")
	}
	var count int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM blob_data`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("external pixels entered SQLite: %d %v", count, err)
	}
	got, err := a.GetReceiptImage(ctx, r.ID)
	if err != nil || !bytes.Equal(got.Bytes, image.Bytes) {
		t.Fatalf("external read = %+v %v", got, err)
	}
	puts, opens, deletes := blobs.puts, blobs.opens, blobs.deletes
	if _, err := b.GetReceiptImage(ctx, r.ID); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatal(err)
	}
	if _, err := b.ReplaceReceiptImage(ctx, r.ID, r.Revision, "other.png", image); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatal(err)
	}
	if err := b.DeleteReceipt(ctx, r.ID); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatal(err)
	}
	if puts != blobs.puts || opens != blobs.opens || deletes != blobs.deletes {
		t.Fatal("denied access reached blob provider")
	}
	if err := a.DeletePosting(receiptPostingID); err != nil {
		t.Fatal(err)
	}
	if err := d.CollectBlobGarbage(ctx, 100); err != nil {
		t.Fatal(err)
	}
	if _, err := blobs.Open(ctx, key); !errors.Is(err, blobstore.ErrNotFound) {
		t.Fatalf("cascade kept pixels: %v", err)
	}
}

func TestBlobUploadFailureKeepsReviewedImageAndRetriesAfterRestart(t *testing.T) {
	d, s, blobs, path := externalBlobFixture(t)
	ctx := t.Context()
	r, err := s.CreateReceipt(ctx, receiptPostingID, "old.png", types.ReceiptImage{Bytes: []byte("old pixels"), MediaType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	r.Confirmed = &types.ReceiptDetails{Merchant: "Reviewed"}
	r, err = s.SaveReceipt(r, r.Revision)
	if err != nil {
		t.Fatal(err)
	}
	oldKey := receiptBlobKey(t, s, r.ID)
	blobs.put = func(ctx context.Context, key string, reader io.Reader, size int64) error {
		if err := blobs.Store.Put(ctx, key, reader, size); err != nil {
			return err
		}
		return errors.New("uncertain upstream write")
	}
	if _, err := s.ReplaceReceiptImage(ctx, r.ID, r.Revision, "new.png", types.ReceiptImage{Bytes: []byte("new pixels"), MediaType: "image/png"}); err == nil {
		t.Fatal("upload failure ignored")
	}
	stored, err := s.GetReceipt(r.ID)
	if err != nil || stored.Confirmed == nil || stored.Confirmed.Merchant != "Reviewed" || receiptBlobKey(t, s, r.ID) != oldKey {
		t.Fatal("failed upload replaced reviewed evidence", err)
	}
	var abandoned string
	if err := d.db.QueryRow(`SELECT key FROM blob_objects WHERE state='staged'`).Scan(&abandoned); err != nil {
		t.Fatal(err)
	}
	if _, err := d.db.Exec(`UPDATE blob_objects SET expires_at=0 WHERE key=?`, abandoned); err != nil {
		t.Fatal(err)
	}
	blobs.deleteErr = errors.New("storage offline")
	if err := d.CollectBlobGarbage(ctx, 100); err == nil {
		t.Fatal("delete failure ignored")
	}
	d.Close()
	blobs.put, blobs.deleteErr = nil, nil
	reopened, err := OpenDatabase(path, WithBlobStore(blobs))
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if err := reopened.CollectBlobGarbage(ctx, 100); err != nil {
		t.Fatal(err)
	}
	if _, err := blobs.Open(ctx, abandoned); !errors.Is(err, blobstore.ErrNotFound) {
		t.Fatalf("abandoned upload survived retry: %v", err)
	}
	if reader, err := blobs.Open(ctx, oldKey); err != nil {
		t.Fatal("live evidence deleted", err)
	} else {
		reader.Close()
	}
}

func TestBlobReplacementConflictAndReadRace(t *testing.T) {
	d, s, blobs, _ := externalBlobFixture(t)
	ctx := t.Context()
	image := types.ReceiptImage{Bytes: []byte("old pixels"), MediaType: "image/png"}
	r, err := s.CreateReceipt(ctx, receiptPostingID, "old.png", image)
	if err != nil {
		t.Fatal(err)
	}
	oldKey := receiptBlobKey(t, s, r.ID)
	blobs.put = func(ctx context.Context, key string, reader io.Reader, size int64) error {
		if err := blobs.Store.Put(ctx, key, reader, size); err != nil {
			return err
		}
		r.Draft = &types.ReceiptDetails{Merchant: "Concurrent correction"}
		var err error
		r, err = s.SaveReceipt(r, r.Revision)
		return err
	}
	newImage := types.ReceiptImage{Bytes: []byte("new pixels"), MediaType: "image/jpeg"}
	if _, err := s.ReplaceReceiptImage(ctx, r.ID, r.Revision, "new.jpg", newImage); !errors.Is(err, ErrReceiptConflict) {
		t.Fatalf("concurrent replacement = %v", err)
	}
	if receiptBlobKey(t, s, r.ID) != oldKey {
		t.Fatal("conflict changed the image")
	}
	var count int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM blob_objects`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("unpublished object leaked: %d %v", count, err)
	}
	blobs.put = nil
	blobs.open = func(ctx context.Context, key string) (io.ReadCloser, error) {
		blobs.open = nil
		if _, err := s.ReplaceReceiptImage(ctx, r.ID, r.Revision, "new.jpg", newImage); err != nil {
			return nil, err
		}
		return blobs.Store.Open(ctx, key)
	}
	got, err := s.GetReceiptImage(ctx, r.ID)
	if err != nil || got.MediaType != "image/jpeg" || !bytes.Equal(got.Bytes, newImage.Bytes) {
		t.Fatalf("replacement raced with read: %+v %v", got, err)
	}
}

func TestReceiptDeletionRetainsRetryWorkWhenProviderFails(t *testing.T) {
	d, s, blobs, _ := externalBlobFixture(t)
	r, err := s.CreateReceipt(t.Context(), receiptPostingID, "image.png", types.ReceiptImage{Bytes: []byte("pixels"), MediaType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	key := receiptBlobKey(t, s, r.ID)
	blobs.deleteErr = errors.New("temporary outage")
	if err := s.DeleteReceipt(t.Context(), r.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetReceiptImage(t.Context(), r.ID); !errors.Is(err, ErrReceiptNotFound) {
		t.Fatal("deleted evidence still accessible", err)
	}
	var state string
	if err := d.db.QueryRow(`SELECT state FROM blob_objects WHERE key=?`, key).Scan(&state); err != nil || state != "deleting" {
		t.Fatal("cleanup work lost", state, err)
	}
	blobs.deleteErr = nil
	if err := d.CollectBlobGarbage(t.Context(), 100); err != nil {
		t.Fatal(err)
	}
	if _, err := blobs.Open(t.Context(), key); !errors.Is(err, blobstore.ErrNotFound) {
		t.Fatal(err)
	}
}

func TestReceiptBlobOperationsHonorCancellationAndIntegrity(t *testing.T) {
	_, s, blobs, _ := externalBlobFixture(t)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	image := types.ReceiptImage{Bytes: []byte("pixels"), MediaType: "image/png"}
	if _, err := s.CreateReceipt(ctx, receiptPostingID, "image.png", image); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled upload = %v", err)
	}
	if blobs.puts != 0 {
		t.Fatal("canceled upload reached provider")
	}
	r, err := s.CreateReceipt(t.Context(), receiptPostingID, "image.png", image)
	if err != nil {
		t.Fatal(err)
	}
	blobs.open = func(context.Context, string) (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewBufferString("wrong pixels")), nil
	}
	if _, err := s.GetReceiptImage(t.Context(), r.ID); err == nil {
		t.Fatal("wrong object bytes accepted")
	}
}
