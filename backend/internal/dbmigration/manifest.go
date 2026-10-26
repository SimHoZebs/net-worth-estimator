// Package dbmigration provides an explicit, offline, legacy database migration.
// Sources are opened read-only. A destination is published only after validation.
package dbmigration

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

type Manifest struct {
	Version    int      `json:"version"`
	Sources    []Source `json:"sources"`
	SessionsDB string   `json:"sessions_db,omitempty"`
}

type Source struct {
	Path       string `json:"path"`
	ResourceID string `json:"resource_id"`
	Kind       string `json:"kind"`
	Issuer     string `json:"issuer,omitempty"`
	Subject    string `json:"subject,omitempty"`
}

// ReadManifest resolves source paths relative to the manifest, not the process.
func ReadManifest(path string) (Manifest, error) {
	f, err := os.Open(path)
	if err != nil {
		return Manifest{}, err
	}
	defer f.Close()
	var m Manifest
	d := json.NewDecoder(f)
	d.DisallowUnknownFields()
	if err := d.Decode(&m); err != nil {
		return m, fmt.Errorf("decode manifest: %w", err)
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return m, fmt.Errorf("manifest must contain one JSON object")
	}
	base, err := filepath.Abs(filepath.Dir(path))
	if err != nil {
		return m, err
	}
	resolve := func(p string) string {
		if filepath.IsAbs(p) {
			return p
		}
		return filepath.Join(base, p)
	}
	for i := range m.Sources {
		if m.Sources[i].Path != "" {
			m.Sources[i].Path = resolve(m.Sources[i].Path)
		}
	}
	if m.SessionsDB != "" {
		m.SessionsDB = resolve(m.SessionsDB)
	}
	return m, nil
}

func (m Manifest) validate() error {
	if m.Version != 1 {
		return fmt.Errorf("unsupported manifest version: expected 1")
	}
	if len(m.Sources) == 0 {
		return fmt.Errorf("manifest requires at least one source")
	}
	plans := map[string]bool{}
	var files []os.FileInfo
	checkFile := func(path string) error {
		if path == "" {
			return fmt.Errorf("source path is required")
		}
		info, err := os.Stat(path)
		if err != nil {
			return fmt.Errorf("source is not accessible")
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("source must be a regular SQLite file")
		}
		for _, other := range files {
			if os.SameFile(info, other) {
				return fmt.Errorf("duplicate source file, including aliases or links")
			}
		}
		files = append(files, info)
		return nil
	}
	for i, s := range m.Sources {
		if err := checkFile(s.Path); err != nil {
			return fmt.Errorf("source %d: %w", i+1, err)
		}
		var expected authorization.Resource
		switch s.Kind {
		case "private":
			if strings.TrimSpace(s.Issuer) == "" || strings.TrimSpace(s.Subject) == "" {
				return fmt.Errorf("source %d: private owner requires issuer and subject", i+1)
			}
			expected = authorization.ResourceFor(s.Issuer, s.Subject)
		case "sample":
			if s.Issuer != "" || s.Subject != "" {
				return fmt.Errorf("source %d: sample cannot specify an owner", i+1)
			}
			expected = authorization.ResourceFor("", "")
		default:
			return fmt.Errorf("source %d: kind must be private or sample", i+1)
		}
		if expected.ID != s.ResourceID {
			return fmt.Errorf("source %d: resource_id does not match its verified owner or sample kind", i+1)
		}
		if plans[s.ResourceID] {
			return fmt.Errorf("source %d: duplicate plan", i+1)
		}
		plans[s.ResourceID] = true
	}
	if m.SessionsDB != "" {
		return checkFile(m.SessionsDB)
	}
	return nil
}
