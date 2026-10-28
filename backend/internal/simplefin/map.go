package simplefin

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// SkipReason counts rows the mapper deliberately drops.
type SkipReason string

const (
	SkipUnmappedAccount SkipReason = "unmapped-account"
	SkipNonUSD          SkipReason = "non-usd"
	SkipBadAmount       SkipReason = "bad-amount"
	// SkipStaleLink counts bridge accounts whose link points at a
	// deleted model account. Nothing is written for them; the link
	// stays for relinking.
	SkipStaleLink SkipReason = "linked-account-missing"
)

// Checkpoint is a balance observation for one model account and day.
// BridgeID carries the source account; AccountID is empty when the bridge
// account has no resolved model account yet (the runner provisions one,
// then fills it in before apply).
type Checkpoint struct {
	AccountID string
	BridgeID  string
	Date      string
	Balance   float64
}

// Provision asks the store to create a model account plus an auto link
// for an unmapped bridge account.
type Provision struct {
	BridgeID string
	Name     string
	Currency string
	Kind     string
}

// Plan is the mapped sync output before applying. Pending holds pending
// authorizations; Settled holds posted charges. The reconciler converts a
// vanished pending row on a unique strict posted match, voids it otherwise,
// and inserts unmatched posted charges as new rows; void rows never
// suppress an insert.
type Plan struct {
	Checkpoints []Checkpoint
	Pending     []store.SyncPosting
	Settled     []store.SyncPosting
	Provisions  []Provision
	Skipped     map[SkipReason]int
}

// parseBalance parses a bridge balance decimal.
func parseBalance(raw string) (float64, error) {
	return strconv.ParseFloat(strings.TrimSpace(raw), 64)
}

// absDecimal returns the absolute decimal value without float formatting.
func absDecimal(raw string) (string, error) {
	digits := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(raw), "+"), "-")
	if digits == "" {
		return "", fmt.Errorf("empty amount")
	}
	value, err := strconv.ParseFloat(digits, 64)
	if err != nil {
		return "", err
	}
	if value == 0 {
		return "0", nil
	}
	return digits, nil
}

func checkpointDay(balanceDate int64, now time.Time) string {
	if balanceDate > 0 {
		return time.Unix(balanceDate, 0).UTC().Format("2006-01-02")
	}
	return now.UTC().Format("2006-01-02")
}

// provisionKind picks the model account kind for an auto-provisioned
// account: investment when the bridge reports holdings, cash otherwise.
// Card (debt) status is model-side configuration; a provisioned account
// becomes card-eligible once linked and added to the card set.
func provisionKind(account Account) string {
	if len(account.Holdings) > 0 {
		return "investment"
	}
	return "cash"
}

func truncateLabel(description string) string {
	name := strings.TrimSpace(description)
	if name == "" {
		return "Pending card charge"
	}
	runes := []rune(name)
	if len(runes) > 80 {
		return string(runes[:80])
	}
	return name
}

// Map converts an account set into checkpoints plus bank mirror rows.
// Every mapped USD account contributes its transactions: pending ones seed
// pending rows, posted ones become settled candidates. Charges, payments,
// and refunds all mirror; only unmapped accounts, non-USD rows, and invalid
// amounts are skipped, as are checking flows outside mapped accounts.
func Map(set *AccountSet, resolved map[string]string, now time.Time) (*Plan, error) {
	plan := &Plan{Skipped: map[SkipReason]int{}}
	seenCheckpoints := map[string]struct{}{}
	for _, account := range set.Accounts {
		modelAccountID, mapped := resolved[account.ID]
		if !mapped {
			if account.Currency != "" && account.Currency != "USD" {
				plan.Skipped[SkipNonUSD] += len(account.Transactions) + 1
				continue
			}
			if _, err := parseBalance(account.Balance); err != nil {
				plan.Skipped[SkipBadAmount]++
				continue
			}
			plan.Skipped[SkipUnmappedAccount] += len(account.Transactions) + 1
			plan.Provisions = append(plan.Provisions, Provision{
				BridgeID: account.ID,
				Name:     account.Name,
				Currency: account.Currency,
				Kind:     provisionKind(account),
			})
			day := checkpointDay(account.BalanceDate, now)
			key := account.ID + "\x00" + day
			if _, seen := seenCheckpoints[key]; !seen {
				seenCheckpoints[key] = struct{}{}
				balance, _ := parseBalance(account.Balance)
				plan.Checkpoints = append(plan.Checkpoints, Checkpoint{BridgeID: account.ID, Date: day, Balance: balance})
			}
			continue
		}
		if account.Currency != "" && account.Currency != "USD" {
			plan.Skipped[SkipNonUSD] += len(account.Transactions) + 1
			continue
		}
		balance, err := parseBalance(account.Balance)
		if err != nil {
			plan.Skipped[SkipBadAmount]++
			continue
		}
		day := checkpointDay(account.BalanceDate, now)
		key := modelAccountID + "\x00" + day
		if _, seen := seenCheckpoints[key]; !seen {
			seenCheckpoints[key] = struct{}{}
			plan.Checkpoints = append(plan.Checkpoints, Checkpoint{AccountID: modelAccountID, BridgeID: account.ID, Date: day, Balance: balance})
		}

		for _, transaction := range account.Transactions {
			seed := transaction.IsPending()
			amount, err := transaction.ParseAmount()
			if err != nil {
				plan.Skipped[SkipBadAmount]++
				continue
			}
			abs, err := absDecimal(transaction.Amount)
			if err != nil {
				plan.Skipped[SkipBadAmount]++
				continue
			}
			source := modelAccountID
			postedTime := transaction.Posted
			if postedTime <= 0 {
				postedTime = now.Unix()
			}
			transactionTime := postedTime
			if transaction.TransactedAt != nil && *transaction.TransactedAt > 0 {
				transactionTime = *transaction.TransactedAt
			}
			posting := store.SyncPosting{
				ProviderAccountID: account.ID,
				TransactionID:     transaction.ID,
				Posting: types.Posting{
					Name:   truncateLabel(transaction.Description),
					Source: store.SourceSimpleFIN,
					Amount: types.PostingAmountResolution{
						Resolver: "expression",
						Config:   map[string]any{"expression": abs},
						Inputs:   map[string]types.AmountInputBinding{},
					},
					PostedTime:      postedTime,
					TransactionTime: transactionTime,
					Enabled:         false,
					Pending:         seed,
				},
			}
			if amount >= 0 {
				posting.Destinations = []string{modelAccountID}
			} else {
				posting.SourceAccountID = &source
			}
			if seed {
				plan.Pending = append(plan.Pending, posting)
			} else {
				plan.Settled = append(plan.Settled, posting)
			}
		}
	}
	return plan, nil
}
