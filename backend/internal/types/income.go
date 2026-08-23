package types

// IncomeSourceDefinition is one effective-dated annual gross income row.
type IncomeSourceDefinition struct {
	ID                string   `json:"id"`
	Label             string   `json:"label"`
	EffectiveFrom     IsoDate  `json:"effectiveFrom"`
	EffectiveTo       *IsoDate `json:"effectiveTo"`
	AnnualGrossIncome float64  `json:"annualGrossIncome"`
}

type IncomeTaxBracket struct {
	UpTo *float64 `json:"upTo"` // nil = open-ended
	Rate float64  `json:"rate"`
}

type IncomeTaxProfile struct {
	ID        string             `json:"id"`
	Label     string             `json:"label"`
	Deduction float64            `json:"deduction"`
	Brackets  []IncomeTaxBracket `json:"brackets"`
	SourceURL *string            `json:"sourceUrl"`
}

type IncomeDataSnapshot struct {
	IncomeSources []IncomeSourceDefinition `json:"incomeSources"`
	TaxProfiles   []IncomeTaxProfile       `json:"taxProfiles"`
}

func EmptyIncomeData() *IncomeDataSnapshot {
	return &IncomeDataSnapshot{
		IncomeSources: []IncomeSourceDefinition{},
		TaxProfiles:   []IncomeTaxProfile{},
	}
}
