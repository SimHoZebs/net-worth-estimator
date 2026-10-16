package simplefin

import (
	"strings"
)

// Config wires the sync from environment values. The access URL and card
// set are read in main; account links live in the database, never here.
type Config struct {
	// AccessURL is the Bridge Access URL secret.
	AccessURL string
	// CardAccounts lists model account IDs treated as cards: only these get
	// pending seed postings.
	CardAccounts map[string]struct{}
	// DryRun logs planned writes without applying them.
	DryRun bool
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
