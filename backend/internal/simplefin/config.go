package simplefin

import (
	"fmt"
	"strings"
	"time"
)

// Config wires the sync from environment values. The access URL and card
// set are read in main; account links live in the database, never here.
type Config struct {
	// AccessURL is the Bridge Access URL secret.
	AccessURL string
	// CardAccounts lists model account IDs treated as cards: only these get
	// pending seed postings.
	CardAccounts map[string]struct{}
	// MinTriggerInterval spaces successful manual trigger runs. Zero means
	// DefaultMinTriggerInterval, matching the Bridge daily-update quota.
	MinTriggerInterval time.Duration
	// RateLimitCooldown blocks Bridge fetches after an upstream 429 so one
	// frontend burst cannot cost the Access Token. Zero means
	// DefaultRateLimitCooldown.
	RateLimitCooldown time.Duration
}

// ParseCardAccounts parses a comma-separated list of model account IDs.
func ParseCardAccounts(value string) map[string]struct{} {
	accounts := map[string]struct{}{}
	for _, entry := range strings.Split(value, ",") {
		if id := strings.TrimSpace(entry); id != "" {
			accounts[id] = struct{}{}
		}
	}
	return accounts
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
