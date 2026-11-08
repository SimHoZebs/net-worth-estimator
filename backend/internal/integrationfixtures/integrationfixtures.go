// Package integrationfixtures loads versioned synthetic integration fixture packs.
//
// Packs live under backend/testdata/integration/v1, one concern per file, and are
// synthetic by construction: no production rows, no real credentials, no
// real counterparties. A pack is an ordered sequence of seeds. The loader
// applies the model and safe-spending settings seeds; harness-specific seeds
// (bank feeds, sharing scripts, invite scripts, split probes, sync state, and
// ledger expectations) are exposed to the harnesses that drive those paths.
package integrationfixtures

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Pack names, one per concern. The list is the contract the integration
// matrix runner's --pack flag and matrix accept.
const (
	PackPennyZero             = "penny-zero"
	PackCurrencies            = "currencies"
	PackDuplicates            = "duplicates"
	PackLifecycle             = "lifecycle"
	PackTimezones             = "timezones"
	PackUnicode               = "unicode"
	PackOverlong              = "overlong"
	PackRecurring             = "recurring"
	PackTransfers             = "transfers"
	PackBackdated             = "backdated"
	PackCursors               = "cursors"
	PackMissingData           = "missing-data"
	PackRevocation            = "revocation"
	PackInvites               = "invites"
	PackExclusions            = "exclusions"
	PackLedger                = "ledger"
	PackNegativeNetWorth      = "negative-net-worth"
	PackSafeSpending          = "safe-spending"
	PackSafeSpendingShortfall = "safe-spending-shortfall"
	PackBaseline              = "baseline"
)

// PackVersion is the only fixture format this loader reads. A format change
// mints a new version alongside; loaders never migrate old packs in place.
const PackVersion = 2

// Seed kinds. A pack is an ordered sequence of these operations. Model and
// settings are applied by Apply; the remaining kinds are harness data that
// the owning suite consumes directly.
const (
	SeedKindModel          = "model"
	SeedKindSettings       = "settings"
	SeedKindSyncState      = "syncState"
	SeedKindSharingScript  = "sharingScript"
	SeedKindInviteScript   = "inviteScript"
	SeedKindSplitProbes    = "splitProbes"
	SeedKindBankFeeds      = "bankFeeds"
	SeedKindLedgerExpected = "ledgerExpected"
)

// Pack is one decoded fixture file.
type Pack struct {
	Name               string `json:"pack"`
	Version            int    `json:"version"`
	Concern            string `json:"concern"`
	BreaksIfMishandled string `json:"breaksIfMishandled"`
	Seeds              []Seed `json:"seeds"`
}

// Seed is one operation in a pack. Kind selects the populated field.
type Seed struct {
	Kind string `json:"kind"`
	// Model replaces the user's financial model. AnchorDate names the
	// scenario day for manual demos; test harnesses ignore it.
	Model      *types.FinancialModel       `json:"model,omitempty"`
	AnchorDate string                      `json:"anchorDate,omitempty"`
	Settings   *types.SafeSpendingSettings `json:"settings,omitempty"`
	// SyncState pins sync cursors to stale positions.
	SyncState *SyncState `json:"syncState,omitempty"`
	// SharingScript is an ordered run of grants, exclusions, revocations,
	// and re-grants.
	SharingScript []SharingStep `json:"sharingScript,omitempty"`
	// InviteScript describes invites at their limits.
	InviteScript []InviteStep `json:"inviteScript,omitempty"`
	// SplitProbes are remainder-theft probes for the edge-case suite.
	SplitProbes []SplitProbe `json:"splitProbes,omitempty"`
	// BankFeeds is an ordered run of bank states for the completeness
	// ledger: each feed applies through the real sync reconcile in order,
	// so rows can settle, stay pending, vanish into voids, and re-sync
	// as a no-op. Only the ledger pack uses it.
	BankFeeds [][]BankRowSeed `json:"bankFeeds,omitempty"`
	// LedgerExpected records the hand-computed numbers every completeness
	// spec asserts against the ledger seed. Only the ledger pack sets it.
	LedgerExpected *LedgerExpected `json:"ledgerExpected,omitempty"`
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
	Action        string `json:"action"`
	AudienceType  string `json:"audienceType"`
	AudienceID    string `json:"audienceId"`
	TransactionID string `json:"transactionId"`
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
	// Listed transactions after the phantom deletion: 16 seeded plus 9 bank
	// rows present (4 groceries, fuel, outlet, corner, pending eats,
	// voided mart).
	ListedTransactions int `json:"listedTransactions"`
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

func (s Seed) validate() error {
	switch s.Kind {
	case SeedKindModel:
		if s.Model == nil {
			return fmt.Errorf("model seed has no model")
		}
		if s.AnchorDate != "" {
			if _, err := time.Parse("2006-01-02", s.AnchorDate); err != nil {
				return fmt.Errorf("model anchor date %q is not a date", s.AnchorDate)
			}
		}
	case SeedKindSettings:
		if s.Settings == nil {
			return fmt.Errorf("settings seed has no settings")
		}
	case SeedKindSyncState:
		if s.SyncState == nil {
			return fmt.Errorf("syncState seed has no state")
		}
	case SeedKindSharingScript:
		if len(s.SharingScript) == 0 {
			return fmt.Errorf("sharingScript seed has no steps")
		}
	case SeedKindInviteScript:
		if len(s.InviteScript) == 0 {
			return fmt.Errorf("inviteScript seed has no steps")
		}
	case SeedKindSplitProbes:
		if len(s.SplitProbes) == 0 {
			return fmt.Errorf("splitProbes seed has no probes")
		}
	case SeedKindBankFeeds:
		if len(s.BankFeeds) == 0 {
			return fmt.Errorf("bankFeeds seed has no feeds")
		}
	case SeedKindLedgerExpected:
		if s.LedgerExpected == nil {
			return fmt.Errorf("ledgerExpected seed has no expectations")
		}
	default:
		return fmt.Errorf("unknown seed kind %q", s.Kind)
	}
	return nil
}

func (p Pack) validate() error {
	if p.Version != PackVersion {
		return fmt.Errorf("pack %q version %d, loader reads %d", p.Name, p.Version, PackVersion)
	}
	if strings.TrimSpace(p.Concern) == "" || strings.TrimSpace(p.BreaksIfMishandled) == "" {
		return fmt.Errorf("pack %q must document its concern and what breaks", p.Name)
	}
	if len(p.Seeds) == 0 {
		return fmt.Errorf("pack %q has no seeds", p.Name)
	}
	modelSeen, settingsSeen := false, false
	for index, seed := range p.Seeds {
		if err := seed.validate(); err != nil {
			return fmt.Errorf("pack %q seed %d: %w", p.Name, index, err)
		}
		switch seed.Kind {
		case SeedKindModel:
			if modelSeen {
				return fmt.Errorf("pack %q has more than one model seed", p.Name)
			}
			modelSeen = true
		case SeedKindSettings:
			if settingsSeen {
				return fmt.Errorf("pack %q has more than one settings seed", p.Name)
			}
			if !modelSeen {
				return fmt.Errorf("pack %q settings seed must follow the model seed", p.Name)
			}
			settingsSeen = true
		}
	}
	if !modelSeen {
		return fmt.Errorf("pack %q has no model seed", p.Name)
	}
	return nil
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

// Load decodes one pack and checks its version envelope and seed sequence.
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
	if err := pack.validate(); err != nil {
		return Pack{}, fmt.Errorf("integrationfixtures: %w", err)
	}
	return pack, nil
}

// Model decodes only the model seed, for harnesses that apply their own
// setup around it.
func Model(name string) (*types.FinancialModel, error) {
	pack, err := Load(name)
	if err != nil {
		return nil, err
	}
	model, ok := pack.Model()
	if !ok {
		return nil, fmt.Errorf("integrationfixtures: pack %q has no model seed", name)
	}
	copy := *model
	return &copy, nil
}

// Model returns the pack's model seed.
func (p Pack) Model() (*types.FinancialModel, bool) {
	for _, seed := range p.Seeds {
		if seed.Kind == SeedKindModel && seed.Model != nil {
			return seed.Model, true
		}
	}
	return nil, false
}

// AnchorDate returns the model seed's demo anchor, if set.
func (p Pack) AnchorDate() string {
	for _, seed := range p.Seeds {
		if seed.Kind == SeedKindModel {
			return seed.AnchorDate
		}
	}
	return ""
}

// Settings returns the safe-spending settings seed, if present.
func (p Pack) Settings() (*types.SafeSpendingSettings, bool) {
	for _, seed := range p.Seeds {
		if seed.Kind == SeedKindSettings && seed.Settings != nil {
			return seed.Settings, true
		}
	}
	return nil, false
}

// SyncState returns the sync-state seed, if present.
func (p Pack) SyncState() *SyncState {
	for _, seed := range p.Seeds {
		if seed.Kind == SeedKindSyncState {
			return seed.SyncState
		}
	}
	return nil
}

// SharingScript returns the sharing steps seed, if present.
func (p Pack) SharingScript() []SharingStep {
	for _, seed := range p.Seeds {
		if seed.Kind == SeedKindSharingScript {
			return seed.SharingScript
		}
	}
	return nil
}

// InviteScript returns the invite steps seed, if present.
func (p Pack) InviteScript() []InviteStep {
	for _, seed := range p.Seeds {
		if seed.Kind == SeedKindInviteScript {
			return seed.InviteScript
		}
	}
	return nil
}

// SplitProbes returns the split probes seed, if present.
func (p Pack) SplitProbes() []SplitProbe {
	for _, seed := range p.Seeds {
		if seed.Kind == SeedKindSplitProbes {
			return seed.SplitProbes
		}
	}
	return nil
}

// BankFeeds returns the bank feeds seed, if present.
func (p Pack) BankFeeds() [][]BankRowSeed {
	for _, seed := range p.Seeds {
		if seed.Kind == SeedKindBankFeeds {
			return seed.BankFeeds
		}
	}
	return nil
}

// LedgerExpected returns the ledger expectations seed, if present.
func (p Pack) LedgerExpected() *LedgerExpected {
	for _, seed := range p.Seeds {
		if seed.Kind == SeedKindLedgerExpected {
			return seed.LedgerExpected
		}
	}
	return nil
}

// Apply runs the seeds that mutate the user's saved state. Harness-specific
// seeds are intentionally not applied here; their owning suites read them
// through the typed accessors above.
func Apply(scoped store.Store, pack Pack) error {
	for _, seed := range pack.Seeds {
		switch seed.Kind {
		case SeedKindModel:
			model := *seed.Model
			if _, err := scoped.ImportModel(&model); err != nil {
				return fmt.Errorf("integrationfixtures: seed model: %w", err)
			}
		case SeedKindSettings:
			if err := scoped.SetSafeSpendingSettings(*seed.Settings); err != nil {
				return fmt.Errorf("integrationfixtures: seed safe-spending settings: %w", err)
			}
		}
	}
	return nil
}

// SeedUser provisions one synthetic user on a throwaway database and applies
// the pack's state seeds through ImportModel and SetSafeSpendingSettings,
// which replace content the same way the browser harness reseed does. Callers
// must use throwaway databases: seeding replaces the user's model.
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
	if err := Apply(scoped, pack); err != nil {
		return nil, Pack{}, fmt.Errorf("integrationfixtures: seed pack %q: %w", name, err)
	}
	return scoped, pack, nil
}
