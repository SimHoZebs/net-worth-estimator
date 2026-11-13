package types

import "strings"

// Transaction categories mirror the Plaid personal finance primary taxonomy.
// The set lives in code: there is no category taxonomy table. Bank values are
// hints, and only these keys are stored or returned.
const (
	CategoryIncome                 = "INCOME"
	CategoryTransferIn             = "TRANSFER_IN"
	CategoryTransferOut            = "TRANSFER_OUT"
	CategoryLoanPayments           = "LOAN_PAYMENTS"
	CategoryBankFees               = "BANK_FEES"
	CategoryEntertainment          = "ENTERTAINMENT"
	CategoryFoodAndDrink           = "FOOD_AND_DRINK"
	CategoryGeneralMerchandise     = "GENERAL_MERCHANDISE"
	CategoryHomeImprovement        = "HOME_IMPROVEMENT"
	CategoryMedical                = "MEDICAL"
	CategoryPersonalCare           = "PERSONAL_CARE"
	CategoryGeneralServices        = "GENERAL_SERVICES"
	CategoryGovernmentAndNonProfit = "GOVERNMENT_AND_NON_PROFIT"
	CategoryTransportation         = "TRANSPORTATION"
	CategoryTravel                 = "TRAVEL"
	CategoryRentAndUtilities       = "RENT_AND_UTILITIES"
)

// CategorySource names where the current assignment came from. User always
// wins; a bank value replaces an inferred one but never a user assignment.
const (
	CategorySourceBank     = "bank"
	CategorySourceInferred = "inferred"
	CategorySourceUser     = "user"
)

// CategoryKeys is the complete supported set in display order.
var CategoryKeys = []string{
	CategoryIncome,
	CategoryTransferIn,
	CategoryTransferOut,
	CategoryLoanPayments,
	CategoryBankFees,
	CategoryEntertainment,
	CategoryFoodAndDrink,
	CategoryGeneralMerchandise,
	CategoryHomeImprovement,
	CategoryMedical,
	CategoryPersonalCare,
	CategoryGeneralServices,
	CategoryGovernmentAndNonProfit,
	CategoryTransportation,
	CategoryTravel,
	CategoryRentAndUtilities,
}

var categoryKeySet = func() map[string]bool {
	keys := make(map[string]bool, len(CategoryKeys))
	for _, key := range CategoryKeys {
		keys[key] = true
	}
	return keys
}()

// bankCategoryAliases maps common provider spellings onto the supported set.
// These are hints, not a second taxonomy: an unknown value falls through to
// the classifier instead of being stored verbatim.
var bankCategoryAliases = map[string]string{
	"FOOD":          CategoryFoodAndDrink,
	"GROCERY":       CategoryFoodAndDrink,
	"GROCERIES":     CategoryFoodAndDrink,
	"DINING":        CategoryFoodAndDrink,
	"RESTAURANT":    CategoryFoodAndDrink,
	"SHOPPING":      CategoryGeneralMerchandise,
	"TRANSPORT":     CategoryTransportation,
	"HEALTH":        CategoryMedical,
	"HEALTHCARE":    CategoryMedical,
	"UTILITIES":     CategoryRentAndUtilities,
	"FEE":           CategoryBankFees,
	"FEES":          CategoryBankFees,
	"LOAN":          CategoryLoanPayments,
	"RENT":          CategoryRentAndUtilities,
	"BILLS":         CategoryRentAndUtilities,
	"SALARY":        CategoryIncome,
	"PAYROLL":       CategoryIncome,
	"DIVIDEND":      CategoryIncome,
	"DIVIDENDS":     CategoryIncome,
	"INTEREST":      CategoryIncome,
	"SUBSCRIPTION":  CategoryEntertainment,
	"SUBSCRIPTIONS": CategoryEntertainment,
}

// ValidCategory reports whether value names one supported category key.
func ValidCategory(value string) bool {
	return categoryKeySet[strings.TrimSpace(value)]
}

// BankCategory maps one provider category onto the supported set. It trims and
// canonicalizes case, accepts a supported key or a detailed value whose first
// segment is supported, then applies common aliases. Unknown values return
// false so the asynchronous classifier can decide.
func BankCategory(value string) (string, bool) {
	normalized := normalizeCategoryToken(value)
	if normalized == "" {
		return "", false
	}
	if categoryKeySet[normalized] {
		return normalized, true
	}
	// Detailed values keep a supported primary as their first segment. The
	// primary itself may contain underscores, so match full keys rather than
	// splitting on the first underscore.
	for _, key := range CategoryKeys {
		if strings.HasPrefix(normalized, key+"_") {
			return key, true
		}
	}
	if alias, ok := bankCategoryAliases[normalized]; ok {
		return alias, true
	}
	return "", false
}

func normalizeCategoryToken(value string) string {
	value = strings.TrimSpace(strings.ToUpper(value))
	value = strings.ReplaceAll(value, "-", "_")
	value = strings.ReplaceAll(value, " ", "_")
	return value
}

// TransactionCategory is the current category assignment for one transaction. Source
// names the producer kind; Producer names the exact bank or classifier that
// supplied it.
type TransactionCategory struct {
	TransactionID string `json:"transactionId"`
	Category      string `json:"category"`
	Source        string `json:"source"`
	Producer      string `json:"producer,omitempty"`
}

// TransactionCategoryCandidate is one uncategorized bank transaction offered to the
// classifier. Facts stay raw evidence and never leave the server scope.
type TransactionCategoryCandidate struct {
	TransactionID string
	Name          string
	Direction     string
	Facts         *TransactionFacts
}

// CategoryFeedbackAction names the user intent behind one journal row.
const (
	// CategoryFeedbackAssign records a user assignment to the named category.
	CategoryFeedbackAssign = "assign"
	// CategoryFeedbackClear records a user clear; Category names the removed key.
	CategoryFeedbackClear = "clear"
)

// CategoryFeedback is one immutable row of the append-only category journal.
// Every user assign and clear appends exactly one row in the same
// transaction as the sidecar write. Action is assign or clear; Category is
// the assigned key for assigns and the removed key for clears (nil when a
// clear removed nothing). Name, Direction, and Facts snapshot the bank row
// at review time so training rebuilds the exact serving request later.
// CreatedAt is unix seconds. ID is the zero-padded sequence: fixed width
// so lexicographic order matches sequence order.
type CategoryFeedback struct {
	Seq           int64             `json:"seq"`
	ID            string            `json:"id"`
	TransactionID string            `json:"transactionId"`
	Action        string            `json:"action"`
	Category      *string           `json:"category,omitempty"`
	Name          string            `json:"name"`
	Direction     string            `json:"direction"`
	Facts         *TransactionFacts `json:"facts,omitempty"`
	CreatedAt     int64             `json:"createdAt"`
}

// UserCategoryLabel is one transaction whose current intent is a user
// assignment, with the bank evidence joined. Newest first.
type UserCategoryLabel struct {
	TransactionID string
	Category      string
	Name          string
	Direction     string
	Facts         *TransactionFacts
}
