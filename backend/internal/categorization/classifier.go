// Package categorization derives a transaction category when the bank does
// not supply one the server supports. It is deliberately separate from
// evidence analysis: categories are editable sidecar metadata on transactions,
// while analysis findings never change the saved financial model.
package categorization

import (
	"context"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Input is one uncategorized bank transaction offered to a classifier.
type Input struct {
	TransactionID string
	Name          string
	Direction     string
	Facts         *types.TransactionFacts
}

// Classified is one classifier decision. Producer names the exact classifier
// version that supplied it, so the stored assignment records its origin.
type Classified struct {
	Category string
	Producer string
}

// Classifier maps uncategorized transactions onto the supported category keys.
// Missing transaction IDs stay uncategorized. Implementations must be safe for
// concurrent calls and must honor context cancellation.
type Classifier interface {
	Version() string
	Classify(ctx context.Context, inputs []Input) (map[string]Classified, error)
}

// KeywordClassifier is the deterministic mock implementation. It recognizes a
// small set of common merchant and description words. It is not a production
// classifier: unmatched rows stay uncategorized for a future provider.
type KeywordClassifier struct{}

// Version identifies the classifier composition in stored assignments.
func (KeywordClassifier) Version() string { return "keyword-v1" }

// Classify returns one category per recognized transaction.
func (c KeywordClassifier) Classify(ctx context.Context, inputs []Input) (map[string]Classified, error) {
	results := map[string]Classified{}
	for _, input := range inputs {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if category, ok := classifyKeyword(input); ok {
			results[input.TransactionID] = Classified{Category: category, Producer: c.Version()}
		}
	}
	return results, nil
}

func classifyKeyword(input Input) (string, bool) {
	text := strings.ToUpper(input.Name)
	if input.Facts != nil {
		text += " " + strings.ToUpper(input.Facts.Description)
		text += " " + strings.ToUpper(input.Facts.Payee)
		text += " " + strings.ToUpper(input.Facts.Memo)
		text += " " + strings.ToUpper(input.Facts.Metadata["merchant_name"])
		text += " " + strings.ToUpper(input.Facts.Metadata["payment_product"])
	}
	inflow := input.Direction == "in"

	switch {
	case inflow && containsAny(text, "PAYROLL", "DIRECT DEP", "DIRECT DEPOSIT", "SALARY", "PAYCHECK"):
		return types.CategoryIncome, true
	case containsAny(text, "KLARNA", "AFTERPAY", "AFFIRM", "LOAN PAYMENT", "AUTO LOAN", "STUDENT LOAN"):
		return types.CategoryLoanPayments, true
	case containsAny(text, "OVERDRAFT", "BANK FEE", "SERVICE FEE", "INTEREST CHARGE", "ATM FEE", "ANNUAL FEE"):
		return types.CategoryBankFees, true
	case containsAny(text, "TRANSFER", "XFER", "ZELLE", "WIRE TRANSFER"):
		if inflow {
			return types.CategoryTransferIn, true
		}
		return types.CategoryTransferOut, true
	case containsAny(text, "AIRLINE", "AIRLINES", "HOTEL", "AIRBNB", "EXPEDIA", "MARRIOTT", "HILTON", "DELTA AIR", "UNITED AIR"):
		return types.CategoryTravel, true
	case containsAny(text, "RENT", "APARTMENT", "ELECTRIC", "WATER BILL", "INTERNET", "COMCAST", "VERIZON", "AT&T", "UTILITY", "UTILITIES"):
		return types.CategoryRentAndUtilities, true
	case containsAny(text, "GROCERY", "GROCERIES", "SUPERMARKET", "WHOLE FOODS", "TRADER JOE", "SAFEWAY", "KROGER", "ALDI", "RESTAURANT", "CAFE", "COFFEE", "STARBUCKS", "MCDONALD", "DOORDASH", "GRUBHUB", "UBER EATS"):
		return types.CategoryFoodAndDrink, true
	case containsAny(text, "UBER", "LYFT", "SHELL", "CHEVRON", "EXXON", "GAS STATION", "PARKING", "TOLL", "TRANSIT", "METRO"):
		return types.CategoryTransportation, true
	case containsAny(text, "NETFLIX", "SPOTIFY", "HULU", "DISNEY+", "CINEMA", "THEATER", "THEATRE", "STEAM GAMES", "PLAYSTATION", "XBOX"):
		return types.CategoryEntertainment, true
	case containsAny(text, "PHARMACY", "CVS", "WALGREENS", "CLINIC", "HOSPITAL", "DENTAL", "MEDICAL", "DOCTOR"):
		return types.CategoryMedical, true
	case containsAny(text, "GYM", "SALON", "BARBER", "SPA", "FITNESS"):
		return types.CategoryPersonalCare, true
	case containsAny(text, "HOME DEPOT", "LOWES", "IKEA", "HARDWARE", "FURNITURE"):
		return types.CategoryHomeImprovement, true
	case containsAny(text, "IRS", "TAX PAYMENT", "DMV", "CHARITY", "DONATION", "NONPROFIT"):
		return types.CategoryGovernmentAndNonProfit, true
	case containsAny(text, "AMAZON", "WALMART", "TARGET", "EBAY", "ETSY", "BEST BUY", "COSTCO WHOLESALE", "CLOTHING", "BOOKSTORE"):
		return types.CategoryGeneralMerchandise, true
	case containsAny(text, "INSURANCE", "ACCOUNTING", "TAX PREP", "LAWYER", "SUBSCRIPTION", "SOFTWARE"):
		return types.CategoryGeneralServices, true
	}
	return "", false
}

func containsAny(text string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(text, needle) {
			return true
		}
	}
	return false
}
