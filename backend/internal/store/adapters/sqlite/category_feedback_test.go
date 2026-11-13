package sqlite

import (
	"database/sql"
	"fmt"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
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

func TestCategoryJournalSelfHeals(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	if _, err := s.db.Exec(`DROP TABLE IF EXISTS category_feedback`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`DROP INDEX IF EXISTS category_feedback_user_txn`); err != nil {
		t.Fatal(err)
	}
	// Reads recreate the journal on an old database without a migration.
	if rows, err := s.ListCategoryFeedback("", 10); err != nil || len(rows) != 0 {
		t.Fatalf("rows=%+v err=%v", rows, err)
	}
	id := mustJournalBankTransaction(t, s, "WHOLE FOODS", "food", "")
	travel := types.CategoryTravel
	if _, err := s.SetUserTransactionCategory(id, &travel); err != nil {
		t.Fatal(err)
	}
	if rows := journalRows(t, s); len(rows) != 1 {
		t.Fatalf("journal=%+v", rows)
	}
}

func TestCategoryJournalAtomicWithSidecar(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	id := mustJournalBankTransaction(t, s, "WHOLE FOODS", "food", "")
	medical := types.CategoryMedical
	// The sidecar write succeeds but the journal insert fails its CHECK
	// constraint. Sharing one transaction must roll both back, which is
	// exactly the atomicity the process-death case relies on: SQLite never
	// commits half of withRowTx.
	err := withRowTx(s.db, func(tx *userTx) error {
		if err := ensureCategorySchema(tx); err != nil {
			return err
		}
		if err := ensureCategoryFeedbackSchema(tx); err != nil {
			return err
		}
		if err := writeTransactionCategory(tx, id, medical, types.CategorySourceUser, ""); err != nil {
			return err
		}
		var factsRaw sql.NullString
		return insertCategoryFeedback(tx, id, "bogus", &medical, "WHOLE FOODS", "out", factsRaw, 1)
	})
	if err == nil {
		t.Fatal("invalid journal action was accepted")
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

func TestRecentUserCategoriesSkipsCleared(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	kept := mustJournalBankTransaction(t, s, "SHELL OIL", "gas", "")
	cleared := mustJournalBankTransaction(t, s, "WHOLE FOODS", "food", "")
	travel := types.CategoryTravel
	medical := types.CategoryMedical
	if _, err := s.SetUserTransactionCategory(kept, &travel); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetUserTransactionCategory(cleared, &medical); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetUserTransactionCategory(cleared, nil); err != nil {
		t.Fatal(err)
	}
	labels, err := s.ListRecentUserCategories(10)
	if err != nil || len(labels) != 1 {
		t.Fatalf("labels=%+v err=%v", labels, err)
	}
	if labels[0].TransactionID != kept || labels[0].Category != types.CategoryTravel {
		t.Fatalf("label=%+v", labels[0])
	}
	if labels[0].Facts == nil {
		t.Fatal("label is missing its joined evidence")
	}
}

func TestRecentUserCategoriesBoundsNewestFirst(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	ids := make([]string, 0, 5)
	for index := 0; index < 5; index++ {
		ids = append(ids, mustJournalBankTransaction(t, s, "SHOP", fmt.Sprintf("shop-%d", index), ""))
	}
	for _, id := range ids {
		medical := types.CategoryMedical
		if _, err := s.SetUserTransactionCategory(id, &medical); err != nil {
			t.Fatal(err)
		}
	}
	labels, err := s.ListRecentUserCategories(3)
	if err != nil || len(labels) != 3 {
		t.Fatalf("labels=%+v err=%v", labels, err)
	}
	if labels[0].TransactionID != ids[4] || labels[2].TransactionID != ids[2] {
		t.Fatalf("not newest first=%+v", labels)
	}
	if _, ok := interface{}(s).(store.CategoryStore); !ok {
		t.Fatal("sqlite store lost the CategoryStore seam")
	}
}
