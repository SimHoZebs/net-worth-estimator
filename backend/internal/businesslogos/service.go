package businesslogos

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore"
)

// ErrUnknownLogo reports a key outside the curated manifest. No object-key
// lookup or store error detail reaches HTTP callers through this service.
var ErrUnknownLogo = errors.New("unknown business logo")

// Service reads only manifest-approved assets from an injected private store.
// It never accepts an object key, a URL, or a path from account metadata.
type Service struct {
	store blobstore.Store
}

// New requires a store dedicated to catalog assets. The caller owns the store
// and its lifecycle, including Close for adapters that hold file handles.
func New(store blobstore.Store) (*Service, error) {
	if store == nil {
		return nil, errors.New("business logo store is required")
	}
	return &Service{store: store}, nil
}

// Seed publishes every curated asset idempotently. It is called once at
// composition time, never per request.
func (s *Service) Seed(ctx context.Context) error {
	for _, key := range Keys() {
		asset := manifest[key]
		data, err := logoFiles.ReadFile("logos/" + asset.File)
		if err != nil {
			return fmt.Errorf("read curated logo %s: %w", key, err)
		}
		if err := s.store.Put(ctx, asset.ObjectKey, bytes.NewReader(data), asset.Size); err != nil {
			return fmt.Errorf("seed logo %s: %w", key, err)
		}
	}
	return nil
}

// Open reads a catalog asset and verifies its bytes against the manifest
// digest before returning them. Unknown keys never reach the store.
func (s *Service) Open(ctx context.Context, key string) (io.ReadCloser, Asset, error) {
	asset, ok := Lookup(key)
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
