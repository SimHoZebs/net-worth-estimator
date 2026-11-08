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
	EvaluationTypeFinancialIndependence  = "financialIndependence"
	EvaluationTypeNetWorthThreshold      = "netWorthThreshold"
	EvaluationTypeAccountBalance         = "accountBalance"
	EvaluationTypeTransactionFulfillment = "transactionFulfillment"
	EvaluationTypeCycleFulfillment       = "cycleFulfillment"
	EvaluationTypePlannedPurchases       = "plannedPurchases"
	EvaluationTypeWhatIf                 = "whatIf"
)

// EvaluationTypeOrder controls evaluation type ordering; table arrays
// preserve ingestion order within each type.
var EvaluationTypeOrder = []string{
	EvaluationTypeFinancialIndependence,
	EvaluationTypeNetWorthThreshold,
	EvaluationTypeAccountBalance,
	EvaluationTypeTransactionFulfillment,
	EvaluationTypeCycleFulfillment,
	EvaluationTypePlannedPurchases,
	EvaluationTypeWhatIf,
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

var accountKindSet = func() map[AccountKind]struct{} {
	set := make(map[AccountKind]struct{}, len(accountKinds))
	for _, kind := range accountKinds {
		set[kind] = struct{}{}
	}
	return set
}()

func (k AccountKind) Valid() bool {
	_, ok := accountKindSet[k]
	return ok
}

type Account struct {
	Display    *AccountDisplay `json:"display,omitempty"`
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Kind       AccountKind     `json:"kind"`
	MinBalance *float64        `json:"minBalance"` // nil = NoFloor sentinel on the wire
	MaxBalance *float64        `json:"maxBalance"` // nil = NoCeiling sentinel on the wire
	Color      *string         `json:"color"`
	Enabled    bool            `json:"enabled"`
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
	AccountID string  `json:"AccountId"`
	Balance   float64 `json:"Balance"`
	// AvailableBalance is bank-reported available cash or available credit.
	// Nil means unknown, not zero. It is evidence, never the net-worth
	// balance.
	AvailableBalance *float64 `json:"availableBalance,omitempty"`
	// Source names the row author: "user" for owner-authored rows,
	// "banksync" for bank-reported rows. Authorship never changes after
	// creation.
	Source string `json:"source,omitempty"`
	// ObservedAt is the required exact Unix instant the balance became that
	// amount. It is the sole temporal key: there is no canonical Date, no
	// zero sentinel, and no precision mode. Display days group by this
	// instant only at presentation boundaries.
	ObservedAt int64 `json:"observedAt"`
}

type CheckpointCorrection struct {
	AccountID       string  `json:"accountId"`
	ObservedBalance float64 `json:"observedBalance"`
	ModeledBalance  float64 `json:"modeledBalance"`
	Adjustment      float64 `json:"adjustment"`
}

type Frequency string

const (
	FrequencyDaily     Frequency = "daily"
	FrequencyWeekly    Frequency = "weekly"
	FrequencyMonthly   Frequency = "monthly"
	FrequencyQuarterly Frequency = "quarterly"
	FrequencyAnnual    Frequency = "annual"
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

type TransactionAmountResolution struct {
	Resolver string                        `json:"resolver"`
	Config   map[string]any                `json:"config"`
	Inputs   map[string]AmountInputBinding `json:"inputs"`
}

type TransactionClaim struct {
	// ScheduleID names the schedule whose occurrence this
	// transaction records. Always paired with OccurrenceDate; both are set
	// manually, never inferred.
	ScheduleID string `json:"scheduleId"`
	// OccurrenceDate is the scheduled occurrence this transaction replaces.
	// It is independent of posted and transaction times, so an early or
	// late actual can still claim its occurrence.
	OccurrenceDate IsoDate `json:"occurrenceDate"`
}

// Transaction is a single transaction with two times: posted time is when the
// bank posts it, transaction time is when the money moves. Both are Unix
// seconds. The UTC day of transaction time groups the transaction. Transactions
// never repeat; repetition is owned by Schedule, which expands into
// occurrences at projection time. A transaction with a Claim is an actual
// recorded against one scheduled occurrence of its rule.
type Transaction struct {
	ID              string                      `json:"id"`
	Name            string                      `json:"name"`
	SourceAccountID *string                     `json:"sourceAccountId"`
	Destinations    []string                    `json:"destinations"`
	Amount          TransactionAmountResolution `json:"amount"`
	PostedTime      int64                       `json:"postedTime"`
	TransactionTime int64                       `json:"transactionTime"`
	Claim           *TransactionClaim           `json:"claim,omitempty"`
	Enabled         bool                        `json:"enabled"`
	// Pending is bank lifecycle metadata, independent of identity and Enabled.
	// The sync sets it on arrival; the owner may clear it to settle the hold.
	Pending bool `json:"pending,omitempty"`
	// Source names the row author: "user" for owner-authored rows,
	// "banksync" for bank-reported rows. Authorship never changes after
	// creation. The sync may touch pending and void rows but never settled
	// ones. Owner writes may touch any row including pending and void rows.
	Source string `json:"source,omitempty"`
	// ExecutionOrder breaks equal-time ties independently of identity and display
	// position. The store assigns it on create and preserves it on owner updates.
	ExecutionOrder int64 `json:"executionOrder,omitempty"`
	// Void marks a bank authorization that vanished without settling. Only
	// the sync sets it through void-marking; model writes never create void
	// rows. The owner may clear it to restore the hold as settled.
	Void bool `json:"void,omitempty"`
}

// Schedule owns repetition. Its transaction fields are the template
// expanded into one occurrence per scheduled date; its schedule fields say
// when. Rules never move money themselves; expansion at projection time
// produces occurrences that execute exactly like transactions. Rate behavior
// (occurrence-rate, growth-factor, volatility) lives in the amount inputs,
// the same descriptors one-time transactions use; the rule contributes only
// schedule context (frequency divisor, start date).
type Schedule struct {
	ID              string                      `json:"id"`
	Name            string                      `json:"name"`
	SourceAccountID *string                     `json:"sourceAccountId"`
	Destinations    []string                    `json:"destinations"`
	Amount          TransactionAmountResolution `json:"amount"`
	Frequency       Frequency                   `json:"frequency"`
	StartDate       IsoDate                     `json:"startDate"`
	EndDate         *IsoDate                    `json:"endDate"`
	AnnualCap       *float64                    `json:"annualCap"`
	Priority        int                         `json:"priority"`
	Enabled         bool                        `json:"enabled"`
}

// FinancialModel is the complete collection of financial rows.
type FinancialModel struct {
	SourcePath       string            `json:"sourcePath"`
	Accounts         []Account         `json:"accounts"`
	Checkpoints      []Checkpoint      `json:"checkpoints"`
	Evaluations      EvaluationTables  `json:"evaluations"`
	Transactions     []Transaction     `json:"transactions"`
	Schedules        []Schedule        `json:"schedules"`
	PaymentTerms     []PaymentTerms    `json:"paymentTerms"`
	PlannedPurchases []PlannedPurchase `json:"plannedPurchases,omitempty"`
}

// PaymentTerms is mechanism config linked to one debt account. Accounts
// stay values only (balances, bounds, kind); terms carry the payment
// schedule: minimums, monthly due anchor, and the revolving statement anchor
// for cards. Terms never move money themselves; transactions remain the only
// transaction mechanism. The effective minimum combines MinimumFixed with
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
	AddedAccounts          []Account     `json:"addedAccounts"`
	AddedTransactions      []Transaction `json:"addedTransactions"`
	AddedRules             []Schedule    `json:"addedSchedules"`
	DisabledAccountIDs     []string      `json:"disabledAccountIds"`
	DisabledTransactionIDs []string      `json:"disabledTransactionIds"`
	DisabledScheduleIDs    []string      `json:"disabledScheduleIds"`
}

func EmptyModelOverrides() ModelOverrides {
	return ModelOverrides{
		AddedAccounts:          []Account{},
		AddedTransactions:      []Transaction{},
		AddedRules:             []Schedule{},
		DisabledAccountIDs:     []string{},
		DisabledTransactionIDs: []string{},
		DisabledScheduleIDs:    []string{},
	}
}

// ApplyModelOverrides builds the effective model without mutating the
// canonical input.
func ApplyModelOverrides(model FinancialModel, overrides ModelOverrides) FinancialModel {
	disabledAccounts := make(map[string]bool, len(overrides.DisabledAccountIDs))
	for _, id := range overrides.DisabledAccountIDs {
		disabledAccounts[id] = true
	}
	disabledTransactions := make(map[string]bool, len(overrides.DisabledTransactionIDs))
	for _, id := range overrides.DisabledTransactionIDs {
		disabledTransactions[id] = true
	}
	disabledRules := make(map[string]bool, len(overrides.DisabledScheduleIDs))
	for _, id := range overrides.DisabledScheduleIDs {
		disabledRules[id] = true
	}
	accounts := make([]Account, 0, len(model.Accounts)+len(overrides.AddedAccounts))
	for _, account := range model.Accounts {
		if !disabledAccounts[account.ID] {
			accounts = append(accounts, account)
		}
	}
	accounts = append(accounts, overrides.AddedAccounts...)
	accountIDSet := make(map[string]bool, len(accounts))
	for _, account := range accounts {
		accountIDSet[account.ID] = true
	}
	checkpoints := make([]Checkpoint, 0, len(model.Checkpoints))
	for _, checkpoint := range model.Checkpoints {
		if accountIDSet[checkpoint.AccountID] {
			checkpoints = append(checkpoints, checkpoint)
		}
	}
	transactions := make([]Transaction, 0, len(model.Transactions)+len(overrides.AddedTransactions))
	for _, transaction := range model.Transactions {
		if !disabledTransactions[transaction.ID] {
			transactions = append(transactions, transaction)
		}
	}
	transactions = append(transactions, overrides.AddedTransactions...)
	rules := make([]Schedule, 0, len(model.Schedules)+len(overrides.AddedRules))
	for _, rule := range model.Schedules {
		if !disabledRules[rule.ID] {
			rules = append(rules, rule)
		}
	}
	rules = append(rules, overrides.AddedRules...)
	return FinancialModel{
		SourcePath:       model.SourcePath,
		Accounts:         accounts,
		Checkpoints:      checkpoints,
		Evaluations:      model.Evaluations,
		Transactions:     transactions,
		Schedules:        rules,
		PaymentTerms:     model.PaymentTerms,
		PlannedPurchases: model.PlannedPurchases,
	}
}

// AccountKinds returns every kind an account may declare, in display order.
func AccountKinds() []AccountKind {
	return accountKinds
}
