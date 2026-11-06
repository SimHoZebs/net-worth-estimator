package simplefin

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// SkipReason counts rows the translation deliberately drops.
type SkipReason string

const (
	SkipUnmappedAccount SkipReason = "unmapped-account"
	SkipNonUSD          SkipReason = "non-usd"
	SkipBadAmount       SkipReason = "bad-amount"
	// SkipProviderError counts rows omitted because the Bridge reported a
	// connection- or account-scoped error for them.
	SkipProviderError SkipReason = "provider-error"
	// SkipStaleLink counts bridge accounts whose link points at a
	// deleted model account. Nothing is written for them; the link
	// stays for relinking.
	SkipStaleLink SkipReason = "linked-account-missing"
)

// Checkpoint is a balance observation for one model account.
// BridgeID carries the canonical source account key; AccountID is empty when
// the bridge account has no resolved model account (the runner drops those
// before apply). AvailableBalance is the Bridge's available balance when it
// reported one, kept separate from the posted balance. ObservedAt is the
// required exact Unix instant; a missing bridge balance-date falls back to
// arrival time.
type Checkpoint struct {
	AccountID        string
	BridgeID         string
	Balance          float64
	AvailableBalance *float64
	ObservedAt       int64
}

// Translation is one sync run's output before applying. Pending holds pending
// authorizations; Settled holds posted charges. The reconciler voids a
// vanished pending hold and inserts unmatched posted charges as new rows;
// void rows never suppress an insert.
type Translation struct {
	Checkpoints []Checkpoint
	Pending     []store.SyncTransaction
	Settled     []store.SyncTransaction
	Skipped     map[SkipReason]int
}

// parseBalance parses a bridge balance decimal.
func parseBalance(raw string) (float64, error) {
	return strconv.ParseFloat(strings.TrimSpace(raw), 64)
}

// parseAvailableBalance keeps an absent or invalid available balance as
// unknown. It never fails the account's posted balance observation.
func parseAvailableBalance(raw *string) *float64 {
	if raw == nil {
		return nil
	}
	value, err := parseBalance(*raw)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return nil
	}
	return &value
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

// checkpointInstant preserves the bridge balance-date instant: the exact
// Unix time the balance became that amount. A missing balance-date falls
// back to the arrival time, which is the earliest the balance is known.
func checkpointInstant(balanceDate int64, now time.Time) int64 {
	if balanceDate > 0 {
		return balanceDate
	}
	return now.Unix()
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

// Translate converts an account set into checkpoints plus bank mirror rows.
// Every mapped USD account contributes its transactions: pending ones seed
// pending rows, posted ones become settled candidates. Charges, payments,
// and refunds all mirror; only unmapped accounts, non-USD rows, and invalid
// amounts are skipped, as are checking flows outside mapped accounts.
func Translate(set *AccountSet, resolved map[string]string, now time.Time) (*Translation, error) {
	translation := &Translation{Skipped: map[SkipReason]int{}}
	seenCheckpoints := map[string]struct{}{}
	exclusions := set.Exclusions()
	for _, account := range set.Accounts {
		bridgeID := AccountKey(account.ConnID, account.ID)
		if exclusions.Excluded(account.ConnID, account.ID) {
			translation.Skipped[SkipProviderError] += len(account.Transactions) + 1
			continue
		}
		modelAccountID, mapped := resolved[bridgeID]
		if !mapped {
			if account.Currency != "" && account.Currency != "USD" {
				translation.Skipped[SkipNonUSD] += len(account.Transactions) + 1
				continue
			}
			if _, err := parseBalance(account.Balance); err != nil {
				translation.Skipped[SkipBadAmount]++
				continue
			}
			translation.Skipped[SkipUnmappedAccount] += len(account.Transactions) + 1
			instant := checkpointInstant(account.BalanceDate, now)
			key := bridgeID + "\x00" + strconv.FormatInt(instant, 10)
			if _, seen := seenCheckpoints[key]; !seen {
				seenCheckpoints[key] = struct{}{}
				balance, _ := parseBalance(account.Balance)
				translation.Checkpoints = append(translation.Checkpoints, Checkpoint{BridgeID: bridgeID, Balance: balance, AvailableBalance: parseAvailableBalance(account.AvailableBalance), ObservedAt: instant})
			}
			continue
		}
		if account.Currency != "" && account.Currency != "USD" {
			translation.Skipped[SkipNonUSD] += len(account.Transactions) + 1
			continue
		}
		balance, err := parseBalance(account.Balance)
		if err != nil {
			translation.Skipped[SkipBadAmount]++
			continue
		}
		instant := checkpointInstant(account.BalanceDate, now)
		key := modelAccountID + "\x00" + strconv.FormatInt(instant, 10)
		if _, seen := seenCheckpoints[key]; !seen {
			seenCheckpoints[key] = struct{}{}
			translation.Checkpoints = append(translation.Checkpoints, Checkpoint{AccountID: modelAccountID, BridgeID: bridgeID, Balance: balance, AvailableBalance: parseAvailableBalance(account.AvailableBalance), ObservedAt: instant})
		}

		for _, transaction := range account.Transactions {
			seed := transaction.IsPending()
			amount, err := transaction.ParseAmount()
			if err != nil {
				translation.Skipped[SkipBadAmount]++
				continue
			}
			abs, err := absDecimal(transaction.Amount)
			if err != nil {
				translation.Skipped[SkipBadAmount]++
				continue
			}
			source := modelAccountID
			postedTime := transaction.Posted
			transactionTime := postedTime
			if seed {
				// Pending seeds have no posted date by definition
				// (IsPending means the bridge sent Posted == 0): keep
				// whatever the bridge reported instead of fabricating
				// the sync instant. The purchase timestamp carries the
				// event time for pending-to-settled matching, falling
				// back to arrival when the bridge sends none.
				if transaction.TransactedAt != nil && *transaction.TransactedAt > 0 {
					transactionTime = *transaction.TransactedAt
				} else {
					transactionTime = now.Unix()
				}
			} else {
				if postedTime <= 0 {
					postedTime = now.Unix()
				}
				// Settled movements affect the reported balance when posted,
				// not at the earlier purchase timestamp: normalize the settled
				// event time to the post instant. Manual transactions are
				// untouched: their TransactionTime-first ordering is unchanged.
				transactionTime = postedTime
			}
			transaction := store.SyncTransaction{
				ProviderAccountID: bridgeID,
				TransactionID:     transaction.ID,
				Facts:             transactionFacts(transaction, account.Currency),
				Transaction: types.Transaction{
					Name:   truncateLabel(transaction.Description),
					Source: store.SourceBankSync,
					Amount: types.TransactionAmountResolution{
						Resolver: "expression",
						Config:   map[string]any{"expression": abs},
						Inputs:   map[string]types.AmountInputBinding{},
					},
					PostedTime:      postedTime,
					TransactionTime: transactionTime,
					Enabled:         !seed,
					Pending:         seed,
				},
			}
			if amount >= 0 {
				transaction.Destinations = []string{modelAccountID}
			} else {
				transaction.SourceAccountID = &source
			}
			if seed {
				translation.Pending = append(translation.Pending, transaction)
			} else {
				translation.Settled = append(translation.Settled, transaction)
			}
		}
	}
	return translation, nil
}
