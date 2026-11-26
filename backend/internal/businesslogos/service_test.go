package businesslogos

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/adapters/memory"
)

func TestServiceSeedsAndServesOnlyCatalogAssets(t *testing.T) {
	ctx := context.Background()
	store := memory.New()
	service, err := New(store)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Seed(ctx); err != nil {
		t.Fatal(err)
	}
	// Seeding is idempotent and never touches a private receipt-style key.
	if err := service.Seed(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Open(ctx, "cafebabe-receipt-object"); !errors.Is(err, blobstore.ErrNotFound) {
		t.Fatalf("private object unexpectedly present: %v", err)
	}
	for _, key := range Keys() {
		asset := manifest[key]
		if _, err := store.Open(ctx, asset.ObjectKey); err != nil {
			t.Fatalf("seed missing %s: %v", key, err)
		}
		reader, served, err := service.Open(ctx, key)
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(reader)
		closeErr := reader.Close()
		if err != nil || closeErr != nil || int64(len(data)) != served.Size || served.ContentType != asset.ContentType {
			t.Fatalf("open %s: %d %v %v", key, len(data), err, closeErr)
		}
	}
	if _, _, err := service.Open(ctx, "receipt-secret"); !errors.Is(err, ErrUnknownLogo) {
		t.Fatalf("unknown key reached store: %v", err)
	}
	if _, _, err := service.Open(ctx, "chase/../private"); !errors.Is(err, ErrUnknownLogo) {
		t.Fatalf("path key reached store: %v", err)
	}
	if _, err := New(nil); err == nil {
		t.Fatal("nil store accepted")
	}
}

// canceledStore blocks until its context ends, modeling a provider that can
// stall during boot seeding.
type canceledStore struct{}

func (canceledStore) Put(ctx context.Context, _ string, _ io.Reader, _ int64) error {
	<-ctx.Done()
	return ctx.Err()
}

func (canceledStore) Open(ctx context.Context, _ string) (io.ReadCloser, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func (canceledStore) Delete(ctx context.Context, _ string) error {
	<-ctx.Done()
	return ctx.Err()
}

func TestSeedHonorsCancellationAndDeadlines(t *testing.T) {
	service, err := New(canceledStore{})
	if err != nil {
		t.Fatal(err)
	}
	canceled, stop := context.WithCancel(context.Background())
	stop()
	if err := service.Seed(canceled); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled seed = %v", err)
	}
	expired, stop := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer stop()
	if err := service.Seed(expired); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expired seed = %v", err)
	}
}

type recordingStore struct {
	puts    []string
	opens   []string
	openErr error
	bytes   []byte
}

func (s *recordingStore) Put(_ context.Context, key string, reader io.Reader, _ int64) error {
	s.puts = append(s.puts, key)
	_, _ = io.Copy(io.Discard, reader)
	return nil
}

func (s *recordingStore) Open(_ context.Context, key string) (io.ReadCloser, error) {
	s.opens = append(s.opens, key)
	if s.openErr != nil {
		return nil, s.openErr
	}
	return io.NopCloser(bytes.NewReader(s.bytes)), nil
}

func (s *recordingStore) Delete(context.Context, string) error { return nil }

func TestServiceVerifiesDigestAndHidesStoreFailures(t *testing.T) {
	ctx := context.Background()
	asset := manifest["chase"]
	store := &recordingStore{openErr: blobstore.ErrNotFound}
	service, err := New(store)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Open(ctx, "chase"); !errors.Is(err, blobstore.ErrNotFound) {
		t.Fatalf("read failure = %v", err)
	}
	if store.opens[0] != asset.ObjectKey {
		t.Fatalf("opened %q instead of a namespaced object key", store.opens[0])
	}
	store.openErr = nil
	store.bytes = []byte("<svg>corrupt</svg>")
	if _, _, err := service.Open(ctx, "chase"); err == nil {
		t.Fatal("digest mismatch accepted")
	}
	store.bytes = []byte("truncated")
	if _, _, err := service.Open(ctx, "chase"); err == nil {
		t.Fatal("short payload accepted")
	}
}
