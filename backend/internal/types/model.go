// Package types holds canonical wire/domain types ported from
// src/lib/projection/types/*.ts. JSON shapes match the TypeScript public
// contracts; see docs/backend-migration/ASSUMPTIONS.md.
package types

import (
	"encoding/json"
)

// IsoDate is a "YYYY-MM-DD" UTC calendar date.
type IsoDate = string

const (
	EvaluationTypeFinancialIndependence = "financialIndependence"
	EvaluationTypeNetWorthThreshold     = "netWorthThreshold"
	EvaluationTypePostingFulfillment    = "postingFulfillment"
)

// EvaluationTypeOrder controls evaluation type ordering; table arrays
// preserve ingestion order within each type.
var EvaluationTypeOrder = []string{
	EvaluationTypeFinancialIndependence,
	EvaluationTypeNetWorthThreshold,
	EvaluationTypePostingFulfillment,
}

// JsonValue mirrors the TS JsonValue union.
type JsonValue = any

// Account bound sentinels: the canonical representation uses finite sentinel
// values (mirroring constants.ts), never null or IEEE infinity.
const (
	NoFloor   = -10_000_000_000_000.0
	NoCeiling = 10_000_000_000_000.0
)

type Account struct {
	ID         string   `json:"id"`
	Label      string   `json:"label"`
	MinBalance *float64 `json:"minBalance"` // nil = NoFloor sentinel on the wire
	MaxBalance *float64 `json:"maxBalance"` // nil = NoCeiling sentinel on the wire
	Color      *string  `json:"color"`
	Enabled    bool     `json:"enabled"`
}

func (a *Account) MinBalanceValue() float64 {
	if a.MinBalance == nil {
		return NoFloor
	}
	return *a.MinBalance
}

func (a *Account) MaxBalanceValue() float64 {
	if a.MaxBalance == nil {
		return NoCeiling
	}
	return *a.MaxBalance
}

type Checkpoint struct {
	Date      IsoDate `json:"Date"`
	AccountID string  `json:"AccountId"`
	Balance   float64 `json:"Balance"`
}

type CheckpointCorrection struct {
	AccountID       string  `json:"accountId"`
	ObservedBalance float64 `json:"observedBalance"`
	ModeledBalance  float64 `json:"modeledBalance"`
	Adjustment      float64 `json:"adjustment"`
}

type PostingFrequency string

const (
	FrequencyOnce      PostingFrequency = "once"
	FrequencyDaily     PostingFrequency = "daily"
	FrequencyWeekly    PostingFrequency = "weekly"
	FrequencyMonthly   PostingFrequency = "monthly"
	FrequencyQuarterly PostingFrequency = "quarterly"
	FrequencyAnnual    PostingFrequency = "annual"
)

// AmountInputBinding is a literal value or provider binding for one input.
type AmountInputBinding struct {
	Source    string         `json:"source"` // "literal" | "provider"
	Value     JsonValue      `json:"value,omitempty"`
	Provider  string         `json:"provider,omitempty"`
	Arguments map[string]any `json:"arguments,omitempty"`
}

func (b *AmountInputBinding) UnmarshalJSON(data []byte) error {
	var raw struct {
		Source    string          `json:"source"`
		Value     json.RawMessage `json:"value"`
		Provider  string          `json:"provider"`
		Arguments map[string]any  `json:"arguments"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	b.Source = raw.Source
	b.Provider = raw.Provider
	b.Arguments = raw.Arguments
	if len(raw.Value) > 0 && string(raw.Value) != "null" {
		if err := json.Unmarshal(raw.Value, &b.Value); err != nil {
			return err
		}
	}
	return nil
}

// MarshalJSON emits the exact TS discriminated-union shape: literal bindings
// carry only {source,value}; provider bindings always carry arguments (even
// empty), matching the strict Zod schemas.
func (b AmountInputBinding) MarshalJSON() ([]byte, error) {
	if b.Source == "provider" {
		arguments := b.Arguments
		if arguments == nil {
			arguments = map[string]any{}
		}
		return json.Marshal(struct {
			Source    string         `json:"source"`
			Provider  string         `json:"provider"`
			Arguments map[string]any `json:"arguments"`
		}{b.Source, b.Provider, arguments})
	}
	return json.Marshal(struct {
		Source string    `json:"source"`
		Value  JsonValue `json:"value"`
	}{b.Source, b.Value})
}

type PostingAmountResolution struct {
	Resolver string                        `json:"resolver"`
	Config   map[string]any                `json:"config"`
	Inputs   map[string]AmountInputBinding `json:"inputs"`
}

type IncomeResolverStep struct {
	Resolver             string         `json:"resolver"`
	Config               map[string]any `json:"config"`
	DestinationAccountID *string        `json:"destinationAccountId"`
	EmployerMatchRate    *float64       `json:"employerMatchRate,omitempty"`
}

type IncomeAmountConfig struct {
	IncomeSourceID string               `json:"incomeSourceId"`
	Resolvers      []IncomeResolverStep `json:"resolvers"`
}

type Posting struct {
	ID               string                  `json:"id"`
	Label            string                  `json:"label"`
	SourceAccountID  *string                 `json:"sourceAccountId"`
	Destinations     []string                `json:"destinations"`
	Amount           PostingAmountResolution `json:"amount"`
	Frequency        PostingFrequency        `json:"frequency"`
	AnnualRate       float64                 `json:"annualRate"`
	AnnualGrowthRate float64                 `json:"annualGrowthRate"`
	Volatility       float64                 `json:"volatility"`
	StartDate        IsoDate                 `json:"startDate"`
	EndDate          *IsoDate                `json:"endDate"`
	AnnualCap        *float64                `json:"annualCap"`
	Priority         int                     `json:"priority"`
	Enabled          bool                    `json:"enabled"`
}

type FinancialModelDocument struct {
	SourcePath  string           `json:"sourcePath"`
	Accounts    []Account        `json:"accounts"`
	Checkpoints []Checkpoint     `json:"checkpoints"`
	Evaluations EvaluationTables `json:"evaluations"`
	Postings    []Posting        `json:"postings"`
}

type ModelOverrides struct {
	AddedAccounts      []Account `json:"addedAccounts"`
	AddedPostings      []Posting `json:"addedPostings"`
	DisabledAccountIDs []string  `json:"disabledAccountIds"`
	DisabledPostingIDs []string  `json:"disabledPostingIds"`
}

func EmptyModelOverrides() ModelOverrides {
	return ModelOverrides{
		AddedAccounts:      []Account{},
		AddedPostings:      []Posting{},
		DisabledAccountIDs: []string{},
		DisabledPostingIDs: []string{},
	}
}

// ApplyModelOverrides builds the effective document without mutating the
// canonical input. Ported from applyModelOverrides.ts.
func ApplyModelOverrides(document FinancialModelDocument, overrides ModelOverrides) FinancialModelDocument {
	disabledAccounts := make(map[string]bool, len(overrides.DisabledAccountIDs))
	for _, id := range overrides.DisabledAccountIDs {
		disabledAccounts[id] = true
	}
	disabledPostings := make(map[string]bool, len(overrides.DisabledPostingIDs))
	for _, id := range overrides.DisabledPostingIDs {
		disabledPostings[id] = true
	}
	accounts := make([]Account, 0, len(document.Accounts)+len(overrides.AddedAccounts))
	for _, account := range document.Accounts {
		if !disabledAccounts[account.ID] {
			accounts = append(accounts, account)
		}
	}
	accounts = append(accounts, overrides.AddedAccounts...)
	checkpoints := make([]Checkpoint, 0, len(document.Checkpoints))
	for _, checkpoint := range document.Checkpoints {
		for _, account := range accounts {
			if account.ID == checkpoint.AccountID {
				checkpoints = append(checkpoints, checkpoint)
				break
			}
		}
	}
	postings := make([]Posting, 0, len(document.Postings)+len(overrides.AddedPostings))
	for _, posting := range document.Postings {
		if !disabledPostings[posting.ID] {
			postings = append(postings, posting)
		}
	}
	postings = append(postings, overrides.AddedPostings...)
	return FinancialModelDocument{
		SourcePath:  document.SourcePath,
		Accounts:    accounts,
		Checkpoints: checkpoints,
		Evaluations: document.Evaluations,
		Postings:    postings,
	}
}
