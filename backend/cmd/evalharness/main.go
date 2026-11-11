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
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
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

type fixtureAlias struct {
	Match  string `json:"match"`
	Signal string `json:"signal"`
}

type fixtureRow struct {
	Description string `json:"description"`
	Category    string `json:"category"`
}

type fixture struct {
	Meta    map[string]any `json:"meta"`
	Aliases []fixtureAlias `json:"aliases"`
	Rows    []fixtureRow   `json:"rows"`
}

type evalTransaction struct {
	ID           string   `json:"id"`
	Description  string   `json:"description"`
	Category     string   `json:"category"`
	ExpectedKind string   `json:"expectedKind"`
	Direction    string   `json:"direction"`
	Amount       string   `json:"amount"`
	Dates        []string `json:"dates"`
}

type evalOutput struct {
	Meta         map[string]any                       `json:"meta"`
	Aliases      []fixtureAlias                       `json:"aliases"`
	Transactions []evalTransaction                    `json:"transactions"`
	Findings     map[string][]types.AnalysisDetection `json:"findings"`
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
	if *fixturePath == "" || *outPath == "" || *months < 3 {
		fmt.Fprintln(os.Stderr, "evalharness: -fixture and -out are required; -months must be >= 3")
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
	for i, row := range fix.Rows {
		description, inflow := splitSign(row.Description)
		if description == "" {
			continue
		}
		direction := "outflow"
		sign := -1.0
		if inflow {
			direction = "inflow"
			sign = 1.0
		}
		baseAmount, ok := baseAmounts[row.Category]
		if !ok {
			baseAmount = 100
		}
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
					Currency:    "USD",
					PostedTime:  stamp,
					Metadata:    map[string]string{"category": row.Category},
				},
			})
			dates = append(dates, day.Format("2006-01-02"))
		}
		emitted = append(emitted, evalTransaction{
			ID: fmt.Sprintf("eval-%06d", i), Description: description, Category: row.Category,
			ExpectedKind: expectedKinds[row.Category], Direction: direction,
			Amount: strconv.FormatFloat(sign*baseAmount, 'f', 2, 64),
			Dates:  dates,
		})
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
		Findings: map[string][]types.AnalysisDetection{
			"baseline": baseline, "providers": augmented,
		},
	}
	encoded, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(outPath, encoded, 0o644)
}
