package sqlite

import (
	"fmt"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func mustJournalBankTransaction(t *testing.T, s *sqliteStore, name, bankKey, category string) string {
	t.Helper()
	applyDirectives(t, s, []BankDirective{
		categoryUpsertDirective(bankSeedTransaction(name, "checking", "42.00", false), ProviderSimpleFIN, "bridge", bankKey, categoryFacts(name, category)),
	})
	rows, err := s.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		var count int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM transaction_sync_keys WHERE transaction_id = ? AND bank_transaction_id = ? AND user_id = :user_id`, row.Transaction.ID, bankKey).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count == 1 {
			return row.Transaction.ID
		}
	}
	t.Fatalf("bank row %s not found", bankKey)
	return ""
}

func journalRows(t *testing.T, s *sqliteStore) []types.CategoryFeedback {
	t.Helper()
	items, err := s.ListCategoryFeedback("", 1000)
	if err != nil {
		t.Fatal(err)
	}
	return items
}

func TestCategoryJournalAssignAndClear(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	id := mustJournalBankTransaction(t, s, "WHOLE FOODS", "food", "FOOD_AND_DRINK")
	medical := types.CategoryMedical
	if _, err := s.SetUserTransactionCategory(id, &medical); err != nil {
		t.Fatal(err)
	}
	rows := journalRows(t, s)
	if len(rows) != 1 {
		t.Fatalf("journal=%+v", rows)
	}
	row := rows[0]
	if row.Action != types.CategoryFeedbackAssign || row.Category == nil || *row.Category != types.CategoryMedical {
		t.Fatalf("assign row=%+v", row)
	}
	if row.TransactionID != id || row.Name == "" || row.Direction == "" || row.Facts == nil || row.CreatedAt <= 0 {
		t.Fatalf("assign snapshot incomplete=%+v", row)
	}
	if row.ID != fmt.Sprintf("%020d", row.Seq) || len(row.ID) != 20 {
		t.Fatalf("unstable row ID=%q", row.ID)
	}
	if _, err := s.SetUserTransactionCategory(id, nil); err != nil {
		t.Fatal(err)
	}
	rows = journalRows(t, s)
	if len(rows) != 2 || rows[1].Seq <= rows[0].Seq {
		t.Fatalf("journal=%+v", rows)
	}
	clear := rows[1]
	if clear.Action != types.CategoryFeedbackClear || clear.Category == nil || *clear.Category != types.CategoryMedical {
		t.Fatalf("clear row must carry the removed key=%+v", clear)
	}
}

func TestCategoryJournalClearWithoutAssignmentCarriesNil(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	id := mustJournalBankTransaction(t, s, "LOCAL SHOP", "shop", "UNKNOWN_PROVIDER_VALUE")
	if got := loadedCategory(t, s, id); got.Category != "" {
		t.Fatalf("seed leaked a category=%+v", got)
	}
	if _, err := s.SetUserTransactionCategory(id, nil); err != nil {
		t.Fatal(err)
	}
	rows := journalRows(t, s)
	if len(rows) != 1 || rows[0].Action != types.CategoryFeedbackClear || rows[0].Category != nil {
		t.Fatalf("no-op clear must journal a nil removed key=%+v", rows)
	}
}

func TestCategoryJournalClearOfBankValueCarriesBankKey(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	id := mustJournalBankTransaction(t, s, "WHOLE FOODS", "food", "FOOD_AND_DRINK")
	if _, err := s.SetUserTransactionCategory(id, nil); err != nil {
		t.Fatal(err)
	}
	rows := journalRows(t, s)
	if len(rows) != 1 || rows[0].Action != types.CategoryFeedbackClear {
		t.Fatalf("journal=%+v", rows)
	}
	if rows[0].Category == nil || *rows[0].Category != types.CategoryFoodAndDrink {
		t.Fatalf("clear of a bank suggestion must carry the bank key=%+v", rows[0])
	}
}

func TestCategoryJournalOrderingAndPagination(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	id := mustJournalBankTransaction(t, s, "WHOLE FOODS", "food", "")
	for _, key := range []string{types.CategoryMedical, types.CategoryTravel, types.CategoryFoodAndDrink} {
		category := key
		if _, err := s.SetUserTransactionCategory(id, &category); err != nil {
			t.Fatal(err)
		}
	}
	head, err := s.ListCategoryFeedback("", 2)
	if err != nil || len(head) != 2 {
		t.Fatalf("head=%+v err=%v", head, err)
	}
	for index, row := range head {
		if row.ID != fmt.Sprintf("%020d", row.Seq) || len(row.ID) != 20 {
			t.Fatalf("row %d has an unstable ID=%q", index, row.ID)
		}
		if index > 0 && head[index-1].ID >= row.ID {
			t.Fatalf("journal out of order=%+v", head)
		}
	}
	tail, err := s.ListCategoryFeedback(head[1].ID, 10)
	if err != nil || len(tail) != 1 || tail[0].Category == nil || *tail[0].Category != types.CategoryFoodAndDrink {
		t.Fatalf("tail=%+v err=%v", tail, err)
	}
	if _, err := s.ListCategoryFeedback("not-a-cursor", 10); err == nil {
		t.Fatal("corrupt cursor was accepted")
	}
}

func TestCategoryJournalAtomicWithSidecar(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	id := mustJournalBankTransaction(t, s, "WHOLE FOODS", "food", "")
	// Create the journal table through the public read path, then make its
	// insert fail while the category write would otherwise succeed. The owner
	// sees an error and neither the assignment nor the journal entry persists.
	journalRows(t, s)
	if _, err := s.db.Exec(`CREATE TRIGGER fail_category_feedback BEFORE INSERT ON category_feedback BEGIN SELECT RAISE(ABORT, 'test failure'); END`); err != nil {
		t.Fatal(err)
	}
	medical := types.CategoryMedical
	if _, err := s.SetUserTransactionCategory(id, &medical); err == nil {
		t.Fatal("journal failure was accepted")
	}
	if got := loadedCategory(t, s, id); got.Category != "" {
		t.Fatalf("sidecar survived the journal failure=%+v", got)
	}
	if rows := journalRows(t, s); len(rows) != 0 {
		t.Fatalf("journal survived its own failure=%+v", rows)
	}
}

func TestCategoryJournalCascadesWithTransaction(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	id := mustJournalBankTransaction(t, s, "WHOLE FOODS", "food", "")
	medical := types.CategoryMedical
	if _, err := s.SetUserTransactionCategory(id, &medical); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteTransaction(id); err != nil {
		t.Fatal(err)
	}
	if rows := journalRows(t, s); len(rows) != 0 {
		t.Fatalf("journal survived its transaction=%+v", rows)
	}
}
