// Package csvio imports/exports canonical CSV files for seeding and parity.
package csvio

import (
	"encoding/csv"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// FileNames mirror types/model.ts and types/income.ts.
const (
	AccountsFile      = "accounts.csv"
	CheckpointsFile   = "checkpoints.csv"
	PostingsFile      = "postings.csv"
	FIFile            = "behavior/financial-independence.csv"
	ThresholdFile     = "behavior/net-worth-threshold.csv"
	FulfillmentFile   = "behavior/posting-fulfillment.csv"
	IncomeSourcesFile = "income-sources.csv"
	TaxProfilesFile   = "tax-profiles.csv"
)

func readCSV(path string) ([][]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	reader := csv.NewReader(file)
	reader.FieldsPerRecord = -1
	return reader.ReadAll()
}

func headerIndex(header []string) map[string]int {
	index := map[string]int{}
	for i, name := range header {
		name = strings.TrimSpace(name)
		if name != "" {
			index[name] = i
		}
	}
	return index
}

func field(record []string, index map[string]int, name string) string {
	i, ok := index[name]
	if !ok || i >= len(record) {
		return ""
	}
	return strings.TrimSpace(record[i])
}

func parseBool(value string) bool {
	return value == "true" || value == "1"
}

func parseBound(value string) (*float64, error) {
	// CSV sentinels map to the canonical finite sentinel constants
	// (constants.ts NO_FLOOR / NO_CEILING). Any other non-finite spelling
	// ("inf", "NaN", ...) is rejected: the canonical representation is finite.
	switch value {
	case "-Infinity":
		v := types.NoFloor
		return &v, nil
	case "Infinity":
		v := types.NoCeiling
		return &v, nil
	case "":
		return nil, nil
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid bound %q", value)
	}
	if math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return nil, fmt.Errorf("bound %q must be a finite number or an Infinity sentinel", value)
	}
	return &parsed, nil
}

func parseOptionalFloat(value string) *float64 {
	if value == "" || value == "null" {
		return nil
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return nil
	}
	return &parsed
}

func parseOptionalDate(value string) *types.IsoDate {
	if value == "" {
		return nil
	}
	date := types.IsoDate(value)
	return &date
}

func parseOptionalString(value string) *string {
	if value == "" {
		return nil
	}
	text := value
	return &text
}

// ParseNumberValue converts a JSON-decoded number to float64.
func ParseNumberValue(value any) float64 {
	number, _ := value.(float64)
	return number
}

// ImportModel reads the model CSV tables from a directory into a document.
func ImportModel(csvPath string) (*types.FinancialModelDocument, error) {
	document := &types.FinancialModelDocument{
		SourcePath:  filepath.ToSlash(filepath.Base(filepath.Clean(csvPath))),
		Evaluations: types.EmptyEvaluationTables(),
	}

	records, err := readCSV(filepath.Join(csvPath, AccountsFile))
	if err != nil {
		return nil, fmt.Errorf("read accounts: %w", err)
	}
	index := headerIndex(records[0])
	for _, record := range records[1:] {
		if len(strings.Join(record, "")) == 0 {
			continue
		}
		minBalance, minErr := parseBound(field(record, index, "minBalance"))
		if minErr != nil {
			return nil, fmt.Errorf("account %s: %w", field(record, index, "id"), minErr)
		}
		maxBalance, maxErr := parseBound(field(record, index, "maxBalance"))
		if maxErr != nil {
			return nil, fmt.Errorf("account %s: %w", field(record, index, "id"), maxErr)
		}
		document.Accounts = append(document.Accounts, types.Account{
			ID:         field(record, index, "id"),
			Label:      field(record, index, "label"),
			MinBalance: minBalance,
			MaxBalance: maxBalance,
			Color:      parseOptionalString(field(record, index, "color")),
			Enabled:    parseBool(field(record, index, "enabled")),
		})
	}

	records, err = readCSV(filepath.Join(csvPath, CheckpointsFile))
	if err != nil {
		return nil, fmt.Errorf("read checkpoints: %w", err)
	}
	index = headerIndex(records[0])
	for _, record := range records[1:] {
		if len(strings.Join(record, "")) == 0 {
			continue
		}
		balanceRaw := field(record, index, "Balance")
		balanceValue, err := strconv.ParseFloat(balanceRaw, 64)
		if err != nil || math.IsNaN(balanceValue) || math.IsInf(balanceValue, 0) {
			return nil, fmt.Errorf("checkpoint balance %q must be a finite number", balanceRaw)
		}
		document.Checkpoints = append(document.Checkpoints, types.Checkpoint{
			Date:      field(record, index, "Date"),
			AccountID: field(record, index, "AccountId"),
			Balance:   balanceValue,
		})
	}

	records, err = readCSV(filepath.Join(csvPath, PostingsFile))
	if err != nil {
		return nil, fmt.Errorf("read postings: %w", err)
	}
	index = headerIndex(records[0])
	annualRateIndex := index["annualRate"]
	for _, record := range records[1:] {
		if len(strings.Join(record, "")) == 0 {
			continue
		}
		posting := types.Posting{
			ID:              field(record, index, "id"),
			Label:           field(record, index, "label"),
			SourceAccountID: parseOptionalString(field(record, index, "sourceAccountId")),
			Destinations:    parseDestinations(field(record, index, "destinations")),
			Frequency:       types.PostingFrequency(field(record, index, "frequency")),
			StartDate:       field(record, index, "startDate"),
			EndDate:         parseOptionalDate(field(record, index, "endDate")),
			Priority:        int(parseNumberOr(field(record, index, "priority"), 1)),
			Enabled:         parseBool(field(record, index, "enabled")),
		}
		var amount types.PostingAmountResolution
		amountRaw := field(record, index, "amount")
		if err := strictUnmarshal([]byte(amountRaw), &amount); err != nil {
			return nil, fmt.Errorf("posting %s amount: %w", posting.ID, err)
		}
		posting.Amount = amount
		if annualRateIndex >= 0 && annualRateIndex < len(record) {
			posting.AnnualRate = parseNumberOr(record[annualRateIndex], 0)
		}
		posting.AnnualGrowthRate = parseNumberOr(field(record, index, "annualGrowthRate"), 0)
		posting.Volatility = parseNumberOr(field(record, index, "volatility"), 0)
		posting.AnnualCap = parseOptionalFloat(field(record, index, "annualCap"))
		document.Postings = append(document.Postings, posting)
	}

	if err := importFIEvaluations(csvPath, document); err != nil {
		return nil, err
	}
	if err := importThresholdEvaluations(csvPath, document); err != nil {
		return nil, err
	}
	if err := importFulfillmentEvaluations(csvPath, document); err != nil {
		return nil, err
	}
	return document, nil
}

func importFIEvaluations(csvPath string, document *types.FinancialModelDocument) error {
	records, err := readCSV(filepath.Join(csvPath, FIFile))
	if err != nil {
		return fmt.Errorf("read FI behavior: %w", err)
	}
	index := headerIndex(records[0])
	for _, record := range records[1:] {
		if len(strings.Join(record, "")) == 0 {
			continue
		}
		sourcesJSON := field(record, index, "sources")
		continuingJSON := field(record, index, "continuingPostingIds")
		evaluationYears := int(parseNumberOr(field(record, index, "evaluationYears"), 1))
		config := map[string]any{
			"minimumNetWorth":         parseNumberOr(field(record, index, "minimumNetWorth"), 0),
			"annualExpenseTarget":     parseNumberOr(field(record, index, "annualExpenseTarget"), 0),
			"annualExpenseGrowthRate": parseNumberOr(field(record, index, "annualExpenseGrowthRate"), 0),
			"withdrawalRate":          parseNumberOr(field(record, index, "withdrawalRate"), 0),
			"evaluationYears":         float64(evaluationYears),
			"requiredConfidence":      parseNumberOr(field(record, index, "requiredConfidence"), 1),
			"principalPolicy":         field(record, index, "principalPolicy"),
		}
		if basis := field(record, index, "annualExpenseTargetBasis"); basis != "" {
			config["annualExpenseTargetBasis"] = basis
		}
		var sources any
		if err := strictUnmarshal([]byte(sourcesJSON), &sources); err != nil {
			return fmt.Errorf("FI sources: %w", err)
		}
		config["sources"] = sources
		var continuing any
		if err := strictUnmarshal([]byte(continuingJSON), &continuing); err != nil {
			return fmt.Errorf("FI continuingPostingIds: %w", err)
		}
		config["continuingPostingIds"] = continuing
		document.Evaluations.FinancialIndependence = append(document.Evaluations.FinancialIndependence, types.FIEvaluation{
			InstanceID: field(record, index, "instanceId"),
			Label:      field(record, index, "label"),
			Enabled:    parseBool(field(record, index, "enabled")),
			Config:     config,
		})
	}
	return nil
}

func importThresholdEvaluations(csvPath string, document *types.FinancialModelDocument) error {
	records, err := readCSV(filepath.Join(csvPath, ThresholdFile))
	if err != nil {
		return fmt.Errorf("read threshold behavior: %w", err)
	}
	index := headerIndex(records[0])
	for _, record := range records[1:] {
		if len(strings.Join(record, "")) == 0 {
			continue
		}
		document.Evaluations.NetWorthThreshold = append(document.Evaluations.NetWorthThreshold, types.ThresholdEvaluation{
			InstanceID: field(record, index, "instanceId"),
			Label:      field(record, index, "label"),
			Enabled:    parseBool(field(record, index, "enabled")),
			Config: map[string]any{
				"target": parseNumberOr(field(record, index, "target"), 0),
			},
		})
	}
	return nil
}

func importFulfillmentEvaluations(csvPath string, document *types.FinancialModelDocument) error {
	records, err := readCSV(filepath.Join(csvPath, FulfillmentFile))
	if err != nil {
		return fmt.Errorf("read fulfillment behavior: %w", err)
	}
	index := headerIndex(records[0])
	for _, record := range records[1:] {
		if len(strings.Join(record, "")) == 0 {
			continue
		}
		var postingIDs any
		raw := field(record, index, "postingIds")
		if raw == "" || raw == "null" {
			postingIDs = nil
		} else if err := strictUnmarshal([]byte(raw), &postingIDs); err != nil {
			return fmt.Errorf("fulfillment postingIds: %w", err)
		}
		document.Evaluations.PostingFulfillment = append(document.Evaluations.PostingFulfillment, types.FulfillmentEvaluation{
			InstanceID: field(record, index, "instanceId"),
			Label:      field(record, index, "label"),
			Enabled:    parseBool(field(record, index, "enabled")),
			Config: map[string]any{
				"postingIds": postingIDs,
			},
		})
	}
	return nil
}

func parseDestinations(raw string) []string {
	if raw == "" || raw == "null" {
		return nil
	}
	var destinations []string
	if err := strictUnmarshal([]byte(raw), &destinations); err == nil {
		return destinations
	}
	// Fallback: semicolon- or comma-separated plain list (TS CSV writer emits
	// semicolon-separated destination IDs for multi-destination rows).
	separator := ";"
	if !strings.Contains(raw, ";") {
		separator = ","
	}
	parts := strings.Split(raw, separator)
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func parseNumberOr(raw string, fallback float64) float64 {
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

// ImportIncomeData reads income CSVs from a directory.
func ImportIncomeData(incomePath string) (*types.IncomeDataSnapshot, error) {
	snapshot := &types.IncomeDataSnapshot{}
	records, err := readCSV(filepath.Join(incomePath, IncomeSourcesFile))
	if err != nil {
		return nil, fmt.Errorf("read income sources: %w", err)
	}
	index := headerIndex(records[0])
	for _, record := range records[1:] {
		if len(strings.Join(record, "")) == 0 {
			continue
		}
		gross := parseNumberOr(field(record, index, "annualGrossIncome"), 0)
		snapshot.IncomeSources = append(snapshot.IncomeSources, types.IncomeSourceDefinition{
			ID:                field(record, index, "id"),
			Label:             field(record, index, "label"),
			EffectiveFrom:     field(record, index, "effectiveFrom"),
			EffectiveTo:       parseOptionalDate(field(record, index, "effectiveTo")),
			AnnualGrossIncome: gross,
		})
	}
	profileRecords, err := readCSV(filepath.Join(incomePath, TaxProfilesFile))
	if err != nil {
		return nil, fmt.Errorf("read tax profiles: %w", err)
	}
	profileIndex := headerIndex(profileRecords[0])
	for _, record := range profileRecords[1:] {
		if len(strings.Join(record, "")) == 0 {
			continue
		}
		var brackets []types.IncomeTaxBracket
		if err := strictUnmarshal([]byte(field(record, profileIndex, "brackets")), &brackets); err != nil {
			return nil, fmt.Errorf("tax profile brackets: %w", err)
		}
		snapshot.TaxProfiles = append(snapshot.TaxProfiles, types.IncomeTaxProfile{
			ID:        field(record, profileIndex, "id"),
			Label:     field(record, profileIndex, "label"),
			Deduction: parseNumberOr(field(record, profileIndex, "deduction"), 0),
			Brackets:  brackets,
			SourceURL: parseOptionalString(field(record, profileIndex, "sourceUrl")),
		})
	}
	return snapshot, nil
}

var _ io.Reader = (*strings.Reader)(nil)
