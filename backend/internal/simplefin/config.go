package simplefin

import (
	"fmt"
	"strings"
	"time"
)

// Config wires the sync throttling. The Bridge credential and card set live
// in the database per plan (see store.SyncCredential), never here and never
// in the environment.
type Config struct {
	// MinTriggerInterval spaces successful manual trigger runs. Zero means
	// DefaultMinTriggerInterval, matching the Bridge daily-update quota.
	MinTriggerInterval time.Duration
	// RateLimitCooldown blocks Bridge fetches after an upstream 429 so one
	// frontend burst cannot cost the Access Token. Zero means
	// DefaultRateLimitCooldown.
	RateLimitCooldown time.Duration
}

// ParsePositiveDuration parses a Go duration string (e.g. "6h", "90m") for
// sync throttling. Empty means fallback; invalid or non-positive values are
// an error so operators notice a typo instead of silently hammering the
// Bridge.
func ParsePositiveDuration(value string, fallback time.Duration) (time.Duration, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(trimmed)
	if err != nil {
		return 0, fmt.Errorf("invalid duration %q: %w", value, err)
	}
	if parsed <= 0 {
		return 0, fmt.Errorf("invalid duration %q: must be positive", value)
	}
	return parsed, nil
}
