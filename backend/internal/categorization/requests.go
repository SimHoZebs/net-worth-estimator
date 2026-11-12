package categorization

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// categoryDescriptorSignals matches the keyword classifier's vocabulary against
// the transaction text. Each entry emits its signal ID when any needle appears.
var categoryDescriptorSignals = []struct {
	id      string
	needles []string
}{
	{"payroll-descriptor", []string{"PAYROLL", "DIRECT DEP", "SALARY", "PAYCHECK"}},
	{"loan-descriptor", []string{"KLARNA", "AFTERPAY", "AFFIRM", "LOAN"}},
	{"fee-descriptor", []string{"OVERDRAFT", "BANK FEE", "SERVICE FEE", "INTEREST CHARGE", "ATM FEE", "ANNUAL FEE"}},
	{"transfer-descriptor", []string{"TRANSFER", "XFER", "ZELLE", "WIRE"}},
	{"travel-descriptor", []string{"AIRLINE", "HOTEL", "AIRBNB", "EXPEDIA", "MARRIOTT", "HILTON", "DELTA"}},
	{"rent-descriptor", []string{"RENT", "APARTMENT", "LEASE"}},
	{"utility-descriptor", []string{"ELECTRIC", "WATER", "INTERNET", "COMCAST", "VERIZON", "AT&T", "UTILITY", "UTILITIES"}},
	{"food-descriptor", []string{"GROCERY", "GROCERIES", "SUPERMARKET", "WHOLE FOODS", "TRADER JOE", "SAFEWAY", "KROGER", "ALDI", "RESTAURANT", "CAFE", "COFFEE", "STARBUCKS", "MCDONALD", "DOORDASH", "GRUBHUB", "UBER EATS"}},
	{"transport-descriptor", []string{"UBER", "LYFT", "SHELL", "CHEVRON", "EXXON", "GAS STATION", "PARKING", "TOLL", "TRANSIT", "METRO"}},
	{"entertainment-descriptor", []string{"NETFLIX", "SPOTIFY", "HULU", "DISNEY", "CINEMA", "THEATER", "THEATRE", "STEAM", "PLAYSTATION", "XBOX"}},
	{"medical-descriptor", []string{"PHARMACY", "CVS", "WALGREENS", "CLINIC", "HOSPITAL", "DENTAL", "MEDICAL", "DOCTOR"}},
	{"personal-care-descriptor", []string{"GYM", "SALON", "BARBER", "SPA", "FITNESS"}},
	{"home-improvement-descriptor", []string{"HOME DEPOT", "LOWES", "IKEA", "HARDWARE", "FURNITURE"}},
	{"government-descriptor", []string{"IRS", "TAX", "DMV", "CHARITY", "DONATION", "NONPROFIT"}},
	{"merchandise-descriptor", []string{"AMAZON", "WALMART", "TARGET", "EBAY", "ETSY", "BEST BUY", "COSTCO", "CLOTHING", "BOOKSTORE"}},
	{"services-descriptor", []string{"INSURANCE", "ACCOUNTING", "TAX PREP", "LAWYER", "SUBSCRIPTION", "SOFTWARE"}},
}

// observeCategorySignals returns the sorted signal IDs observed on one
// transaction. The bank-category hint fires when the provider sent any raw
// category value, even one outside the supported set.
func observeCategorySignals(input Input) []string {
	text := strings.ToUpper(input.Name)
	var metadata map[string]string
	if input.Facts != nil {
		text += " " + strings.ToUpper(input.Facts.Description)
		text += " " + strings.ToUpper(input.Facts.Payee)
		text += " " + strings.ToUpper(input.Facts.Memo)
		text += " " + strings.ToUpper(input.Facts.Metadata["merchant_name"])
		text += " " + strings.ToUpper(input.Facts.Metadata["payment_product"])
		metadata = input.Facts.Metadata
	}
	seen := map[string]bool{}
	for _, rule := range categoryDescriptorSignals {
		for _, needle := range rule.needles {
			if strings.Contains(text, needle) {
				seen[rule.id] = true
				break
			}
		}
	}
	if strings.TrimSpace(metadata["category"]) != "" {
		seen["bank-category-hint"] = true
	}
	signals := make([]string, 0, len(seen))
	for signal := range seen {
		signals = append(signals, signal)
	}
	sort.Strings(signals)
	return signals
}

// CategoryJudgmentRequests builds one judgment request per direction-eligible
// category kind for a single transaction. Kinds without at least one observed
// support or candidate signal are skipped, so a transaction with no evidence
// emits nothing and stays uncategorized.
func CategoryJudgmentRequests(input Input) []types.AnalysisJudgmentInput {
	observed := observeCategorySignals(input)
	present := map[string]bool{}
	for _, signal := range observed {
		present[signal] = true
	}
	inflow := input.Direction == "in"
	direction := "outflow"
	if inflow {
		direction = "inflow"
	}
	var currency, amount string
	var samples []types.TransactionFacts
	if input.Facts != nil {
		currency = input.Facts.Currency
		amount = input.Facts.Amount
		samples = []types.TransactionFacts{*input.Facts}
	} else {
		samples = []types.TransactionFacts{{}}
	}
	typical := "0"
	if trimmed := strings.TrimSpace(amount); trimmed != "" {
		// Bank amounts are signed; the learner evidence layer requires a
		// non-negative magnitude, so normalize exactly like the eval path.
		if value, err := strconv.ParseFloat(trimmed, 64); err == nil && !math.IsNaN(value) && !math.IsInf(value, 0) {
			typical = strconv.FormatFloat(math.Abs(value), 'f', 2, 64)
		}
	}
	patternID := sha256.Sum256([]byte("category\x00" + input.TransactionID))
	merchant := string([]rune(input.Name))
	if len([]rune(merchant)) > 256 {
		merchant = string([]rune(merchant)[:256])
	}
	requests := []types.AnalysisJudgmentInput{}
	for _, key := range types.CategoryKeys {
		support, candidate, exclude, inflowOnly, outflowOnly := CategoryQuestion(key)
		if inflowOnly && !inflow {
			continue
		}
		if outflowOnly && inflow {
			continue
		}
		matched := false
		for _, signal := range support {
			if present[signal] {
				matched = true
				break
			}
		}
		if !matched {
			for _, signal := range candidate {
				if present[signal] {
					matched = true
					break
				}
			}
		}
		if !matched {
			continue
		}
		request := types.AnalysisJudgmentInput{
			Kind: "category:" + key, PatternID: hex.EncodeToString(patternID[:]), Samples: samples,
			Question: types.JudgmentQuestion{Label: key,
				SupportSignals: support, CandidateSignals: candidate, ExcludeSignals: exclude},
			Pattern: types.JudgmentPattern{
				Merchant: merchant, Currency: currency, TypicalAmount: typical,
				OccurrenceCount: 1, Direction: direction, Signals: observed,
			},
		}
		data, _ := json.Marshal(request) // The struct holds only finite values.
		hash := sha256.Sum256(data)
		request.ID = hex.EncodeToString(hash[:])
		requests = append(requests, request)
	}
	return requests
}
