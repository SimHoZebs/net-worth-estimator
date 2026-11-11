package analysis

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func validatePaymentClassifications(definitions []PaymentClassification) error {
	seen := map[string]bool{}
	for _, d := range definitions {
		if d.ID == "" || len(d.ID) > 128 || d.Label == "" || len(d.Label) > 128 || seen[d.ID] || (d.Direction != "inflow" && d.Direction != "outflow") {
			return fmt.Errorf("payment classifications require unique bounded IDs, labels and a direction")
		}
		seen[d.ID] = true
	}
	return nil
}

// PaymentClassification is an ordinary semantic variant, not its own runner,
// persistence store, transport, or feature vector. Signals refer to domain evidence.
type PaymentClassification struct {
	ID                   string
	Label                string
	Direction            string
	SupportSignals       []string
	CandidateSignals     []string
	ExcludeSignals       []string
	SuggestWithoutSignal bool
	RankMain             bool
	RequireRecurrence    bool
	ExternalOnly         bool
}

func PaymentClassifications() []PaymentClassification {
	return []PaymentClassification{
		{ID: "income", Label: "income", Direction: "inflow", SupportSignals: []string{"payroll-descriptor", "source-income"}, CandidateSignals: []string{"regular-cadence"}, RankMain: true, ExternalOnly: true},
		{ID: "rent", Label: "rent", Direction: "outflow", SupportSignals: []string{"rent-descriptor", "source-rent"}, CandidateSignals: []string{"housing-platform"}, ExcludeSignals: []string{"card-repayment", "mortgage-descriptor", "non-rent-charge", "utility-descriptor", "insurance-descriptor"}, ExternalOnly: true},
		{ID: "utility", Label: "utility", Direction: "outflow", SupportSignals: []string{"utility-descriptor"}, CandidateSignals: []string{"utility-provider"}, ExcludeSignals: []string{"card-repayment", "mortgage-descriptor"}, ExternalOnly: true},
		{ID: "auto-insurance", Label: "auto insurance", Direction: "outflow", SupportSignals: []string{"insurance-descriptor"}, CandidateSignals: []string{"insurance-provider"}, ExcludeSignals: []string{"card-repayment", "mortgage-descriptor"}, ExternalOnly: true},
		{ID: "card-payment", Label: "card payment", Direction: "outflow", SupportSignals: []string{"card-repayment"}, CandidateSignals: []string{"card-issuer"}, ExcludeSignals: []string{"mortgage-descriptor"}, ExternalOnly: true},
	}
}

var rentDescriptor = regexp.MustCompile(`(?i)\b(rent|rental|lease|biltrent)\b`)
var mortgageDescriptor = regexp.MustCompile(`(?i)\b(mortgage|home[ _-]*loan)\b`)
var cardRepayment = regexp.MustCompile(`(?i)\b(credit[ _-]*card|card[ _-]*(payment|repayment))\b`)
var nonRentCharge = regexp.MustCompile(`(?i)\b(utilities|utility|parking|security[ _-]*deposit|hoa|association[ _-]*dues)\b`)

// Brand names are documented evidence, never claimed bank-statement descriptors.
// See docs/rent-platform-evidence.md for primary sources and ambiguity limits.
var housingPlatform = regexp.MustCompile(`(?i)\b(bilt|rent[ _-]*cafe|click[ _-]*pay|zego|appfolio|foliospace|zillow|buildium|avail)\b`)

// utilityDescriptor matches generic service words only, never provider names.
// Provider identity resolves lazily through ProviderResolver instead.
var utilityDescriptor = regexp.MustCompile(`(?i)\b(utility|utilities|electric|electricity|energy|water|gas|power|sewer|trash|waste|internet|broadband)\b`)

// insuranceDescriptor matches generic insurance words plus a bounded set of
// top US national carrier names. Regional carriers and brokers resolve lazily
// through ProviderResolver instead.
var insuranceDescriptor = regexp.MustCompile(`(?i)\b(insurance|insurer|auto[ _-]*insurance|car[ _-]*insurance|geico|progressive|state[ _-]*farm|allstate|usaa|liberty[ _-]*mutual|farmers|nationwide|travelers|american[ _-]*family)\b`)

var paymentTextSignals = []struct {
	id      string
	pattern *regexp.Regexp
}{
	{"payroll-descriptor", payrollDescriptor}, {"rent-descriptor", rentDescriptor},
	{"mortgage-descriptor", mortgageDescriptor}, {"card-repayment", cardRepayment},
	{"non-rent-charge", nonRentCharge}, {"housing-platform", housingPlatform},
	{"utility-descriptor", utilityDescriptor}, {"insurance-descriptor", insuranceDescriptor},
}

func paymentSignals(items []paymentOccurrence) []string {
	signals := map[string]bool{}
	for _, item := range items {
		text := item.text
		for _, rule := range paymentTextSignals {
			if rule.pattern.MatchString(text) {
				signals[rule.id] = true
			}
		}
		category := item.transaction.Facts.Metadata["category"]
		if cat, ok := types.BankCategory(category); ok && cat == types.CategoryIncome {
			signals["source-income"] = true
		}
		if strings.EqualFold(category, "RENT") {
			signals["source-rent"] = true
		}
	}
	result := make([]string, 0, len(signals))
	for signal := range signals {
		result = append(result, signal)
	}
	sort.Strings(result)
	return result
}

func (p *classifiedPayment) deterministicDecision() string {
	return deterministicPaymentDecision(p.classification, p.signals)
}

// deterministicPaymentDecision applies classification policy to observed
// signals. The incremental path reuses it for carried-forward candidates
// whose statistics stay cached.
func deterministicPaymentDecision(classification PaymentClassification, signals []string) string {
	has := map[string]bool{}
	for _, s := range signals {
		has[s] = true
	}
	for _, s := range classification.ExcludeSignals {
		if has[s] {
			return "unsupported"
		}
	}
	for _, s := range classification.SupportSignals {
		if has[s] {
			return "supported"
		}
	}
	for _, s := range classification.CandidateSignals {
		if has[s] {
			return "uncertain"
		}
	}
	if classification.SuggestWithoutSignal {
		return "uncertain"
	}
	return "unsupported"
}
func (p *classifiedPayment) decision() string {
	if p.judgment != nil && p.judgment.Status == "ready" {
		return p.judgment.Decision
	}
	return p.deterministicDecision()
}
