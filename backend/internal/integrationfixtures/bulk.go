// Bulk seed support for development and test harnesses.
//
// The bulk builder creates additive synthetic rows tagged with a fixed ID
// prefix. Inject adds rows beside existing data. Clear removes only tagged
// rows and leaves every other row intact. Replace flows (browser reseed,
// pack seeding) keep using ImportModel; additive flows (dev seed, bulk on
// top of a pack) use Inject and Clear here.
package integrationfixtures

import (
	"fmt"
	"math/rand"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// SeedPrefix tags every bulk account. Real accounts never carry it. Postings
// and rules need store UUIDs, so they carry deterministic UUIDs and link to
// a tagged account instead. Clear matches tagged accounts first, then drops
// every posting and rule tied to those accounts, so no bulk row survives and
// no real row is touched.
const SeedPrefix = "seed-"

// Bulk limits keep one command from accidentally building a stress corpus.
// Larger walks compose through repeated injects with distinct seeds, since
// every bulk ID scopes by seed, or through matrix repetition.
const (
	BulkMaxAccounts              = 100
	BulkMaxPostingsPerAcct       = 1000
	BulkMaxTotalPostings         = 20000
	BulkDefaultSeed        int64 = 7
)

// BulkSpec selects the bulk shape: accounts with postings each.
type BulkSpec struct {
	Accounts           int
	PostingsPerAccount int
	Seed               int64
}

// BulkResult counts rows an inject or clear touched.
type BulkResult struct {
	Accounts int
	Postings int
	Rules    int
}

// ParseBulkSpec decodes "20x200" or "20x200:7". Empty means no bulk.
// The seed after the colon is optional and defaults when absent.
func ParseBulkSpec(raw string) (BulkSpec, error) {
	spec := BulkSpec{}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return spec, nil
	}
	seed := BulkDefaultSeed
	rest := trimmed
	if head, tail, ok := strings.Cut(trimmed, ":"); ok {
		rest = strings.TrimSpace(head)
		parsed, err := strconv.ParseInt(strings.TrimSpace(tail), 10, 64)
		if err != nil {
			return spec, fmt.Errorf("integrationfixtures: bulk seed %q is not an integer", tail)
		}
		seed = parsed
	}
	parts := strings.SplitN(rest, "x", 2)
	if len(parts) != 2 {
		return spec, fmt.Errorf("integrationfixtures: bulk %q wants NxM like 20x200", raw)
	}
	accounts, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil || accounts < 1 || accounts > BulkMaxAccounts {
		return spec, fmt.Errorf("integrationfixtures: bulk accounts %q wants 1-%d", parts[0], BulkMaxAccounts)
	}
	perAccount, err := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err != nil || perAccount < 0 || perAccount > BulkMaxPostingsPerAcct {
		return spec, fmt.Errorf("integrationfixtures: bulk postings %q wants 0-%d", parts[1], BulkMaxPostingsPerAcct)
	}
	if accounts*perAccount > BulkMaxTotalPostings {
		return spec, fmt.Errorf("integrationfixtures: bulk %dx%d exceeds %d postings", accounts, perAccount, BulkMaxTotalPostings)
	}
	spec.Accounts = accounts
	spec.PostingsPerAccount = perAccount
	spec.Seed = seed
	return spec, nil
}

// bulkDay returns a deterministic transaction day that cycles through edge
// shapes: UTC midnight, month edges, a leap day, and plain mid-month days.
func bulkDay(rng *rand.Rand, index int) int64 {
	base := time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC).Unix()
	switch index % 8 {
	case 0:
		return time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC).Unix()
	case 1:
		return time.Date(2026, time.January, 31, 23, 59, 59, 0, time.UTC).Unix()
	case 2:
		return time.Date(2024, time.February, 29, 12, 0, 0, 0, time.UTC).Unix()
	case 3:
		return time.Date(2026, time.December, 31, 23, 59, 59, 0, time.UTC).Unix()
	default:
		return base + int64(rng.Intn(330))*86400
	}
}

var bulkAmounts = []string{"0.01", "0.005", "1500", "2.345", "19.99", "250.00", "42.50", "0.00"}

var bulkNameTraits = []string{
	"Seed coffee",
	"Café ☕ groceries",
	"Tokyo出張 lunch",
	"é combining market",
	"عشاء RTL dinner",
	"Seed fuel",
	"Seed rent",
	"Seed refund",
}

// bulkAccountID scopes one account index by seed so repeated injects with
// distinct seeds never reclaim the same row. The seed prefix stays first
// so Clear keeps matching on it exactly.
func bulkAccountID(seed int64, index int) string {
	return fmt.Sprintf("%sacct-%d-%04d", SeedPrefix, seed, index)
}

// bulkScheduleID scopes one rule index by seed for the same reason.
func bulkScheduleID(seed int64, index int) string {
	return fmt.Sprintf("%srule-%d-%04d", SeedPrefix, seed, index)
}

// bulkPostingID renders the deterministic UUID for one bulk posting. The
// store requires posting IDs to parse as UUIDs, so the seed tag travels on
// the linked account instead of the posting ID.
func bulkPostingID(seed int64, account, index int) string {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte(fmt.Sprintf("seed-bulk-%d-%d-%d", seed, account, index))).String()
}

func ptr(s string) *string {
	out := s
	return &out
}

// BuildBulkModel renders the deterministic bulk model for one spec. Account
// IDs carry the seed prefix so Clear can match them exactly. Postings carry
// deterministic UUIDs and link to their tagged account.
func BuildBulkModel(spec BulkSpec) *types.FinancialModel {
	rng := rand.New(rand.NewSource(spec.Seed))
	model := &types.FinancialModel{}
	for i := 0; i < spec.Accounts; i++ {
		accountID := bulkAccountID(spec.Seed, i)
		name := fmt.Sprintf("%s %02d", bulkNameTraits[i%len(bulkNameTraits)], i)
		if i%8 == 7 {
			name = fmt.Sprintf("%s %s", name, strings.Repeat("é", 40))
		}
		model.Accounts = append(model.Accounts, types.Account{
			ID:      accountID,
			Name:    name,
			Kind:    types.AccountKindCash,
			Enabled: true,
		})
		model.Checkpoints = append(model.Checkpoints, types.Checkpoint{
			AccountID:  accountID,
			Balance:    float64(1000 + rng.Intn(9000)),
			Source:     "user",
			ObservedAt: time.Date(2026, time.January, 1, 12, 0, 0, 0, time.UTC).Unix() + int64(i*86400),
		})
		for j := 0; j < spec.PostingsPerAccount; j++ {
			stamp := bulkDay(rng, i+j)
			amount := bulkAmounts[(i+j)%len(bulkAmounts)]
			// Duplicate names across days exercise name-plus-amount
			// grouping without collapsing distinct days.
			postingName := fmt.Sprintf("%s acct-%02d", bulkNameTraits[(i+j)%len(bulkNameTraits)], i)
			model.Postings = append(model.Postings, types.Posting{
				ID:              bulkPostingID(spec.Seed, i, j),
				Name:            postingName,
				SourceAccountID: ptr(accountID),
				Amount: types.PostingAmountResolution{
					Resolver: "expression",
					Config:   map[string]any{"expression": amount},
					Inputs:   map[string]types.AmountInputBinding{},
				},
				PostedTime:      stamp,
				TransactionTime: stamp,
				Enabled:         true,
			})
		}
		if i%4 == 0 {
			model.Schedules = append(model.Schedules, types.Schedule{
				ID:              bulkScheduleID(spec.Seed, i),
				Name:            fmt.Sprintf("Seed rule %02d", i),
				SourceAccountID: ptr(accountID),
				Frequency:       types.FrequencyMonthly,
				Amount: types.PostingAmountResolution{
					Resolver: "expression",
					Config:   map[string]any{"expression": "250.00"},
					Inputs:   map[string]types.AmountInputBinding{},
				},
				StartDate: "2026-01-01",
				Enabled:   true,
			})
		}
	}
	return model
}

// InjectBulk adds one bulk model beside existing rows. It never replaces.
func InjectBulk(scoped store.Store, spec BulkSpec) (BulkResult, error) {
	var result BulkResult
	if spec.Accounts == 0 {
		return result, nil
	}
	model := BuildBulkModel(spec)
	for _, account := range model.Accounts {
		if _, err := scoped.CreateAccount(account); err != nil {
			return result, fmt.Errorf("integrationfixtures: bulk create account %q: %w", account.ID, err)
		}
		result.Accounts++
	}
	for _, checkpoint := range model.Checkpoints {
		if _, err := scoped.SaveCheckpoint(checkpoint); err != nil {
			return result, fmt.Errorf("integrationfixtures: bulk checkpoint %q: %w", checkpoint.AccountID, err)
		}
	}
	for _, rule := range model.Schedules {
		if _, err := scoped.CreateSchedule(rule); err != nil {
			return result, fmt.Errorf("integrationfixtures: bulk create rule %q: %w", rule.ID, err)
		}
		result.Rules++
	}
	for _, posting := range model.Postings {
		if _, err := scoped.CreatePosting(posting); err != nil {
			return result, fmt.Errorf("integrationfixtures: bulk create posting %q: %w", posting.ID, err)
		}
		result.Postings++
	}
	return result, nil
}

// ClearSeed removes only bulk rows. It matches tagged accounts by prefix,
// then drops every posting and rule tied to those accounts, then the
// checkpoints and the accounts themselves. Real rows stay untouched.
// Postings and rules go before accounts so row references never dangle.
func ClearSeed(scoped store.Store) (BulkResult, error) {
	var result BulkResult
	model, err := scoped.LoadModel()
	if err != nil {
		return result, fmt.Errorf("integrationfixtures: clear seed read: %w", err)
	}
	seedAccounts := map[string]bool{}
	for _, account := range model.Accounts {
		if strings.HasPrefix(account.ID, SeedPrefix) {
			seedAccounts[account.ID] = true
		}
	}
	if len(seedAccounts) == 0 {
		return result, nil
	}
	for _, posting := range model.Postings {
		if posting.SourceAccountID == nil || !seedAccounts[*posting.SourceAccountID] {
			continue
		}
		if err := scoped.DeletePosting(posting.ID); err != nil {
			return result, fmt.Errorf("integrationfixtures: clear seed posting %q: %w", posting.ID, err)
		}
		result.Postings++
	}
	for _, rule := range model.Schedules {
		if rule.SourceAccountID == nil || !seedAccounts[*rule.SourceAccountID] {
			continue
		}
		if err := scoped.DeleteSchedule(rule.ID); err != nil {
			return result, fmt.Errorf("integrationfixtures: clear seed rule %q: %w", rule.ID, err)
		}
		result.Rules++
	}
	for _, checkpoint := range model.Checkpoints {
		if !seedAccounts[checkpoint.AccountID] {
			continue
		}
		if err := scoped.DeleteCheckpointAt(checkpoint.AccountID, checkpoint.ObservedAt); err != nil {
			return result, fmt.Errorf("integrationfixtures: clear seed checkpoint %q: %w", checkpoint.AccountID, err)
		}
	}
	for id := range seedAccounts {
		if err := scoped.DeleteAccount(id); err != nil {
			return result, fmt.Errorf("integrationfixtures: clear seed account %q: %w", id, err)
		}
		result.Accounts++
	}
	return result, nil
}
