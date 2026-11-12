package categorization

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// CategoryQuestion describes the domain hypothesis for one category key. The
// signal IDs name descriptor evidence observed on the transaction itself, plus
// the bank-category hint when the provider sent a raw category. No kind
// suggests without a signal: an uncategorized transaction stays valid.
func CategoryQuestion(key string) (support, candidate, exclude []string, inflowOnly, outflowOnly bool) {
	switch key {
	case types.CategoryIncome:
		return []string{"payroll-descriptor"}, []string{"bank-category-hint"}, []string{"transfer-descriptor"}, true, false
	case types.CategoryTransferIn:
		return []string{"transfer-descriptor"}, nil, nil, true, false
	case types.CategoryTransferOut:
		return []string{"transfer-descriptor"}, nil, nil, false, true
	case types.CategoryLoanPayments:
		return []string{"loan-descriptor"}, nil, nil, false, false
	case types.CategoryBankFees:
		return []string{"fee-descriptor"}, nil, nil, false, false
	case types.CategoryEntertainment:
		return []string{"entertainment-descriptor"}, nil, nil, false, false
	case types.CategoryFoodAndDrink:
		return []string{"food-descriptor"}, nil, nil, false, false
	case types.CategoryGeneralMerchandise:
		return []string{"merchandise-descriptor"}, nil, nil, false, false
	case types.CategoryHomeImprovement:
		return []string{"home-improvement-descriptor"}, nil, nil, false, false
	case types.CategoryMedical:
		return []string{"medical-descriptor"}, nil, nil, false, false
	case types.CategoryPersonalCare:
		return []string{"personal-care-descriptor"}, nil, nil, false, false
	case types.CategoryGeneralServices:
		return []string{"services-descriptor"}, []string{"bank-category-hint"}, nil, false, false
	case types.CategoryGovernmentAndNonProfit:
		return []string{"government-descriptor"}, nil, nil, false, false
	case types.CategoryTransportation:
		return []string{"transport-descriptor"}, nil, nil, false, false
	case types.CategoryTravel:
		return []string{"travel-descriptor"}, nil, nil, false, false
	case types.CategoryRentAndUtilities:
		return []string{"rent-descriptor", "utility-descriptor"}, []string{"bank-category-hint"}, nil, false, false
	default:
		return nil, nil, nil, false, false
	}
}
