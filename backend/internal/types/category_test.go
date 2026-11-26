package types

import (
	"encoding/hex"
	"testing"
)

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

func TestCategoryEvidenceHashFingerprintsExactEvidence(t *testing.T) {
	base := CategoryEvidenceHash("MERCHANT", "out", `{"amount":"-12.00","memo":"A"}`)
	if len(base) != 64 {
		t.Fatalf("hash length=%d", len(base))
	}
	if _, err := hex.DecodeString(base); err != nil {
		t.Fatalf("hash is not hex: %v", err)
	}
	if got := CategoryEvidenceHash("MERCHANT", "out", `{"amount":"-12.00","memo":"A"}`); got != base {
		t.Fatal("same evidence produced a different hash")
	}
	for _, got := range []string{
		CategoryEvidenceHash("OTHER MERCHANT", "out", `{"amount":"-12.00","memo":"A"}`),
		CategoryEvidenceHash("MERCHANT", "in", `{"amount":"-12.00","memo":"A"}`),
		CategoryEvidenceHash("MERCHANT", "out", `{"memo":"A","amount":"-12.00"}`),
		CategoryEvidenceHash("MERCHANT", "out", ""),
	} {
		if got == base {
			t.Fatal("changed evidence kept the same hash")
		}
	}
	if CategoryEvidenceHash("a", "bc", "") == CategoryEvidenceHash("ab", "c", "") {
		t.Fatal("hash omitted field boundaries")
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
