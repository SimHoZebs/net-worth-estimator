package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func categoryFacts(description, category string) types.TransactionFacts {
	return types.TransactionFacts{
		Description: description,
		Amount:      "-42.00",
		Currency:    "USD",
		PostedTime:  1785628800,
		Metadata:    map[string]string{"category": category},
	}
}

func categoryUpsertDirective(posting types.Posting, provider, account, transaction string, facts types.TransactionFacts) BankDirective {
	return BankDirective{Upsert: &BankUpsert{
		Posting: posting,
		Keys:    bankKeys(provider, account, transaction),
		Facts:   &facts,
	}}
}

func loadedCategory(t *testing.T, s *sqliteStore, postingID string) types.PostingCategory {
	t.Helper()
	items, err := s.LoadPostingCategories([]string{postingID})
	if err != nil {
		t.Fatal(err)
	}
	return items[postingID]
}

func TestBankCategoryStoresOnFirstUpsertWithFacts(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	facts := categoryFacts("WHOLE FOODS MARKET", "FOOD_AND_DRINK_GROCERIES")
	applyDirectives(t, s, []BankDirective{
		categoryUpsertDirective(bankSeedPosting("WHOLE FOODS MARKET", "checking", "42.00", false), ProviderSimpleFIN, "bridge", "food", facts),
	})
	rows, err := s.LoadBankPostings()
	if err != nil || len(rows) != 1 {
		t.Fatalf("bank=%+v err=%v", rows, err)
	}
	id := rows[0].Posting.ID
	got := loadedCategory(t, s, id)
	if got.Category != types.CategoryFoodAndDrink || got.Source != types.CategorySourceBank || got.Producer != ProviderSimpleFIN {
		t.Fatalf("category=%+v", got)
	}
	var raw string
	if err := s.db.QueryRow(`SELECT facts_json FROM transaction_source_facts WHERE posting_id = ? AND user_id = :user_id`, id).Scan(&raw); err != nil {
		t.Fatalf("first upsert did not retain facts: %v", err)
	}
}

func TestUserCategoryWinsAndResetRestoresBankValue(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	applyDirectives(t, s, []BankDirective{
		categoryUpsertDirective(bankSeedPosting("WHOLE FOODS", "checking", "42.00", false), ProviderSimpleFIN, "bridge", "food", categoryFacts("WHOLE FOODS", "FOOD_AND_DRINK")),
	})
	id := mustBankPostingID(t, s)
	userCategory := types.CategoryMedical
	if _, err := s.SetUserPostingCategory(id, &userCategory); err != nil {
		t.Fatal(err)
	}
	// A later bank refresh with another supported value must not replace the
	// owner's choice.
	applyDirectives(t, s, []BankDirective{
		categoryUpsertDirective(bankSeedPosting("WHOLE FOODS", "checking", "48.00", false), ProviderSimpleFIN, "bridge", "food", categoryFacts("WHOLE FOODS", "GENERAL_MERCHANDISE")),
	})
	if got := loadedCategory(t, s, id); got.Category != types.CategoryMedical || got.Source != types.CategorySourceUser {
		t.Fatalf("user category lost: %+v", got)
	}
	if _, err := s.SetUserPostingCategory(id, nil); err != nil {
		t.Fatal(err)
	}
	if got := loadedCategory(t, s, id); got.Category != types.CategoryGeneralMerchandise || got.Source != types.CategorySourceBank {
		t.Fatalf("reset did not restore bank value: %+v", got)
	}
}

func TestResetWithoutBankValueClearsTheAssignment(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	applyDirectives(t, s, []BankDirective{
		categoryUpsertDirective(bankSeedPosting("LOCAL SHOP", "checking", "10.00", false), ProviderSimpleFIN, "bridge", "shop", categoryFacts("LOCAL SHOP", "UNKNOWN_PROVIDER_VALUE")),
	})
	id := mustBankPostingID(t, s)
	userCategory := types.CategoryGeneralMerchandise
	if _, err := s.SetUserPostingCategory(id, &userCategory); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetUserPostingCategory(id, nil); err != nil {
		t.Fatal(err)
	}
	if got := loadedCategory(t, s, id); got.Category != "" || got.Source != "" {
		t.Fatalf("reset kept a category: %+v", got)
	}
}

func TestInferredCategoryNeverReplacesBankOrUser(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	applyDirectives(t, s, []BankDirective{
		categoryUpsertDirective(bankSeedPosting("LOCAL SHOP", "checking", "10.00", false), ProviderSimpleFIN, "bridge", "shop", categoryFacts("LOCAL SHOP", "UNKNOWN_PROVIDER_VALUE")),
	})
	id := mustBankPostingID(t, s)
	if err := s.SetInferredPostingCategory(id, types.CategoryTravel, "keyword-v1"); err != nil {
		t.Fatal(err)
	}
	if got := loadedCategory(t, s, id); got.Category != types.CategoryTravel || got.Source != types.CategorySourceInferred {
		t.Fatalf("inferred category=%+v", got)
	}
	// A supported bank value replaces an inferred assignment.
	applyDirectives(t, s, []BankDirective{
		categoryUpsertDirective(bankSeedPosting("LOCAL SHOP", "checking", "10.00", false), ProviderSimpleFIN, "bridge", "shop", categoryFacts("LOCAL SHOP", "GENERAL_MERCHANDISE")),
	})
	if got := loadedCategory(t, s, id); got.Category != types.CategoryGeneralMerchandise || got.Source != types.CategorySourceBank {
		t.Fatalf("bank did not replace inferred: %+v", got)
	}
	if err := s.SetInferredPostingCategory(id, types.CategoryTravel, "keyword-v1"); err != nil {
		t.Fatal(err)
	}
	if got := loadedCategory(t, s, id); got.Source != types.CategorySourceBank {
		t.Fatalf("inferred replaced bank: %+v", got)
	}
	userCategory := types.CategoryMedical
	if _, err := s.SetUserPostingCategory(id, &userCategory); err != nil {
		t.Fatal(err)
	}
	if err := s.SetInferredPostingCategory(id, types.CategoryTravel, "keyword-v1"); err != nil {
		t.Fatal(err)
	}
	if got := loadedCategory(t, s, id); got.Source != types.CategorySourceUser || got.Category != types.CategoryMedical {
		t.Fatalf("inferred replaced user: %+v", got)
	}
}

func TestCategoryCandidatesSkipCategorizedVoidAndUserRows(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	applyDirectives(t, s, []BankDirective{
		categoryUpsertDirective(bankSeedPosting("PENDING HOLD", "checking", "12.00", true), ProviderSimpleFIN, "bridge", "pending", categoryFacts("PENDING HOLD", "")),
		categoryUpsertDirective(bankSeedPosting("SETTLED SHOP", "checking", "20.00", false), ProviderSimpleFIN, "bridge", "settled", categoryFacts("SETTLED SHOP", "GENERAL_MERCHANDISE")),
	})
	candidates, err := s.ListPostingCategoryCandidates(10)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("candidates=%+v err=%v", candidates, err)
	}
	if candidates[0].Name != "PENDING HOLD" || candidates[0].Direction != "out" {
		t.Fatalf("candidate=%+v", candidates[0])
	}
}

func TestDeletingPostingRemovesItsCategory(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	applyDirectives(t, s, []BankDirective{
		categoryUpsertDirective(bankSeedPosting("WHOLE FOODS", "checking", "42.00", false), ProviderSimpleFIN, "bridge", "food", categoryFacts("WHOLE FOODS", "FOOD_AND_DRINK")),
	})
	id := mustBankPostingID(t, s)
	if err := s.DeletePosting(id); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM posting_categories WHERE posting_id = ? AND user_id = :user_id`, id).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("category rows=%d", count)
	}
}

func TestCategoryAssignmentsStayUserScoped(t *testing.T) {
	d := openSharedTestDatabase(t)
	a, b := privateTestPlan(t, d, "a"), privateTestPlan(t, d, "b")
	seedAccount(t, a, "checking")
	seedAccount(t, b, "checking")
	facts := categoryFacts("WHOLE FOODS", "FOOD_AND_DRINK")
	applyDirectives(t, a, []BankDirective{
		categoryUpsertDirective(bankSeedPosting("WHOLE FOODS", "checking", "42.00", false), ProviderSimpleFIN, "bridge-a", "food", facts),
	})
	applyDirectives(t, b, []BankDirective{
		categoryUpsertDirective(bankSeedPosting("WHOLE FOODS", "checking", "42.00", false), ProviderSimpleFIN, "bridge-b", "food", facts),
	})
	idA, idB := mustBankPostingID(t, a), mustBankPostingID(t, b)
	userCategory := types.CategoryMedical
	if _, err := a.SetUserPostingCategory(idA, &userCategory); err != nil {
		t.Fatal(err)
	}
	if got := loadedCategory(t, a, idA); got.Category != types.CategoryMedical {
		t.Fatalf("a=%+v", got)
	}
	if got := loadedCategory(t, b, idB); got.Category != types.CategoryFoodAndDrink {
		t.Fatalf("b changed: %+v", got)
	}
	if _, err := b.SetUserPostingCategory(idA, &userCategory); !store.IsNotFound(err) {
		t.Fatalf("cross-user write=%v", err)
	}
}

func mustBankPostingID(t *testing.T, s *sqliteStore) string {
	t.Helper()
	rows, err := s.LoadBankPostings()
	if err != nil || len(rows) != 1 {
		t.Fatalf("bank=%+v err=%v", rows, err)
	}
	return rows[0].Posting.ID
}
