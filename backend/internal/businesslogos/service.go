package businesslogos

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image/png"
	"io"
	"log/slog"
	"os"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
)

// ErrUnknownLogo reports a key outside the embedded manifest and the imported
// logo manifest. No object-key lookup or store error detail reaches HTTP
// callers through this service.
var ErrUnknownLogo = errors.New("unknown business logo")

// Service reads only manifest-approved assets from an injected private store.
// It never accepts an object key, a URL, or a path from account metadata.
// Seed runs only during composition; imported metadata is read-only afterward.
type Service struct {
	store       blobstore.Store
	importedDir string
	imported    map[string]Asset
}

// Option configures offline assets at the composition boundary.
type Option func(*Service)

// WithLogoDevDirectory selects the explicit directory containing operator-
// imported <key>.png files. Serving never reads this directory or Logo.dev.
func WithLogoDevDirectory(dir string) Option {
	return func(service *Service) {
		service.importedDir = strings.TrimSpace(dir)
	}
}

// New requires a store dedicated to catalog assets. The caller owns the store
// and its lifecycle, including Close for adapters that hold file handles.
func New(store blobstore.Store, options ...Option) (*Service, error) {
	if store == nil {
		return nil, errors.New("business logo store is required")
	}
	service := &Service{store: store, imported: make(map[string]Asset)}
	for _, option := range options {
		if option != nil {
			option(service)
		}
	}
	return service, nil
}

// Lookup resolves the embedded manifest first, then valid imports loaded by
// Seed. Embedded assets always keep their curated bytes and immutable version.
func (s *Service) Lookup(key string) (Asset, bool) {
	if asset, ok := Lookup(key); ok {
		return asset, true
	}
	asset, ok := s.imported[key]
	return asset, ok
}

// IsImported reports whether a resolved key came from the offline Logo.dev
// cache. It lets the HTTP boundary treat a missing optional import as absent
// without changing the verified behavior of embedded assets.
func (s *Service) IsImported(key string) bool {
	if _, curated := Lookup(key); curated {
		return false
	}
	_, ok := s.imported[key]
	return ok
}

// Seed publishes every curated asset and valid imported PNG idempotently. It
// is called once at composition time, never per request. Invalid or unavailable
// imports are logged and omitted so an optional cache cannot block readiness.
func (s *Service) Seed(ctx context.Context) error {
	for _, key := range Keys() {
		if err := ctx.Err(); err != nil {
			return err
		}
		asset := manifest[key]
		data, err := logoFiles.ReadFile("logos/" + asset.File)
		if err != nil {
			return fmt.Errorf("read curated logo %s: %w", key, err)
		}
		if err := s.store.Put(ctx, asset.ObjectKey, bytes.NewReader(data), asset.Size); err != nil {
			return fmt.Errorf("seed logo %s: %w", key, err)
		}
	}
	return s.seedImported(ctx)
}

func (s *Service) seedImported(ctx context.Context) error {
	s.imported = make(map[string]Asset)
	if s.importedDir == "" {
		return nil
	}
	root, err := os.OpenRoot(s.importedDir)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			slog.WarnContext(ctx, "imported business logo directory unavailable", "error", err)
		}
		return nil
	}
	defer root.Close()

	for key := range logoDevDomains {
		if err := ctx.Err(); err != nil {
			return err
		}
		// Curated entries are immutable. Only allowlisted, portable keys can
		// name an import; request paths never become filenames.
		if _, curated := manifest[key]; curated || !blobstore.ValidKey(key) {
			continue
		}
		data, err := readImportedPNG(root, key+".png")
		if err == nil {
			err = validateImportedPNG(data)
		}
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			slog.WarnContext(ctx, "imported business logo ignored", "key", key, "error", err)
			continue
		}
		digest := sha256.Sum256(data)
		hash := hex.EncodeToString(digest[:])
		asset := Asset{
			Key:         key,
			File:        key + ".png",
			ObjectKey:   "businesslogo_" + key + "_" + hash,
			SHA256:      hash,
			Version:     hash,
			Size:        int64(len(data)),
			ContentType: pngLogoType,
		}
		if err := s.store.Put(ctx, asset.ObjectKey, bytes.NewReader(data), asset.Size); err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			slog.WarnContext(ctx, "imported business logo unavailable", "key", key, "error", err)
			continue
		}
		s.imported[key] = asset
	}
	return nil
}

func readImportedPNG(root *os.Root, name string) ([]byte, error) {
	info, err := root.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("import is not a regular file")
	}
	if info.Size() <= 0 || info.Size() > maxLogoBytes {
		return nil, fmt.Errorf("PNG payload length %d out of range", info.Size())
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, err
	}
	data, readErr := io.ReadAll(io.LimitReader(file, maxLogoBytes+1))
	closeErr := file.Close()
	if err := errors.Join(readErr, closeErr); err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > maxLogoBytes {
		return nil, fmt.Errorf("PNG payload length %d out of range", len(data))
	}
	return data, nil
}

func validateImportedPNG(data []byte) error {
	if err := validatePNG(data); err != nil {
		return err
	}
	// Decode the complete raster, including image data, rather than trusting
	// only the header. Dimensions are already bounded by validatePNG.
	if _, err := png.Decode(bytes.NewReader(data)); err != nil {
		return fmt.Errorf("PNG could not be fully decoded: %w", err)
	}
	return nil
}

// Open reads a resolved asset and verifies its bytes against the manifest
// digest before returning them. Unknown keys never reach the store.
func (s *Service) Open(ctx context.Context, key string) (io.ReadCloser, Asset, error) {
	asset, ok := s.Lookup(key)
	if !ok {
		return nil, Asset{}, ErrUnknownLogo
	}
	reader, err := s.store.Open(ctx, asset.ObjectKey)
	if err != nil {
		return nil, Asset{}, err
	}
	data, readErr := io.ReadAll(io.LimitReader(reader, asset.Size+1))
	closeErr := reader.Close()
	if err := errors.Join(readErr, closeErr); err != nil {
		return nil, Asset{}, err
	}
	if int64(len(data)) != asset.Size {
		return nil, Asset{}, fmt.Errorf("logo %s has unexpected length", key)
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != asset.SHA256 {
		return nil, Asset{}, fmt.Errorf("logo %s failed digest verification", key)
	}
	return io.NopCloser(bytes.NewReader(data)), asset, nil
}
