package simplefin

import (
	"fmt"
	"strings"
)

// Config wires the sync from environment values. All three SimpleFIN
// variables must be read in main; this package only parses and validates.
type Config struct {
	// AccessURL is the Bridge Access URL secret.
	AccessURL string
	// AccountMap links SimpleFIN account IDs to model account IDs.
	AccountMap map[string]string
	// CardAccounts lists model account IDs treated as cards: only these get
	// pending seed postings.
	CardAccounts map[string]struct{}
	// DryRun logs planned writes without applying them.
	DryRun bool
}

// ParseAccountMap parses "sfin-id=model-id,sfin-id=model-id" entries.
func ParseAccountMap(value string) (map[string]string, error) {
	mapping := map[string]string{}
	if strings.TrimSpace(value) == "" {
		return mapping, nil
	}
	for _, entry := range strings.Split(value, ",") {
		parts := strings.SplitN(strings.TrimSpace(entry), "=", 2)
		if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
			return nil, fmt.Errorf("account map entry %q must be sfin-id=model-id", entry)
		}
		mapping[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
	}
	return mapping, nil
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

// ParseDryRun reports whether dry-run mode is on. Only "1" enables it, so
// the first live run cannot happen by typo.
func ParseDryRun(value string) bool {
	return strings.TrimSpace(value) == "1"
}
