package types

import "testing"

func TestBankCategoryAcceptsSupportedAndDetailedValues(t *testing.T) {
	cases := map[string]string{
		"FOOD_AND_DRINK":                  CategoryFoodAndDrink,
		"food_and_drink_groceries":        CategoryFoodAndDrink,
		"RENT_AND_UTILITIES_RENT":         CategoryRentAndUtilities,
		"LOAN_PAYMENTS_CREDIT_CARD":       CategoryLoanPayments,
		"  transportation  ":              CategoryTransportation,
		"transfer_in":                     CategoryTransferIn,
		"GOVERNMENT_AND_NON_PROFIT_TAXES": CategoryGovernmentAndNonProfit,
	}
	for value, want := range cases {
		if got, ok := BankCategory(value); !ok || got != want {
			t.Fatalf("BankCategory(%q) = %q, %v; want %q", value, got, ok, want)
		}
	}
}

func TestBankCategoryMapsCommonProviderAliases(t *testing.T) {
	cases := map[string]string{
		"food":      CategoryFoodAndDrink,
		"groceries": CategoryFoodAndDrink,
		"shopping":  CategoryGeneralMerchandise,
		"utilities": CategoryRentAndUtilities,
		"health":    CategoryMedical,
		"salary":    CategoryIncome,
	}
	for value, want := range cases {
		if got, ok := BankCategory(value); !ok || got != want {
			t.Fatalf("BankCategory(%q) = %q, %v; want %q", value, got, ok, want)
		}
	}
}

func TestBankCategoryLeavesUnknownValuesForTheClassifier(t *testing.T) {
	for _, value := range []string{"", "mystery", "TRANSFER", "PETS", "GAMBLING"} {
		if got, ok := BankCategory(value); ok {
			t.Fatalf("BankCategory(%q) = %q, want unknown", value, got)
		}
	}
}

func TestValidCategoryUsesTheExactSupportedSet(t *testing.T) {
	for _, key := range append(CategoryKeys, " INCOME ") {
		if !ValidCategory(key) {
			t.Fatalf("ValidCategory(%q) = false", key)
		}
	}
	for _, value := range []string{"food", "FOOD_AND_DRINK_GROCERIES", ""} {
		if ValidCategory(value) {
			t.Fatalf("ValidCategory(%q) = true", value)
		}
	}
}
