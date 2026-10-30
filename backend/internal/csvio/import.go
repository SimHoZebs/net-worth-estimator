// Package csvio reads canonical CSV files for seeding.
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
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Canonical CSV file names.
const (
	AccountsFile       = "accounts.csv"
	CheckpointsFile    = "checkpoints.csv"
	PostingsFile       = "postings.csv"
	RulesFile          = "recurrence-rules.csv"
	FIFile             = "behavior/financial-independence.csv"
	ThresholdFile      = "behavior/net-worth-threshold.csv"
	AccountBalanceFile = "behavior/account-balance.csv"
	FulfillmentFile    = "behavior/posting-fulfillment.csv"
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
	// CSV sentinels map to the canonical finite sentinel constants. Any other
	// non-finite spelling ("inf", "NaN", ...) is rejected: the canonical
	// representation is finite.
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

func isUUID(value string) bool {
	parsed, err := uuid.Parse(value)
	return err == nil && parsed.String() == value
}

func newUUIDv7() string {
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.NewString()
	}
	return id.String()
}

// parseUnixTime parses required Unix seconds. A legacy YYYY-MM-DD day
// converts to UTC midnight to ease migration.
func parseUnixTime(value, fallbackDate string) (int64, error) {
	if value != "" {
		parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
		if err != nil || parsed <= 0 {
			return 0, fmt.Errorf("invalid Unix time %q", value)
		}
		return parsed, nil
	}
	if fallbackDate != "" {
		parsed, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(fallbackDate), time.UTC)
		if err != nil {
			return 0, fmt.Errorf("invalid date %q", fallbackDate)
		}
		stamp := parsed.Unix()
		if stamp <= 0 {
			return 0, fmt.Errorf("invalid date %q", fallbackDate)
		}
		return stamp, nil
	}
	return 0, fmt.Errorf("missing time")
}

// ParseNumberValue converts a JSON-decoded number to float64.
func ParseNumberValue(value any) float64 {
	number, _ := value.(float64)
	return number
}

// ImportModel reads the model CSV tables from a directory into a model.
func ImportModel(csvPath string) (*types.FinancialModel, error) {
	model := &types.FinancialModel{
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
		model.Accounts = append(model.Accounts, types.Account{
			ID:         field(record, index, "id"),
			Name:       field(record, index, "name"),
			Kind:       types.AccountKind(field(record, index, "kind")),
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
		observedRaw := field(record, index, "ObservedAt")
		observedAt, err := strconv.ParseInt(observedRaw, 10, 64)
		if observedRaw == "" || err != nil || observedAt <= 0 {
			return nil, fmt.Errorf("checkpoint observedAt %q must be the exact observation time as Unix seconds", observedRaw)
		}
		model.Checkpoints = append(model.Checkpoints, types.Checkpoint{
			AccountID:  field(record, index, "AccountId"),
			Balance:    balanceValue,
			ObservedAt: observedAt,
		})
	}

	records, err = readCSV(filepath.Join(csvPath, PostingsFile))
	if err != nil {
		return nil, fmt.Errorf("read postings: %w", err)
	}
	index = headerIndex(records[0])
	if _, legacy := index["frequency"]; legacy {
		return nil, fmt.Errorf("postings.csv uses the legacy frequency column: move repeating rows to recurrence-rules.csv with time columns for one-time rows")
	}
	idMap := map[string]string{}
	for _, record := range records[1:] {
		if len(strings.Join(record, "")) == 0 {
			continue
		}
		rawID := field(record, index, "id")
		storedID := rawID
		if !isUUID(rawID) {
			storedID = newUUIDv7()
			if rawID != "" {
				idMap[rawID] = storedID
			}
		}
		postedTime, err := parseUnixTime(field(record, index, "postedTime"), field(record, index, "date"))
		if err != nil {
			return nil, fmt.Errorf("posting %s: %w", rawID, err)
		}
		transactionRaw := field(record, index, "transactionTime")
		var transactionTime int64
		if transactionRaw != "" {
			transactionTime, err = parseUnixTime(transactionRaw, "")
			if err != nil {
				return nil, fmt.Errorf("posting %s: %w", rawID, err)
			}
		} else {
			transactionTime = postedTime
		}
		posting := types.Posting{
			ID:              storedID,
			Name:            field(record, index, "name"),
			SourceAccountID: parseOptionalString(field(record, index, "sourceAccountId")),
			Destinations:    parseDestinations(field(record, index, "destinations")),
			PostedTime:      postedTime,
			TransactionTime: transactionTime,
			Enabled:         parseBool(field(record, index, "enabled")),
		}
		var amount types.PostingAmountResolution
		amountRaw := field(record, index, "amount")
		if err := strictUnmarshal([]byte(amountRaw), &amount); err != nil {
			return nil, fmt.Errorf("posting %s amount: %w", rawID, err)
		}
		posting.Amount = amount
		if ruleID := field(record, index, "ruleId"); ruleID != "" {
			occurrenceDate := field(record, index, "occurrenceDate")
			posting.Claim = &types.PostingClaim{RuleID: ruleID, OccurrenceDate: occurrenceDate}
		}
		model.Postings = append(model.Postings, posting)
	}

	records, err = readCSV(filepath.Join(csvPath, RulesFile))
	if err != nil {
		if os.IsNotExist(err) {
			records = [][]string{}
		} else {
			return nil, fmt.Errorf("read recurrence rules: %w", err)
		}
	}
	if len(records) > 0 {
		index = headerIndex(records[0])
		for _, record := range records[1:] {
			if len(strings.Join(record, "")) == 0 {
				continue
			}
			rule := types.RecurrenceRule{
				ID:              field(record, index, "id"),
				Name:            field(record, index, "name"),
				SourceAccountID: parseOptionalString(field(record, index, "sourceAccountId")),
				Destinations:    parseDestinations(field(record, index, "destinations")),
				Frequency:       types.RecurrenceFrequency(field(record, index, "frequency")),
				StartDate:       field(record, index, "startDate"),
				EndDate:         parseOptionalDate(field(record, index, "endDate")),
				Priority:        int(parseNumberOr(field(record, index, "priority"), 1)),
				Enabled:         parseBool(field(record, index, "enabled")),
			}
			var amount types.PostingAmountResolution
			amountRaw := field(record, index, "amount")
			if err := strictUnmarshal([]byte(amountRaw), &amount); err != nil {
				return nil, fmt.Errorf("rule %s amount: %w", rule.ID, err)
			}
			rule.Amount = amount
			rule.AnnualCap = parseOptionalFloat(field(record, index, "annualCap"))
			model.RecurrenceRules = append(model.RecurrenceRules, rule)
		}
	}

	if err := importFIEvaluations(csvPath, model); err != nil {
		return nil, err
	}
	if err := importThresholdEvaluations(csvPath, model); err != nil {
		return nil, err
	}
	if err := importAccountBalanceEvaluations(csvPath, model); err != nil {
		return nil, err
	}
	if err := importFulfillmentEvaluations(csvPath, model); err != nil {
		return nil, err
	}
	types.RemapPostingReferences(model, idMap)
	return model, nil
}

func importFIEvaluations(csvPath string, model *types.FinancialModel) error {
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
		model.Evaluations.FinancialIndependence = append(model.Evaluations.FinancialIndependence, types.FIEvaluation{
			InstanceID: field(record, index, "instanceId"),
			Name:       field(record, index, "name"),
			Enabled:    parseBool(field(record, index, "enabled")),
			Config:     config,
		})
	}
	return nil
}

func importThresholdEvaluations(csvPath string, model *types.FinancialModel) error {
	records, err := readCSV(filepath.Join(csvPath, ThresholdFile))
	if err != nil {
		return fmt.Errorf("read threshold behavior: %w", err)
	}
	index := headerIndex(records[0])
	for _, record := range records[1:] {
		if len(strings.Join(record, "")) == 0 {
			continue
		}
		model.Evaluations.NetWorthThreshold = append(model.Evaluations.NetWorthThreshold, types.ThresholdEvaluation{
			InstanceID: field(record, index, "instanceId"),
			Name:       field(record, index, "name"),
			Enabled:    parseBool(field(record, index, "enabled")),
			Config: map[string]any{
				"target": parseNumberOr(field(record, index, "target"), 0),
			},
		})
	}
	return nil
}

func importAccountBalanceEvaluations(csvPath string, model *types.FinancialModel) error {
	records, err := readCSV(filepath.Join(csvPath, AccountBalanceFile))
	if err != nil {
		return fmt.Errorf("read account balance behavior: %w", err)
	}
	index := headerIndex(records[0])
	for _, record := range records[1:] {
		if len(strings.Join(record, "")) == 0 {
			continue
		}
		model.Evaluations.AccountBalance = append(model.Evaluations.AccountBalance, types.BalanceEvaluation{
			InstanceID: field(record, index, "instanceId"),
			Name:       field(record, index, "name"),
			Enabled:    parseBool(field(record, index, "enabled")),
			Config: map[string]any{
				"accountId": field(record, index, "accountId"),
				"target":    parseNumberOr(field(record, index, "target"), 0),
			},
		})
	}
	return nil
}

func importFulfillmentEvaluations(csvPath string, model *types.FinancialModel) error {
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
		model.Evaluations.PostingFulfillment = append(model.Evaluations.PostingFulfillment, types.FulfillmentEvaluation{
			InstanceID: field(record, index, "instanceId"),
			Name:       field(record, index, "name"),
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
	// Fallback: semicolon- or comma-separated plain list; JSON arrays are
	// accepted by the strict parser.
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

var _ io.Reader = (*strings.Reader)(nil)
