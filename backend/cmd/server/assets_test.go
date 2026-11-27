package main

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/businesslogos"
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

func TestConfigureAssetServiceLoadsLogoDevSubdirectory(t *testing.T) {
	root := t.TempDir()
	assetDir := filepath.Join(root, "custom-assets")
	importDir := filepath.Join(assetDir, logoDevDirectory)
	if err := os.MkdirAll(importDir, 0o700); err != nil {
		t.Fatal(err)
	}
	key := importedConfigTestKey(t)
	img := image.NewRGBA(image.Rect(0, 0, 5, 5))
	img.Set(0, 0, color.RGBA{R: 30, G: 60, B: 90, A: 255})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, img); err != nil {
		t.Fatal(err)
	}
	data := encoded.Bytes()
	if err := os.WriteFile(filepath.Join(importDir, key+".png"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	env := func(name string) string {
		if name == "NET_WORTH_ESTIMATOR_ASSET_DIR" {
			return assetDir
		}
		return ""
	}
	service, closeStore, err := configureAssetService(filepath.Join(root, "ledger.db"), env)
	if err != nil {
		t.Fatal(err)
	}
	defer closeStore()
	reader, _, err := service.Open(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	served, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(served, data) {
		t.Fatalf("served import = %d %v %v", len(served), readErr, closeErr)
	}
}

func importedConfigTestKey(t *testing.T) string {
	t.Helper()
	for key := range businesslogos.LogoDevDomains() {
		if _, curated := businesslogos.Lookup(key); !curated {
			return key
		}
	}
	t.Fatal("no allowlisted provider key is available for a configuration test")
	return ""
}
