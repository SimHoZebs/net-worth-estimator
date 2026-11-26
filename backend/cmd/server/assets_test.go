package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestConfigureAssetServiceSeedsSeparateOwnerOnlyDirectory(t *testing.T) {
	root := t.TempDir()
	dbPath := filepath.Join(root, "ledger.db")
	env := func(string) string { return "" }
	service, closeStore, err := configureAssetService(dbPath, env)
	if err != nil {
		t.Fatal(err)
	}
	defer closeStore()
	defaultDir := filepath.Join(root, "business-logos")
	info, err := os.Stat(defaultDir)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("asset directory = %v %v", info, err)
	}
	reader, asset, err := service.Open(context.Background(), "chase")
	if err != nil {
		t.Fatal(err)
	}
	if err := reader.Close(); err != nil || asset.Size <= 0 {
		t.Fatalf("seeded asset = %+v %v", asset, err)
	}

	custom := filepath.Join(root, "custom-assets")
	customEnv := func(key string) string {
		if key == "NET_WORTH_ESTIMATOR_ASSET_DIR" {
			return custom
		}
		return ""
	}
	second, closeSecond, err := configureAssetService(dbPath, customEnv)
	if err != nil {
		t.Fatal(err)
	}
	defer closeSecond()
	entries, err := os.ReadDir(custom)
	if err != nil || len(entries) == 0 {
		t.Fatalf("custom root not seeded: %d %v", len(entries), err)
	}
	secondReader, _, err := second.Open(context.Background(), "venmo")
	if err != nil {
		t.Fatalf("custom root cannot serve catalog: %v", err)
	}
	_ = secondReader.Close()
}
