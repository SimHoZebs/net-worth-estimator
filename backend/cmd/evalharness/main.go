// Command evalharness expands labeled bank-descriptor rows into deterministic
// synthetic occurrence series and runs them through the existing payment
// detection backend, emitting findings JSON for the Python eval stage.
//
// The descriptors and labels come from a public labeled dataset; occurrence
// timing and amounts are synthesized deterministically (fixed seed, fixed base
// date, no wall-clock dependence) so runs are reproducible. See
// ml/eval/README.md for the full real-vs-synthesized accounting.
package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"hash/fnv"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/categorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// baseAmounts are plausible per-category monthly amounts in USD. They exist
// only to give the recurrence detector realistic magnitudes; the jitter below
// keeps every occurrence within the detector's amount tolerance so cadence,
// not amount noise, drives the outcome.
var baseAmounts = map[string]float64{
	"Income": 3200, "Rent": 1800, "Mortgage": 2100, "Utilities": 160,
	"Insurance": 190, "Transfer": 500, "Groceries": 85, "Restaurants": 45,
	"Shopping": 120, "Transportation": 60, "Entertainment": 40,
	"Subscription": 16, "Healthcare": 130, "Travel": 450, "Education": 200,
	"Personal Care": 55, "Fees": 12,
}

// expectedKinds maps dataset labels onto detector kind IDs. Labels without a
// classifier (Mortgage and every non-payment category) map to "", meaning the
// correct outcome is no finding at all.
var expectedKinds = map[string]string{
	"Income": "income", "Rent": "rent", "Utilities": "utility", "Insurance": "auto-insurance",
}

// expectedCategories maps dataset labels onto category keys (locked). Transfer
// resolves by direction at emission time: TRANSFER_IN on inflow, TRANSFER_OUT
// otherwise. Labels without an entry map to "", meaning no expectation.
var expectedCategories = map[string]string{
	"Income":         "INCOME",
	"Rent":           "RENT_AND_UTILITIES",
	"Utilities":      "RENT_AND_UTILITIES",
	"Insurance":      "GENERAL_SERVICES",
	"Mortgage":       "LOAN_PAYMENTS",
	"Groceries":      "FOOD_AND_DRINK",
	"Restaurants":    "FOOD_AND_DRINK",
	"Shopping":       "GENERAL_MERCHANDISE",
	"Transportation": "TRANSPORTATION",
	"Entertainment":  "ENTERTAINMENT",
	"Subscription":   "ENTERTAINMENT",
	"Healthcare":     "MEDICAL",
	"Travel":         "TRAVEL",
	"Education":      "GENERAL_SERVICES",
	"Personal Care":  "PERSONAL_CARE",
	"Fees":           "BANK_FEES",
}

// mitulBaseAmounts are plausible per-label monthly magnitudes for the mitul
// transaction-categorization arm, in the same style as baseAmounts:
// realistic magnitudes only, with the jitter below keeping every occurrence
// inside the detector's amount tolerance.
var mitulBaseAmounts = map[string]float64{
	"Food & Dining": 65, "Transportation": 60, "Shopping & Retail": 120,
	"Entertainment & Recreation": 40, "Healthcare & Medical": 130,
	"Utilities & Services": 160, "Financial Services": 350,
	"Income": 3200, "Government & Legal": 200, "Charity & Donations": 75,
}

var (
	mitulHomeImprovementRe = regexp.MustCompile(`(?i)\b(IKEA|HOME DEPOT|LOWES)\b`)
	mitulPersonalCareRe    = regexp.MustCompile(`(?i)\b(GYM|FITNESS|PLANET FITNESS)\b`)
	mitulLoanRe            = regexp.MustCompile(`(?i)\b(LOAN|MORTGAGE)\b`)
	mitulInsuranceRe       = regexp.MustCompile(`(?i)\b(INSURANCE|TAX)\b`)
	mitulWithdrawalRe      = regexp.MustCompile(`(?i)WITHDRAWAL`)
)

// isMitulLabel reports whether a dataset label belongs to the mitul
// transaction-categorization arm. "Income" and "Transportation" collide with
// HF labels but map identically, so routing them here is benign; the caller
// only takes the mitul path for rows without a [debit]/[credit] marker.
func isMitulLabel(label string) bool {
	switch label {
	case "Food & Dining", "Transportation", "Shopping & Retail",
		"Entertainment & Recreation", "Healthcare & Medical",
		"Utilities & Services", "Financial Services", "Income",
		"Government & Legal", "Charity & Donations":
		return true
	default:
		return false
	}
}

// splitMitul resolves a mitul-arm row onto its locked category. Mitul
// descriptions carry no direction marker, so Income rows are inflow and all
// others outflow. keep=false means DROP the row: bare bank/investment names
// under Financial Services carry no mappable key.
func splitMitul(label, raw string) (description string, inflow bool, expected string, keep bool) {
	description = strings.TrimSpace(raw)
	inflow = label == "Income"
	switch label {
	case "Food & Dining":
		return description, inflow, "FOOD_AND_DRINK", true
	case "Transportation":
		return description, inflow, "TRANSPORTATION", true
	case "Shopping & Retail":
		if mitulHomeImprovementRe.MatchString(description) {
			return description, inflow, "HOME_IMPROVEMENT", true
		}
		return description, inflow, "GENERAL_MERCHANDISE", true
	case "Entertainment & Recreation":
		if mitulPersonalCareRe.MatchString(description) {
			return description, inflow, "PERSONAL_CARE", true
		}
		return description, inflow, "ENTERTAINMENT", true
	case "Healthcare & Medical":
		return description, inflow, "MEDICAL", true
	case "Utilities & Services":
		return description, inflow, "RENT_AND_UTILITIES", true
	case "Financial Services":
		switch {
		case mitulLoanRe.MatchString(description):
			return description, inflow, "LOAN_PAYMENTS", true
		case mitulInsuranceRe.MatchString(description):
			return description, inflow, "GENERAL_SERVICES", true
		case mitulWithdrawalRe.MatchString(description):
			return description, inflow, "TRANSFER_OUT", true
		default:
			return description, inflow, "", false
		}
	case "Income":
		return description, inflow, "INCOME", true
	case "Government & Legal", "Charity & Donations":
		return description, inflow, "GOVERNMENT_AND_NON_PROFIT", true
	default:
		return description, inflow, "", true
	}
}

type fixtureAlias struct {
	Match  string `json:"match"`
	Signal string `json:"signal"`
}

type fixtureRow struct {
	Description string `json:"description"`
	Category    string `json:"category"`
	Currency    string `json:"currency,omitempty"`
}

type fixture struct {
	Meta    map[string]any `json:"meta"`
	Aliases []fixtureAlias `json:"aliases"`
	Rows    []fixtureRow   `json:"rows"`
}

type evalTransaction struct {
	ID               string   `json:"id"`
	Description      string   `json:"description"`
	Category         string   `json:"category"`
	ExpectedKind     string   `json:"expectedKind"`
	ExpectedCategory string   `json:"expectedCategory"`
	Direction        string   `json:"direction"`
	Amount           string   `json:"amount"`
	Dates            []string `json:"dates"`
}

// categoryRequestEntry is one categorization judgment request for the single
// representative occurrence of a descriptor row, with the locked
// label-to-category expectation for scoring and training.
type categoryRequestEntry struct {
	Request          types.AnalysisJudgmentInput `json:"request"`
	ExpectedCategory string                      `json:"expectedCategory"`
	TransactionID    string                      `json:"transactionId"`
}

type evalOutput struct {
	Meta         map[string]any    `json:"meta"`
	Aliases      []fixtureAlias    `json:"aliases"`
	Transactions []evalTransaction `json:"transactions"`
	Findings     map[string]any    `json:"findings"`
}

// expectedCategoryFor resolves a dataset label to its locked category key.
// Transfer is direction-dependent; unknown labels carry no expectation.
func expectedCategoryFor(label string, inflow bool) string {
	if label == "Transfer" {
		if inflow {
			return "TRANSFER_IN"
		}
		return "TRANSFER_OUT"
	}
	return expectedCategories[label]
}

// categoryEntriesFor builds the categorization judgment requests for one
// representative occurrence of a descriptor row: the bare description as the
// name, direction from the dataset sign, and the representative amount. The
// locked label-to-category expectation is computed by the caller (HF and
// mitul arms resolve it differently).
func categoryEntriesFor(index int, description string, inflow bool, amount, currency, expected string) []categoryRequestEntry {
	direction := "out"
	if inflow {
		direction = "in"
	}
	transactionID := fmt.Sprintf("eval-%06d", index)
	requests := categorization.CategoryJudgmentRequests(categorization.Input{
		TransactionID: transactionID + "-cat",
		Name:          description,
		Direction:     direction,
		Facts:         &types.TransactionFacts{Description: description, Amount: amount, Currency: currency},
	})
	entries := make([]categoryRequestEntry, 0, len(requests))
	for _, request := range requests {
		entries = append(entries, categoryRequestEntry{
			Request:          request,
			ExpectedCategory: expected,
			TransactionID:    transactionID,
		})
	}
	return entries
}

// hashMix folds the fixed seed, descriptor, and occurrence index into one
// deterministic 64-bit value. Amount/date synthesis draws only from this.
func hashMix(seed int, description string, index int) uint64 {
	h := fnv.New64a()
	var scratch [8]byte
	binary.LittleEndian.PutUint64(scratch[:], uint64(seed))
	h.Write(scratch[:])
	h.Write([]byte(description))
	binary.LittleEndian.PutUint64(scratch[:], uint64(index))
	h.Write(scratch[:])
	return h.Sum64()
}

// splitSign interprets the dataset's [debit]/[credit] marker as the
// cardholder-side direction and returns the bare bank descriptor. The marker
// is a dataset artifact, never a bank-statement token, so it must not enter
// the normalized text the detector groups on.
func splitSign(raw string) (description string, inflow bool) {
	if strings.HasPrefix(raw, "[credit]") {
		return strings.TrimSpace(strings.TrimPrefix(raw, "[credit]")), true
	}
	return strings.TrimSpace(strings.TrimPrefix(raw, "[debit]")), false
}

func main() {
	fixturePath := flag.String("fixture", "", "input fixture JSON (rows + aliases)")
	outPath := flag.String("out", "", "output findings JSON")
	months := flag.Int("months", 6, "synthetic monthly occurrences per descriptor")
	seed := flag.Int("seed", 7, "fixed synthesis seed")
	baseDate := flag.String("base-date", "2023-01-15", "first occurrence date (YYYY-MM-DD)")
	flag.Parse()
	if *fixturePath == "" || *outPath == "" || *months < 1 {
		fmt.Fprintln(os.Stderr, "evalharness: -fixture and -out are required; -months must be >= 1")
		os.Exit(2)
	}
	if err := run(*fixturePath, *outPath, *months, *seed, *baseDate); err != nil {
		fmt.Fprintln(os.Stderr, "evalharness:", err)
		os.Exit(1)
	}
}

func run(fixturePath, outPath string, months, seed int, baseDate string) error {
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		return err
	}
	var fix fixture
	if err := json.Unmarshal(raw, &fix); err != nil {
		return fmt.Errorf("decode fixture: %w", err)
	}
	base, err := time.Parse("2006-01-02", baseDate)
	if err != nil {
		return fmt.Errorf("parse base date: %w", err)
	}
	base = base.UTC()

	snapshot := types.AnalysisSnapshot{Revision: 1, UserID: "eval-owner"}
	emitted := make([]evalTransaction, 0, len(fix.Rows))
	categoryEntries := make([]categoryRequestEntry, 0, len(fix.Rows))
	for i, row := range fix.Rows {
		// Mitul-arm rows carry no [debit]/[credit] marker; resolve them
		// onto the locked mitul mapping (Income inflow, all others
		// outflow, currency as-is) and skip DROP rows entirely.
		currency := row.Currency
		if currency == "" {
			currency = "USD"
		}
		raw := row.Description
		hasMarker := strings.HasPrefix(raw, "[credit]") || strings.HasPrefix(raw, "[debit]")
		var description string
		var inflow bool
		var expectedCategory string
		var baseAmount float64
		if !hasMarker && isMitulLabel(row.Category) {
			var keep bool
			description, inflow, expectedCategory, keep = splitMitul(row.Category, raw)
			if !keep {
				continue
			}
			if description == "" {
				continue
			}
			var ok bool
			baseAmount, ok = mitulBaseAmounts[row.Category]
			if !ok {
				baseAmount = 100
			}
		} else {
			description, inflow = splitSign(raw)
			if description == "" {
				continue
			}
			expectedCategory = expectedCategoryFor(row.Category, inflow)
			var ok bool
			baseAmount, ok = baseAmounts[row.Category]
			if !ok {
				baseAmount = 100
			}
		}
		direction := "outflow"
		sign := -1.0
		if inflow {
			direction = "inflow"
			sign = 1.0
		}
		amount := strconv.FormatFloat(sign*baseAmount, 'f', 2, 64)
		// The categorization builder carries direction in its own field;
		// the learner evidence layer requires a non-negative amount.
		catAmount := strconv.FormatFloat(math.Abs(sign*baseAmount), 'f', 2, 64)
		dates := make([]string, 0, months)
		for k := 0; k < months; k++ {
			mix := hashMix(seed, row.Description, k)
			// Amounts jitter +-5%, inside the detector's 15% amount
			// tolerance, so recurrence stands or falls on timing.
			jitter := float64(mix%1000)/1000.0 - 0.5
			amount := sign * baseAmount * (1 + jitter*0.10)
			// Exact 30-day spacing with a deterministic +-1 day wobble:
			// the monthly cadence median is 30.44 days with 15%
			// tolerance, so this always qualifies when grouping holds.
			wobble := int(mix>>16%3) - 1
			day := base.AddDate(0, 0, k*30+wobble)
			stamp := time.Date(day.Year(), day.Month(), day.Day(), 12, 0, 0, 0, time.UTC).Unix()
			id := fmt.Sprintf("eval-%06d-%02d", i, k)
			snapshot.Transactions = append(snapshot.Transactions, types.AnalysisTransaction{
				TransactionID: id, AccountID: "eval-acct-001", SourceProvider: "evalharness",
				Facts: types.TransactionFacts{
					Description: description,
					Amount:      strconv.FormatFloat(amount, 'f', 2, 64),
					Currency:    currency,
					PostedTime:  stamp,
					Metadata:    map[string]string{"category": row.Category},
				},
			})
			dates = append(dates, day.Format("2006-01-02"))
		}
		emitted = append(emitted, evalTransaction{
			ID: fmt.Sprintf("eval-%06d", i), Description: description, Category: row.Category,
			ExpectedKind: expectedKinds[row.Category], ExpectedCategory: expectedCategory,
			Direction: direction,
			Amount:    amount,
			Dates:     dates,
		})
		categoryEntries = append(categoryEntries, categoryEntriesFor(i, description, inflow, catAmount, currency, expectedCategory)...)
	}

	ctx := context.Background()
	baseline, err := analysis.PaymentPatterns{}.Analyze(ctx, snapshot)
	if err != nil {
		return fmt.Errorf("baseline analyze: %w", err)
	}
	providerMap := make(map[string]string, len(fix.Aliases))
	for _, a := range fix.Aliases {
		key := strings.ToLower(strings.TrimSpace(a.Match))
		if key != "" && a.Signal != "" {
			providerMap[key] = a.Signal
		}
	}
	augmented, err := analysis.PaymentPatterns{}.WithProviders(
		analysis.MapProviderResolver{Aliases: providerMap, Rev: "eval-v1"},
	).Analyze(ctx, snapshot)
	if err != nil {
		return fmt.Errorf("provider analyze: %w", err)
	}

	out := evalOutput{
		Meta: map[string]any{
			"tool": "evalharness", "months": months, "seed": seed,
			"baseDate": baseDate, "rows": len(fix.Rows),
			"transactions": len(snapshot.Transactions), "aliasCount": len(providerMap),
		},
		Aliases:      fix.Aliases,
		Transactions: emitted,
		Findings: map[string]any{
			"baseline": baseline, "providers": augmented,
			"categoryRequests": categoryEntries,
		},
	}
	encoded, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(outPath, encoded, 0o644)
}
