// Package integrationfixtures loads versioned synthetic integration fixture packs.
//
// Packs live under backend/testdata/integration/v1, one concern per file, and are
// synthetic by construction: no production rows, no real credentials, no
// real counterparties. Every harness consumes the same files: store tests
// seed through SeedUser, API tests seed then mount the real composition
// root, and the browser harness restores through the fixture reset route's
// pack option. The pack JSON shape is the canonical financial-model shape,
// so loaders never translate between competing formats.
package integrationfixtures

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Pack names, one per concern. The list is the contract the integration
// matrix runner's --pack flag and matrix accept.
const (
	PackPennyZero   = "penny-zero"
	PackCurrencies  = "currencies"
	PackDuplicates  = "duplicates"
	PackLifecycle   = "lifecycle"
	PackTimezones   = "timezones"
	PackUnicode     = "unicode"
	PackOverlong    = "overlong"
	PackRecurring   = "recurring"
	PackTransfers   = "transfers"
	PackBackdated   = "backdated"
	PackCursors     = "cursors"
	PackMissingData = "missing-data"
	PackRevocation  = "revocation"
	PackInvites     = "invites"
	PackExclusions  = "exclusions"
)

// PackVersion is the only fixture format this loader reads. A format change
// mints v2 alongside v1; loaders never migrate old packs in place.
const PackVersion = 1

// Pack is one decoded fixture file.
type Pack struct {
	Name               string               `json:"pack"`
	Version            int                  `json:"version"`
	Concern            string               `json:"concern"`
	BreaksIfMishandled string               `json:"breaksIfMishandled"`
	Model              types.FinancialModel `json:"model"`
	Extras             PackExtras           `json:"extras"`
}

// PackExtras carries pack-specific setup the model shape cannot express:
// bank lifecycle transitions, sync cursor positions, sharing scripts, and
// split probes. Every field is optional; absent means no extra setup.
type PackExtras struct {
	SyncLifecycle SyncLifecycle `json:"syncLifecycle"`
	SyncState     SyncState     `json:"syncState"`
	SharingScript []SharingStep `json:"sharingScript"`
	InviteScript  []InviteStep  `json:"inviteScript"`
	SplitProbes   []SplitProbe  `json:"splitProbes"`
}

// SyncLifecycle describes bank rows applied through the real sync apply
// path: pending inserts first, then settled conversions and void flips.
type SyncLifecycle struct {
	Pending []BankRowSeed `json:"pending"`
	Settle  []BankRowSeed `json:"settle"`
	Void    []BankRowSeed `json:"void"`
}

// BankRowSeed is one synthetic bank transaction for the lifecycle path.
type BankRowSeed struct {
	ID          string `json:"id"`
	Description string `json:"description"`
	Amount      string `json:"amount"`
	Posted      int64  `json:"posted"`
}

// SyncState pins the sync cursors to stale positions.
type SyncState struct {
	LastSyncTime string      `json:"lastSyncTime"`
	GmailCursor  GmailCursor `json:"gmailCursor"`
}

// GmailCursor pins the mail scan cursor.
type GmailCursor struct {
	HistoryID string `json:"historyId"`
	ScannedAt string `json:"scannedAt"`
}

// SharingStep is one grant, exclusion, revocation, or re-grant applied in
// order by the loader. AudienceID is empty for wildcard steps.
type SharingStep struct {
	Action       string `json:"action"`
	AudienceType string `json:"audienceType"`
	AudienceID   string `json:"audienceId"`
	PostingID    string `json:"postingId"`
}

// InviteStep describes one invite the loader creates: expired invites are
// expired through the real row after creation, exhausted ones are used up,
// fresh ones are left redeemable.
type InviteStep struct {
	MaxUses int    `json:"maxUses"`
	State   string `json:"state"`
}

// SplitProbe is one remainder-theft probe: the total, currency, and
// participant count the integration edge-case suite must divide exactly.
type SplitProbe struct {
	Currency     string `json:"currency"`
	TotalMinor   int64  `json:"totalMinor"`
	Participants int    `json:"participants"`
}

func packDir() string {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		panic("integrationfixtures: cannot locate pack directory")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "testdata", "integration", "v1")
}

// Names lists every pack file present, sorted.
func Names() ([]string, error) {
	entries, err := os.ReadDir(packDir())
	if err != nil {
		return nil, fmt.Errorf("integrationfixtures: list packs: %w", err)
	}
	var names []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		names = append(names, strings.TrimSuffix(entry.Name(), ".json"))
	}
	sort.Strings(names)
	return names, nil
}

// Load decodes one pack and checks its version envelope.
func Load(name string) (Pack, error) {
	raw, err := os.ReadFile(filepath.Join(packDir(), name+".json"))
	if err != nil {
		return Pack{}, fmt.Errorf("integrationfixtures: read pack %q: %w", name, err)
	}
	var pack Pack
	if err := json.Unmarshal(raw, &pack); err != nil {
		return Pack{}, fmt.Errorf("integrationfixtures: decode pack %q: %w", name, err)
	}
	if pack.Name != name {
		return Pack{}, fmt.Errorf("integrationfixtures: pack %q names itself %q", name, pack.Name)
	}
	if pack.Version != PackVersion {
		return Pack{}, fmt.Errorf("integrationfixtures: pack %q version %d, loader reads %d", name, pack.Version, PackVersion)
	}
	if strings.TrimSpace(pack.Concern) == "" || strings.TrimSpace(pack.BreaksIfMishandled) == "" {
		return Pack{}, fmt.Errorf("integrationfixtures: pack %q must document its concern and what breaks", name)
	}
	return pack, nil
}

// Model decodes only the financial-model section, for harnesses that apply
// their own setup around it (the browser reset route uses this).
func Model(name string) (*types.FinancialModel, error) {
	pack, err := Load(name)
	if err != nil {
		return nil, err
	}
	model := pack.Model
	return &model, nil
}

// SeedUser provisions one synthetic user on a throwaway database and seeds
// the pack's model rows through ImportModel, which replaces content the
// same way the browser harness reseed does. Callers must use throwaway
// databases: seeding replaces the user's model.
func SeedUser(db store.Database, issuer, subject, name string) (store.Store, Pack, error) {
	pack, err := Load(name)
	if err != nil {
		return nil, Pack{}, err
	}
	user, err := db.EnsureGroupUser(issuer, subject)
	if err != nil {
		return nil, Pack{}, fmt.Errorf("integrationfixtures: ensure group user: %w", err)
	}
	scoped, err := db.EnsureUser(user, issuer, subject)
	if err != nil {
		return nil, Pack{}, fmt.Errorf("integrationfixtures: ensure user: %w", err)
	}
	model := pack.Model
	if _, err := scoped.ImportModel(&model); err != nil {
		return nil, Pack{}, fmt.Errorf("integrationfixtures: seed pack %q: %w", name, err)
	}
	return scoped, pack, nil
}
