// Package types holds canonical wire and domain types used by the backend.
// JSON fields and shapes are part of the API contract; account bounds use
// finite NoFloor and NoCeiling sentinels.
package types

import (
	"encoding/json"
)

// IsoDate is a "YYYY-MM-DD" UTC calendar date.
type IsoDate = string

const (
	EvaluationTypeFinancialIndependence = "financialIndependence"
	EvaluationTypeNetWorthThreshold     = "netWorthThreshold"
	EvaluationTypeAccountBalance        = "accountBalance"
	EvaluationTypePostingFulfillment    = "postingFulfillment"
	EvaluationTypeCycleFulfillment      = "cycleFulfillment"
)

// EvaluationTypeOrder controls evaluation type ordering; table arrays
// preserve ingestion order within each type.
var EvaluationTypeOrder = []string{
	EvaluationTypeFinancialIndependence,
	EvaluationTypeNetWorthThreshold,
	EvaluationTypeAccountBalance,
	EvaluationTypePostingFulfillment,
	EvaluationTypeCycleFulfillment,
}

// JsonValue represents arbitrary JSON values in wire payloads.
type JsonValue = any

// Account bound sentinels: the canonical representation uses finite sentinel
// values, never null or IEEE infinity.
const (
	NoFloor   = -10_000_000_000_000.0
	NoCeiling = 10_000_000_000_000.0
)

// AccountKind states what an account holds. It is authored in the accounts
// file rather than inferred from a balance sign, so an account that happens to
// hold zero still declares what it is and totals can group by it.
type AccountKind string

const (
	AccountKindCash       AccountKind = "cash"
	AccountKindInvestment AccountKind = "investment"
	AccountKindDebt       AccountKind = "debt"
	AccountKindProperty   AccountKind = "property"
)

var accountKinds = []AccountKind{
	AccountKindCash,
	AccountKindInvestment,
	AccountKindDebt,
	AccountKindProperty,
}

func (k AccountKind) Valid() bool {
	for _, candidate := range accountKinds {
		if k == candidate {
			return true
		}
	}
	return false
}

type Account struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Kind       AccountKind `json:"kind"`
	MinBalance *float64    `json:"minBalance"` // nil = NoFloor sentinel on the wire
	MaxBalance *float64    `json:"maxBalance"` // nil = NoCeiling sentinel on the wire
	Color      *string     `json:"color"`
	Enabled    bool        `json:"enabled"`
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
	// Source names the row owner: "model" (owner/seed) or "simplefin".
	// Read-only on GET; PUT ignores it (server recomputes ownership).
	Source string `json:"source,omitempty"`
}

type CheckpointCorrection struct {
	AccountID       string  `json:"accountId"`
	ObservedBalance float64 `json:"observedBalance"`
	ModeledBalance  float64 `json:"modeledBalance"`
	Adjustment      float64 `json:"adjustment"`
}

type RecurrenceFrequency string

const (
	FrequencyDaily     RecurrenceFrequency = "daily"
	FrequencyWeekly    RecurrenceFrequency = "weekly"
	FrequencyMonthly   RecurrenceFrequency = "monthly"
	FrequencyQuarterly RecurrenceFrequency = "quarterly"
	FrequencyAnnual    RecurrenceFrequency = "annual"
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

// MarshalJSON emits the exact discriminated-union shape: literal bindings
// carry only {source,value}; provider bindings always carry arguments (even
// empty), preserving the wire contract.
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

type PostingClaim struct {
	// RuleID names the recurrence rule whose scheduled occurrence this
	// posting records. Always paired with OccurrenceDate; both are set
	// manually, never inferred.
	RuleID string `json:"ruleId"`
	// OccurrenceDate is the scheduled occurrence this posting replaces.
	// It is independent of Date, so an early or late actual can still
	// claim its occurrence.
	OccurrenceDate IsoDate `json:"occurrenceDate"`
}

// Posting is a pure dated movement: a single record of money moved on one
// date. Postings never repeat; repetition is owned by RecurrenceRule, which
// expands into occurrences at projection time. A posting with a Claim is an
// actual recorded against one scheduled occurrence of its rule.
type Posting struct {
	ID              string                  `json:"id"`
	Name            string                  `json:"name"`
	SourceAccountID *string                 `json:"sourceAccountId"`
	Destinations    []string                `json:"destinations"`
	Amount          PostingAmountResolution `json:"amount"`
	Date            IsoDate                 `json:"date"`
	Claim           *PostingClaim           `json:"claim,omitempty"`
	Priority        int                     `json:"priority"`
	Enabled         bool                    `json:"enabled"`
	// Source names the row owner: "model" (owner/seed) or "simplefin".
	// Read-only on GET; PUT ignores it (server recomputes ownership).
	Source string `json:"source,omitempty"`
}

// RecurrenceRule owns repetition. Its movement fields are the template
// expanded into one occurrence per scheduled date; its schedule fields say
// when. Rules never move money themselves; expansion at projection time
// produces occurrences that execute exactly like postings.
type RecurrenceRule struct {
	ID               string                  `json:"id"`
	Name             string                  `json:"name"`
	SourceAccountID  *string                 `json:"sourceAccountId"`
	Destinations     []string                `json:"destinations"`
	Amount           PostingAmountResolution `json:"amount"`
	Frequency        RecurrenceFrequency     `json:"frequency"`
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
	SourcePath      string           `json:"sourcePath"`
	Accounts        []Account        `json:"accounts"`
	Checkpoints     []Checkpoint     `json:"checkpoints"`
	Evaluations     EvaluationTables `json:"evaluations"`
	Postings        []Posting        `json:"postings"`
	RecurrenceRules []RecurrenceRule `json:"recurrenceRules"`
	PaymentTerms    []PaymentTerms   `json:"paymentTerms"`
}

// PaymentTerms is mechanism config linked to one debt account. Accounts
// stay values only (balances, bounds, kind); terms carry the payment
// schedule: minimums, monthly due anchor, and the revolving statement anchor
// for cards. Terms never move money themselves; postings remain the only
// movement mechanism. The effective minimum combines MinimumFixed with
// MinimumPercent of the balance magnitude when set; the balance basis is
// resolved where terms are applied.
type PaymentTerms struct {
	AccountID      string   `json:"accountId"`
	MinimumFixed   float64  `json:"minimumFixed"`
	MinimumPercent *float64 `json:"minimumPercent,omitempty"`
	DueDay         int      `json:"dueDay"`
	StatementDay   *int     `json:"statementDay,omitempty"`
}

type ModelOverrides struct {
	AddedAccounts      []Account        `json:"addedAccounts"`
	AddedPostings      []Posting        `json:"addedPostings"`
	AddedRules         []RecurrenceRule `json:"addedRules"`
	DisabledAccountIDs []string         `json:"disabledAccountIds"`
	DisabledPostingIDs []string         `json:"disabledPostingIds"`
	DisabledRuleIDs    []string         `json:"disabledRuleIds"`
}

func EmptyModelOverrides() ModelOverrides {
	return ModelOverrides{
		AddedAccounts:      []Account{},
		AddedPostings:      []Posting{},
		AddedRules:         []RecurrenceRule{},
		DisabledAccountIDs: []string{},
		DisabledPostingIDs: []string{},
		DisabledRuleIDs:    []string{},
	}
}

// ApplyModelOverrides builds the effective document without mutating the
// canonical input.
func ApplyModelOverrides(document FinancialModelDocument, overrides ModelOverrides) FinancialModelDocument {
	disabledAccounts := make(map[string]bool, len(overrides.DisabledAccountIDs))
	for _, id := range overrides.DisabledAccountIDs {
		disabledAccounts[id] = true
	}
	disabledPostings := make(map[string]bool, len(overrides.DisabledPostingIDs))
	for _, id := range overrides.DisabledPostingIDs {
		disabledPostings[id] = true
	}
	disabledRules := make(map[string]bool, len(overrides.DisabledRuleIDs))
	for _, id := range overrides.DisabledRuleIDs {
		disabledRules[id] = true
	}
	accounts := make([]Account, 0, len(document.Accounts)+len(overrides.AddedAccounts))
	for _, account := range document.Accounts {
		if !disabledAccounts[account.ID] {
			accounts = append(accounts, account)
		}
	}
	accounts = append(accounts, overrides.AddedAccounts...)
	accountIDSet := make(map[string]bool, len(accounts))
	for _, account := range accounts {
		accountIDSet[account.ID] = true
	}
	checkpoints := make([]Checkpoint, 0, len(document.Checkpoints))
	for _, checkpoint := range document.Checkpoints {
		if accountIDSet[checkpoint.AccountID] {
			checkpoints = append(checkpoints, checkpoint)
		}
	}
	postings := make([]Posting, 0, len(document.Postings)+len(overrides.AddedPostings))
	for _, posting := range document.Postings {
		if !disabledPostings[posting.ID] {
			postings = append(postings, posting)
		}
	}
	postings = append(postings, overrides.AddedPostings...)
	rules := make([]RecurrenceRule, 0, len(document.RecurrenceRules)+len(overrides.AddedRules))
	for _, rule := range document.RecurrenceRules {
		if !disabledRules[rule.ID] {
			rules = append(rules, rule)
		}
	}
	rules = append(rules, overrides.AddedRules...)
	return FinancialModelDocument{
		SourcePath:      document.SourcePath,
		Accounts:        accounts,
		Checkpoints:     checkpoints,
		Evaluations:     document.Evaluations,
		Postings:        postings,
		RecurrenceRules: rules,
		PaymentTerms:    document.PaymentTerms,
	}
}

// AccountKinds returns every kind an account may declare, in display order.
func AccountKinds() []AccountKind {
	return accountKinds
}
