package domain

import (
	"math"
	"sort"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Posting observations and shared analysis helpers. Go is the owner of this
// pipeline.

// ---- Evidence ----

type EvidenceSource = string // source | lexical | rail | behavioral | user
type EvidenceStrength = string

const (
	StrengthWeak     = "weak"
	StrengthModerate = "moderate"
	StrengthStrong   = "strong"
)

type EvidenceItem struct {
	Code           string           `json:"code"`
	Source         EvidenceSource   `json:"source"`
	Strength       EvidenceStrength `json:"strength"`
	Message        string           `json:"message"`
	TransactionIDs []string         `json:"transactionIds,omitempty"`
}

type EvidenceSummary struct {
	Strength EvidenceStrength `json:"strength"`
	Items    []EvidenceItem   `json:"items"`
}

type AnalysisDiagnostic struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

// ---- Posting observations ----

type PostingObservation struct {
	ID               string   `json:"id"`
	PostingID        string   `json:"postingId"`
	AccountID        string   `json:"accountId"`
	BookedDate       string   `json:"bookedDate"`
	Amount           *float64 `json:"amount"`
	Currency         string   `json:"currency"`
	Description      string   `json:"description"`
	CounterpartyName *string  `json:"counterpartyName"`
}

type PostingObservationDataset struct {
	Postings []PostingObservation `json:"postings"`
}

// BuildPostingObservationDataset derives observations from enabled once
// external-inflow postings.
func BuildPostingObservationDataset(document *types.FinancialModelDocument) *PostingObservationDataset {
	dataset := &PostingObservationDataset{Postings: []PostingObservation{}}
	for index := range document.Postings {
		posting := &document.Postings[index]
		if !posting.Enabled || posting.Frequency != types.FrequencyOnce ||
			posting.SourceAccountID != nil || len(posting.Destinations) == 0 {
			continue
		}
		var amount *float64
		if expression, ok := posting.Amount.Config["expression"]; ok && len(posting.Amount.Inputs) == 0 {
			if expressionText, isString := expression.(string); isString {
				resolved, err := ResolvePostingAmountDescriptor(posting.Amount, &AmountProviderContext{
					Balances:                     map[string]float64{},
					LatestRealizedPostingAmounts: map[string]float64{},
					RealizedPostingAmountsByYear: map[string]map[string]float64{},
					Date:                         posting.StartDate,
					OccurrenceRate:               0,
				})
				if err == nil && !math.IsNaN(resolved) && !math.IsInf(resolved, 0) {
					value := resolved
					amount = &value
				}
				_ = expressionText
			}
		}
		dataset.Postings = append(dataset.Postings, PostingObservation{
			ID:               posting.ID,
			PostingID:        posting.ID,
			AccountID:        posting.Destinations[0],
			BookedDate:       posting.StartDate,
			Amount:           amount,
			Currency:         "USD",
			Description:      posting.Label,
			CounterpartyName: nil,
		})
	}
	sort.SliceStable(dataset.Postings, func(i, j int) bool {
		if dataset.Postings[i].BookedDate != dataset.Postings[j].BookedDate {
			return dataset.Postings[i].BookedDate < dataset.Postings[j].BookedDate
		}
		return dataset.Postings[i].ID < dataset.Postings[j].ID
	})
	return dataset
}

// ---- Shared statistics helpers (single definition for payroll/salary) ----

func medianOf(values []float64) float64 {
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	middle := len(sorted) / 2
	if len(sorted)%2 == 0 {
		return (sorted[middle-1] + sorted[middle]) / 2
	}
	return sorted[middle]
}

func quantileOf(values []float64, percentile float64) float64 {
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	if len(sorted) == 0 {
		return 0
	}
	index := float64(len(sorted)-1) * percentile
	lower := int(math.Floor(index))
	fraction := index - float64(lower)
	next := lower + 1
	if next > len(sorted)-1 {
		next = len(sorted) - 1
	}
	return sorted[lower] + fraction*(sorted[next]-sorted[lower])
}

func idsOf(transactions []PayrollCandidateTransaction) []string {
	out := make([]string, len(transactions))
	for i, tx := range transactions {
		out[i] = tx.ID
	}
	return out
}
