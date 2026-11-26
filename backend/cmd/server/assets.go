package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/adapters/filesystem"
	"github.com/simhozebs/net-worth-estimator/backend/internal/businesslogos"
)

// configureAssetService builds a store root separate from private receipts.
// The directory is created owner-only at the composition boundary and its
// lifecycle is owned by the server. Curated assets are seeded idempotently;
// no request ever downloads or writes an asset.
func configureAssetService(dbPath string, getenv func(string) string) (*businesslogos.Service, func() error, error) {
	dir := strings.TrimSpace(getenv("NET_WORTH_ESTIMATOR_ASSET_DIR"))
	if dir == "" {
		dir = filepath.Join(filepath.Dir(dbPath), "business-logos")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, nil, fmt.Errorf("create asset directory: %w", err)
	}
	store, err := filesystem.New(dir)
	if err != nil {
		return nil, nil, fmt.Errorf("open asset store: %w", err)
	}
	service, err := businesslogos.New(store)
	if err != nil {
		_ = store.Close()
		return nil, nil, err
	}
	// Injected storage can block; boot I/O gets a finite deadline.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := service.Seed(ctx); err != nil {
		_ = store.Close()
		return nil, nil, fmt.Errorf("seed curated logos: %w", err)
	}
	return service, store.Close, nil
}
