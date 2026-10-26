package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// credentials are the CLI's cached identity. Tokens stay in one
// owner-only file; nothing is logged or transmitted except as an
// Authorization header to the configured API base URL.
type credentials struct {
	Subject      string    `json:"subject"`
	ResourceID   string    `json:"resourceId"`
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken"`
	Expiry       time.Time `json:"expiry"`
}

func credentialsPath() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		return "", fmt.Errorf("locate user config directory: %w", err)
	}
	return filepath.Join(base, "net-worth-estimator", "cli-tokens.json"), nil
}

func loadCredentials() (credentials, error) {
	path, err := credentialsPath()
	if err != nil {
		return credentials{}, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return credentials{}, nil
		}
		return credentials{}, err
	}
	var stored credentials
	if err := json.Unmarshal(raw, &stored); err != nil {
		return credentials{}, fmt.Errorf("read cached credentials: %w", err)
	}
	return stored, nil
}

func saveCredentials(stored credentials) error {
	path, err := credentialsPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := os.Chmod(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	raw, err := json.Marshal(stored)
	if err != nil {
		return err
	}
	// WriteFile applies the mode only on creation, so enforce it after
	// every write: a pre-existing cache must never stay world-readable.
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

func clearCredentials() error {
	path, err := credentialsPath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
