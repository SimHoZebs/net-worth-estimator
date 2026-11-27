package businesslogos

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
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

func TestServiceImportedLifecycle(t *testing.T) {
	ctx := context.Background()
	key := importedTestKey(t)
	dir := t.TempDir()
	original := importedTestPNG(t, color.RGBA{R: 20, G: 40, B: 60, A: 255})
	writeImportedTestPNG(t, dir, key, original)
	store := memory.New()
	service, err := New(store, WithLogoDevDirectory(dir))
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Seed(ctx); err != nil {
		t.Fatal(err)
	}
	asset, ok := service.Lookup(key)
	digest := sha256.Sum256(original)
	hash := hex.EncodeToString(digest[:])
	if !ok || !service.IsImported(key) || asset.Version != hash || asset.SHA256 != hash || asset.ObjectKey != "businesslogo_"+key+"_"+hash {
		t.Fatalf("imported asset = %+v %v", asset, ok)
	}
	if got := readImportedTestObject(t, mustOpenTestObject(t, store, asset.ObjectKey)); !bytes.Equal(got, original) {
		t.Fatal("stored import differs from source bytes")
	}

	replacement := importedTestPNG(t, color.RGBA{R: 200, G: 100, B: 50, A: 255})
	writeImportedTestPNG(t, dir, key, replacement)
	reader, served, err := service.Open(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if got := readImportedTestObject(t, reader); !bytes.Equal(got, original) || served.Version != hash {
		t.Fatal("serving reread the import directory")
	}
	if err := service.Seed(ctx); err != nil {
		t.Fatal(err)
	}
	updated, ok := service.Lookup(key)
	if !ok || updated.Version == hash || updated.ObjectKey == asset.ObjectKey {
		t.Fatalf("updated asset = %+v %v", updated, ok)
	}
	if got := readImportedTestObject(t, mustOpenTestObject(t, store, asset.ObjectKey)); !bytes.Equal(got, original) {
		t.Fatal("update overwrote the old immutable object")
	}
	if got := readImportedTestObject(t, mustOpenTestObject(t, store, updated.ObjectKey)); !bytes.Equal(got, replacement) {
		t.Fatal("updated object differs from replacement bytes")
	}
}

func TestServiceBadImportsAreIsolatedAndCuratedAssetsWin(t *testing.T) {
	dir := t.TempDir()
	valid := importedTestPNG(t, color.RGBA{A: 255})
	corruptKey := importedTestKey(t)
	symlinkKey := importedTestKey(t, corruptKey)
	writeImportedTestPNG(t, dir, corruptKey, valid[:len(valid)/2])
	writeImportedTestPNG(t, dir, "not-in-catalog", valid)
	writeImportedTestPNG(t, dir, "chase", valid)
	external := filepath.Join(t.TempDir(), "outside.png")
	if err := os.WriteFile(external, valid, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, filepath.Join(dir, symlinkKey+".png")); err != nil {
		t.Fatal(err)
	}
	service, err := New(memory.New(), WithLogoDevDirectory(dir))
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Seed(context.Background()); err != nil {
		t.Fatalf("bad cache blocked startup: %v", err)
	}
	for _, key := range []string{corruptKey, symlinkKey, "not-in-catalog"} {
		if _, ok := service.Lookup(key); ok {
			t.Fatalf("excluded key %q resolved", key)
		}
	}
	if curated, ok := service.Lookup("chase"); !ok || curated != manifest["chase"] || service.IsImported("chase") {
		t.Fatalf("curated asset was replaced: %+v", curated)
	}
}

func TestServiceImportedStoreFailureIsOptional(t *testing.T) {
	key := importedTestKey(t)
	data := importedTestPNG(t, color.RGBA{A: 255})
	dir := t.TempDir()
	writeImportedTestPNG(t, dir, key, data)
	digest := sha256.Sum256(data)
	objectKey := "businesslogo_" + key + "_" + hex.EncodeToString(digest[:])
	service, err := New(&importConflictStore{Store: memory.New(), key: objectKey}, WithLogoDevDirectory(dir))
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Seed(context.Background()); err != nil {
		t.Fatalf("conflicting imported object blocked startup: %v", err)
	}
	if _, ok := service.Lookup(key); ok {
		t.Fatal("conflicting import was published")
	}
	if _, _, err := service.Open(context.Background(), "chase"); err != nil {
		t.Fatalf("curated behavior changed: %v", err)
	}
}

type importConflictStore struct {
	blobstore.Store
	key string
}

func (s *importConflictStore) Put(ctx context.Context, key string, reader io.Reader, size int64) error {
	if key == s.key {
		return blobstore.ErrConflict
	}
	return s.Store.Put(ctx, key, reader, size)
}

func importedTestKey(t *testing.T, excluded ...string) string {
	t.Helper()
	skip := make(map[string]bool, len(excluded))
	for _, key := range excluded {
		skip[key] = true
	}
	for key := range logoDevDomains {
		if _, curated := manifest[key]; !curated && !skip[key] {
			return key
		}
	}
	t.Fatal("no allowlisted provider key is available for an import test")
	return ""
}

func importedTestPNG(t *testing.T, pixel color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	img.Set(0, 0, pixel)
	var output bytes.Buffer
	if err := png.Encode(&output, img); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func writeImportedTestPNG(t *testing.T, dir, key string, data []byte) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, key+".png"), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func mustOpenTestObject(t *testing.T, store blobstore.Store, key string) io.ReadCloser {
	t.Helper()
	reader, err := store.Open(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	return reader
}

func readImportedTestObject(t *testing.T, reader io.ReadCloser) []byte {
	t.Helper()
	data, err := io.ReadAll(reader)
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	if err != nil {
		t.Fatal(err)
	}
	return data
}
