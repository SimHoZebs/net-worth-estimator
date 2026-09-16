package simplefin

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// PendingPriority matches the sibling charge tier in the seed postings.
const PendingPriority = 6

// SkipReason counts rows the mapper deliberately drops.
type SkipReason string

const (
	SkipUnmappedAccount SkipReason = "unmapped-account"
	SkipNonUSD          SkipReason = "non-usd"
	SkipPosted          SkipReason = "posted-not-materialized"
	SkipNonCharge       SkipReason = "non-charge"
	SkipBadAmount       SkipReason = "bad-amount"
)

// Checkpoint is a balance observation for one model account and day.
type Checkpoint struct {
	AccountID string
	Date      string
	Balance   float64
}

// Plan is the mapped sync output before applying.
type Plan struct {
	Checkpoints []Checkpoint
	Pending     []types.Posting
	Skipped     map[SkipReason]int
}

var idSanitizer = regexp.MustCompile(`[^A-Za-z0-9_-]`)

// PendingPostingID builds the stable sync-namespace ID for a pending charge.
func PendingPostingID(modelAccountID, transactionID string) string {
	return store.SyncPostingPrefix + "pending-" + modelAccountID + "-" + idSanitizer.ReplaceAllString(transactionID, "_")
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

func truncateLabel(description string) string {
	label := strings.TrimSpace(description)
	if label == "" {
		return "Pending card charge"
	}
	runes := []rune(label)
	if len(runes) > 80 {
		return string(runes[:80])
	}
	return label
}

// Map converts an account set into checkpoints plus pending seed postings.
// Posted transactions are never materialized; neither are checking flows.
func Map(set *AccountSet, config Config, now time.Time) (*Plan, error) {
	plan := &Plan{Skipped: map[SkipReason]int{}}
	seenCheckpoints := map[string]struct{}{}
	for _, account := range set.Accounts {
		modelAccountID, mapped := config.AccountMap[account.ID]
		if !mapped {
			plan.Skipped[SkipUnmappedAccount] += len(account.Transactions) + 1
			continue
		}
		if account.Currency != "" && account.Currency != "USD" {
			plan.Skipped[SkipNonUSD] += len(account.Transactions) + 1
			continue
		}
		balance, err := strconv.ParseFloat(strings.TrimSpace(account.Balance), 64)
		if err != nil {
			plan.Skipped[SkipBadAmount]++
			continue
		}
		day := now.UTC().Format("2006-01-02")
		if account.BalanceDate > 0 {
			day = time.Unix(account.BalanceDate, 0).UTC().Format("2006-01-02")
		}
		key := modelAccountID + "\x00" + day
		if _, seen := seenCheckpoints[key]; !seen {
			seenCheckpoints[key] = struct{}{}
			plan.Checkpoints = append(plan.Checkpoints, Checkpoint{AccountID: modelAccountID, Date: day, Balance: balance})
		}

		if _, isCard := config.CardAccounts[modelAccountID]; !isCard {
			continue
		}
		for _, transaction := range account.Transactions {
			if !transaction.IsPending() {
				plan.Skipped[SkipPosted]++
				continue
			}
			amount, err := transaction.ParseAmount()
			if err != nil {
				plan.Skipped[SkipBadAmount]++
				continue
			}
			if amount >= 0 {
				plan.Skipped[SkipNonCharge]++
				continue
			}
			abs, err := absDecimal(transaction.Amount)
			if err != nil {
				plan.Skipped[SkipBadAmount]++
				continue
			}
			source := modelAccountID
			plan.Pending = append(plan.Pending, types.Posting{
				ID:              PendingPostingID(modelAccountID, transaction.ID),
				Label:           truncateLabel(transaction.Description),
				SourceAccountID: &source,
				Amount: types.PostingAmountResolution{
					Resolver: "expression",
					Config:   map[string]any{"expression": abs},
					Inputs:   map[string]types.AmountInputBinding{},
				},
				Frequency: types.FrequencyOnce,
				StartDate: types.IsoDate(transaction.PostedDay(now)),
				Priority:  PendingPriority,
				Enabled:   false,
			})
		}
	}
	return plan, nil
}
