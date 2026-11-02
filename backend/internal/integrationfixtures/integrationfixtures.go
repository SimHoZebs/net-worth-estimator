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
	PackLedger      = "ledger"
	PackUnderwater  = "underwater"
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
	// BankFeeds is an ordered run of bank states for the completeness
	// ledger: each feed applies through the real sync reconcile in order,
	// so rows can settle, stay pending, vanish into voids, and re-sync
	// as a no-op. Only the ledger pack uses it.
	BankFeeds [][]BankRowSeed `json:"bankFeeds,omitempty"`
	// LedgerExpected records the hand-computed numbers every completeness
	// spec asserts against the ledger seed. Only the ledger pack sets it.
	LedgerExpected *LedgerExpected `json:"ledgerExpected,omitempty"`
}

// SyncLifecycle describes bank rows applied through the real sync apply
// path: pending inserts first, then settled conversions and void flips.
// It has no consumers: packs needing ordered multi-feed runs (settle,
// pending holds, vanish-to-void, no-op re-sync) use BankFeeds instead.
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
	// Pending marks authorizations that have not posted. Absent means
	// settled. Only the ledger pack's bank feeds use it.
	Pending bool `json:"pending,omitempty"`
	// TransactedAt carries the bridge purchase timestamp for pending
	// rows; without it the event times at arrival. Only the ledger pack
	// uses it.
	TransactedAt *int64 `json:"transactedAt,omitempty"`
}

// LedgerExpected records the hand-computed numbers every completeness
// spec asserts against the ledger seed: window sums over settled rows,
// the rows each surface must show, the detection the ledger must
// propose, and the exact shares the currency probes must allocate.
// Seed rows beside them (see the ledger pack): paycheck 3000 x4 plus
// refund 45.50 in; rent 1200 x4, groceries 150 x4, bookshop 42.50,
// fuel/outlet/corner 150 x3, cafe 75, clothes 125 out; payoff 500 x4 as
// transfers counted once. Pending, void, and deleted rows move nothing
// and stay out of the diagram.
// Two engine rules shape the diagram sums, verified by probe: the engine
// rounds every event to whole dollars (bookshop 42.50 counts 43, refund
// 45.50 counts 46), and rows dated exactly on the projection start fall
// into history instead of events — so specs project from ProjectionStart
// (strictly before every seed row) and the list (exact expressions) and
// the diagram (rounded) assert their own true numbers side by side.
type LedgerExpected struct {
	WindowStart string `json:"windowStart"`
	WindowEnd   string `json:"windowEnd"`
	// ProjectionStart is the forecast start every diagram spec uses: the
	// checkpoint day, strictly before the first seed row.
	ProjectionStart string `json:"projectionStart"`
	// Full-window sums over settled non-void rows.
	InflowTotal   float64 `json:"inflowTotal"`
	OutflowTotal  float64 `json:"outflowTotal"`
	TransferTotal float64 `json:"transferTotal"`
	// Settled edge rows in the full window: 4 paycheck, 1 refund, 4 rent,
	// 4 groceries, 1 bookshop, 1 fuel, 1 outlet, 1 corner, 1 cafe,
	// 1 clothes, 4 payoff.
	EdgeRows int `json:"edgeRows"`
	// Listed postings after the phantom deletion: 16 seeded plus 9 bank
	// rows present (4 groceries, fuel, outlet, corner, pending eats,
	// voided mart).
	ListedPostings int `json:"listedPostings"`
	// Narrowed-window (January through March) drops April: paycheck, rent,
	// groceries, corner, clothes, and payoff rows with their sums.
	NarrowStart string  `json:"narrowStart"`
	NarrowEnd   string  `json:"narrowEnd"`
	NarrowIn    float64 `json:"narrowIn"`
	NarrowOut   float64 `json:"narrowOut"`
	NarrowXfer  float64 `json:"narrowXfer"`
	// Detection the ledger must propose: merchant key, cadence, amount,
	// and occurrence count over the four grocery rows.
	DetectMerchant string  `json:"detectMerchant"`
	DetectCadence  string  `json:"detectCadence"`
	DetectAmount   float64 `json:"detectAmount"`
	DetectCount    int     `json:"detectCount"`
	// Exact shares the yen probe must allocate: 1000 minor over 3 with
	// the remainder to the initiator.
	JPYTotal  int64   `json:"jpyTotal"`
	JPYParts  int     `json:"jpyParts"`
	JPYShares []int64 `json:"jpyShares"`
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
