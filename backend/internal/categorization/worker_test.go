package categorization_test

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/categorization"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func newCategoryStore(t *testing.T) (store.Store, *sqlite.Database) {
	t.Helper()
	return newCategoryStoreAt(t, filepath.Join(t.TempDir(), "categories.db"))
}

func newCategoryStoreAt(t *testing.T, path string) (store.Store, *sqlite.Database) {
	t.Helper()
	database, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	scoped, err := database.EnsureUser("category-user", "https://issuer.test", "category-subject")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	return scoped, database
}

func seedCharge(t *testing.T, scoped store.Store, name, transactionID, bankCategory string) string {
	t.Helper()
	return seedChargeAt(t, scoped, name, transactionID, bankCategory, 1785628800)
}

func seedChargeAt(t *testing.T, scoped store.Store, name, transactionID, bankCategory string, posted int64) string {
	t.Helper()
	account := "checking"
	facts := types.TransactionFacts{Description: name, Amount: "-42.00", Currency: "USD", PostedTime: posted}
	if bankCategory != "" {
		facts.Metadata = map[string]string{"category": bankCategory}
	}
	summary, err := scoped.ApplySync(nil, []store.BankDirective{{Upsert: &store.BankUpsert{
		Transaction: types.Transaction{
			Name:            name,
			Source:          store.SourceBankSync,
			SourceAccountID: &account,
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "42.00"}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      posted,
			TransactionTime: posted,
			Enabled:         true,
		},
		Keys:  []store.BankKey{{Provider: store.ProviderSimpleFIN, AccountID: "bridge", TransactionID: transactionID}},
		Facts: &facts,
	}}})
	if err != nil || summary.SettledInserted != 1 {
		t.Fatalf("seed=%+v err=%v", summary, err)
	}
	rows, err := scoped.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.Transaction.Name == name && row.Transaction.PostedTime == posted {
			return row.Transaction.ID
		}
	}
	t.Fatalf("seeded transaction %q not found", name)
	return ""
}

func categoryOf(t *testing.T, scoped store.Store, transactionID string) types.TransactionCategory {
	t.Helper()
	items, err := scoped.LoadTransactionCategories([]string{transactionID})
	if err != nil {
		t.Fatal(err)
	}
	return items[transactionID]
}

func TestWorkerFillsUncategorizedBankRows(t *testing.T) {
	scoped, database := newCategoryStore(t)
	transactionID := seedCharge(t, scoped, "WHOLE FOODS MARKET", "food", "")
	worker, err := categorization.NewWorker(database, categorization.KeywordClassifier{})
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	got := categoryOf(t, scoped, transactionID)
	if got.Category != types.CategoryFoodAndDrink || got.Source != types.CategorySourceInferred || got.Producer != "keyword-v1" {
		t.Fatalf("category=%+v", got)
	}
	// A restart reruns the same scan. The settled assignment stays stable.
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if again := categoryOf(t, scoped, transactionID); again != got {
		t.Fatalf("repeat changed category: %+v", again)
	}
	// The owner wins over a later classifier pass.
	userCategory := types.CategoryMedical
	if _, err := scoped.SetUserTransactionCategory(transactionID, &userCategory); err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if again := categoryOf(t, scoped, transactionID); again.Category != types.CategoryMedical || again.Source != types.CategorySourceUser {
		t.Fatalf("classifier replaced user: %+v", again)
	}
}

func TestWorkerLeavesSupportedBankValuesAndSkipsClassifiedRows(t *testing.T) {
	scoped, database := newCategoryStore(t)
	transactionID := seedCharge(t, scoped, "WHOLE FOODS MARKET", "food", "GENERAL_MERCHANDISE")
	worker, err := categorization.NewWorker(database, categorization.KeywordClassifier{})
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	got := categoryOf(t, scoped, transactionID)
	if got.Category != types.CategoryGeneralMerchandise || got.Source != types.CategorySourceBank {
		t.Fatalf("category=%+v", got)
	}
}

func TestWorkerLeavesUnknownRowsUncategorized(t *testing.T) {
	scoped, database := newCategoryStore(t)
	transactionID := seedCharge(t, scoped, "LOCAL SHOP", "shop", "")
	worker, err := categorization.NewWorker(database, categorization.KeywordClassifier{})
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := categoryOf(t, scoped, transactionID); got.Category != "" {
		t.Fatalf("unknown row gained a category: %+v", got)
	}
}

type stubProducerClassifier struct {
	producer string
}

func (s stubProducerClassifier) Version() string { return "stub-composite" }

func (s stubProducerClassifier) Classify(ctx context.Context, inputs []categorization.Input) (map[string]categorization.Classified, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	results := map[string]categorization.Classified{}
	for _, input := range inputs {
		results[input.TransactionID] = categorization.Classified{Category: types.CategoryTravel, Producer: s.producer, Outcome: categorization.OutcomeAssigned}
	}
	return results, nil
}

type scriptedClassifier struct {
	calls    int
	classify func(context.Context, []categorization.Input) (map[string]categorization.Classified, error)
}

func (s *scriptedClassifier) Version() string { return "scripted-v1" }

func (s *scriptedClassifier) Classify(ctx context.Context, inputs []categorization.Input) (map[string]categorization.Classified, error) {
	s.calls++
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.classify != nil {
		return s.classify(ctx, inputs)
	}
	results := make(map[string]categorization.Classified, len(inputs))
	for _, input := range inputs {
		results[input.TransactionID] = categorization.Classified{Outcome: categorization.OutcomeEvaluated}
	}
	return results, nil
}

type countingClassifier struct {
	inner categorization.Classifier
	calls int
}

func (c *countingClassifier) Version() string { return c.inner.Version() }

func (c *countingClassifier) Classify(ctx context.Context, inputs []categorization.Input) (map[string]categorization.Classified, error) {
	c.calls++
	return c.inner.Classify(ctx, inputs)
}

func TestWorkerDoesNotReevaluateUnchangedTerminalOutcomes(t *testing.T) {
	scoped, database := newCategoryStore(t)
	for _, name := range []string{"ASSIGNED", "UNCERTAIN", "UNSUPPORTED", "NO REQUEST"} {
		seedCharge(t, scoped, name, name, "")
	}
	classifier := &scriptedClassifier{classify: func(_ context.Context, inputs []categorization.Input) (map[string]categorization.Classified, error) {
		results := make(map[string]categorization.Classified, len(inputs))
		for _, input := range inputs {
			result := categorization.Classified{Outcome: categorization.OutcomeEvaluated}
			if input.Name == "ASSIGNED" {
				result = categorization.Classified{Category: types.CategoryTravel, Producer: "scripted-v1", Outcome: categorization.OutcomeAssigned}
			}
			results[input.TransactionID] = result
		}
		return results, nil
	}}
	worker, err := categorization.NewWorker(database, classifier)
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if classifier.calls != 1 {
		t.Fatalf("classifier calls=%d, want 1", classifier.calls)
	}
	replacement := &countingClassifier{inner: stubProducerClassifier{producer: "replacement-model"}}
	replacementWorker, err := categorization.NewWorker(database, replacement)
	if err != nil {
		t.Fatal(err)
	}
	if err := replacementWorker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if replacement.calls != 0 {
		t.Fatalf("classifier revision requeued terminal rows: calls=%d", replacement.calls)
	}
	var count int
	if err := database.SQL().QueryRow(`SELECT COUNT(*) FROM category_evaluations WHERE user_id = 'category-user'`).Scan(&count); err != nil || count != 4 {
		t.Fatalf("evaluation rows=%d err=%v", count, err)
	}
}

func TestWorkerDefersProviderFailureAndRetriesAfterBackoff(t *testing.T) {
	scoped, database := newCategoryStore(t)
	id := seedCharge(t, scoped, "LOCAL SHOP", "retry", "")
	classifier := &scriptedClassifier{}
	classifier.classify = func(_ context.Context, inputs []categorization.Input) (map[string]categorization.Classified, error) {
		results := make(map[string]categorization.Classified, len(inputs))
		for _, input := range inputs {
			result := categorization.Classified{Outcome: categorization.OutcomeEvaluated}
			if classifier.calls == 1 {
				result = categorization.Classified{Outcome: categorization.OutcomeDeferred, ProblemCode: types.TransactionCategoryProblemProvider}
			} else {
				result = categorization.Classified{Category: types.CategoryTravel, Producer: classifier.Version(), Outcome: categorization.OutcomeAssigned}
			}
			results[input.TransactionID] = result
		}
		return results, nil
	}
	worker, err := categorization.NewWorker(database, classifier)
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	var outcome string
	var attempts int
	var nextAttemptAt int64
	if err := database.SQL().QueryRow(`SELECT outcome, attempts, next_attempt_at FROM category_evaluations WHERE transaction_id = ? AND user_id = 'category-user'`, id).
		Scan(&outcome, &attempts, &nextAttemptAt); err != nil {
		t.Fatal(err)
	}
	if outcome != categorization.OutcomeDeferred || attempts != 1 || nextAttemptAt <= time.Now().Unix() {
		t.Fatalf("deferred state outcome=%s attempts=%d next=%d", outcome, attempts, nextAttemptAt)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if classifier.calls != 1 {
		t.Fatalf("retry ran before backoff: calls=%d", classifier.calls)
	}
	if _, err := database.SQL().Exec(`UPDATE category_evaluations SET next_attempt_at = 0 WHERE transaction_id = ? AND user_id = 'category-user'`, id); err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if classifier.calls != 2 {
		t.Fatalf("due retry calls=%d", classifier.calls)
	}
	if got := categoryOf(t, scoped, id); got.Category != types.CategoryTravel || got.Source != types.CategorySourceInferred {
		t.Fatalf("retry category=%+v", got)
	}
	if err := database.SQL().QueryRow(`SELECT outcome, attempts, next_attempt_at FROM category_evaluations WHERE transaction_id = ? AND user_id = 'category-user'`, id).
		Scan(&outcome, &attempts, &nextAttemptAt); err != nil {
		t.Fatal(err)
	}
	if outcome != categorization.OutcomeAssigned || attempts != 2 || nextAttemptAt != 0 {
		t.Fatalf("terminal retry outcome=%s attempts=%d next=%d", outcome, attempts, nextAttemptAt)
	}
}

func TestWorkerReevaluatesChangedEvidence(t *testing.T) {
	scoped, database := newCategoryStore(t)
	id := seedCharge(t, scoped, "WHOLE FOODS", "changed", "")
	classifier := &countingClassifier{inner: categorization.KeywordClassifier{}}
	worker, err := categorization.NewWorker(database, classifier)
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := categoryOf(t, scoped, id); got.Category != types.CategoryFoodAndDrink {
		t.Fatalf("initial category=%+v", got)
	}
	if _, err := database.SQL().Exec(`UPDATE transactions SET name = 'LOCAL SHOP' WHERE id = ? AND user_id = 'category-user'`, id); err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if classifier.calls != 2 || categoryOf(t, scoped, id).Category != types.CategoryFoodAndDrink {
		t.Fatalf("name change calls=%d category=%+v", classifier.calls, categoryOf(t, scoped, id))
	}
	if _, err := database.SQL().Exec(`UPDATE transaction_source_facts SET facts_json = ? WHERE transaction_id = ? AND user_id = 'category-user'`,
		`{"description":"LOCAL SHOP","amount":"-42.00","currency":"USD","posted_time":1785628800}`, id); err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if classifier.calls != 3 || categoryOf(t, scoped, id).Category != "" {
		t.Fatalf("facts miss calls=%d category=%+v", classifier.calls, categoryOf(t, scoped, id))
	}
	if _, err := database.SQL().Exec(`UPDATE transaction_source_facts SET facts_json = ? WHERE transaction_id = ? AND user_id = 'category-user'`,
		`{"description":"WHOLE FOODS","amount":"-42.00","currency":"USD","posted_time":1785628800}`, id); err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if classifier.calls != 4 || categoryOf(t, scoped, id).Category != types.CategoryFoodAndDrink {
		t.Fatalf("facts hit calls=%d category=%+v", classifier.calls, categoryOf(t, scoped, id))
	}
	if _, err := database.SQL().Exec(`UPDATE transactions SET name = 'PAYROLL', source_account_id = NULL WHERE id = ? AND user_id = 'category-user'`, id); err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if classifier.calls != 5 || categoryOf(t, scoped, id).Category != types.CategoryIncome {
		t.Fatalf("direction change calls=%d category=%+v", classifier.calls, categoryOf(t, scoped, id))
	}
}

func TestWorkerSkipsStaleEvidenceBeforePublication(t *testing.T) {
	scoped, database := newCategoryStore(t)
	id := seedCharge(t, scoped, "LOCAL SHOP", "stale", "")
	var classifier *scriptedClassifier
	classifier = &scriptedClassifier{classify: func(_ context.Context, inputs []categorization.Input) (map[string]categorization.Classified, error) {
		if _, err := database.SQL().Exec(`UPDATE transactions SET name = 'CHANGED DURING CLASSIFY' WHERE id = ? AND user_id = 'category-user'`, id); err != nil {
			return nil, err
		}
		results := make(map[string]categorization.Classified, len(inputs))
		for _, input := range inputs {
			results[input.TransactionID] = categorization.Classified{Category: types.CategoryTravel, Producer: classifier.Version(), Outcome: categorization.OutcomeAssigned}
		}
		return results, nil
	}}
	worker, err := categorization.NewWorker(database, classifier)
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := categoryOf(t, scoped, id); got.Category != "" {
		t.Fatalf("stale category=%+v", got)
	}
	var evaluations, cursors int
	if err := database.SQL().QueryRow(`SELECT COUNT(*) FROM category_evaluations WHERE transaction_id = ? AND user_id = 'category-user'`, id).Scan(&evaluations); err != nil {
		t.Fatal(err)
	}
	if err := database.SQL().QueryRow(`SELECT COUNT(*) FROM category_scan_progress WHERE user_id = 'category-user'`).Scan(&cursors); err != nil {
		t.Fatal(err)
	}
	if evaluations != 0 || cursors != 1 {
		t.Fatalf("stale publication evaluations=%d cursors=%d", evaluations, cursors)
	}
}

func TestWorkerProcessesOneBatchPerUserAndPreservesProgress(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "worker-fairness.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	a, err := database.EnsureUser("a", "https://issuer.test", "a")
	if err != nil {
		t.Fatal(err)
	}
	b, err := database.EnsureUser("b", "https://issuer.test", "b")
	if err != nil {
		t.Fatal(err)
	}
	for _, scoped := range []store.Store{a, b} {
		if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}
	for index := 0; index < 100; index++ {
		seedChargeAt(t, a, fmt.Sprintf("LOCAL SHOP %03d", index), fmt.Sprintf("row-%03d", index), "", int64(100+index))
	}
	seedChargeAt(t, b, "LOCAL SHOP B", "row-b", "", 100)
	var extraID string
	var classifier *scriptedClassifier
	classifier = &scriptedClassifier{classify: func(_ context.Context, inputs []categorization.Input) (map[string]categorization.Classified, error) {
		if classifier.calls == 1 {
			extraID = seedChargeAt(t, a, "EXTRA A", "extra-a", "", 200)
		}
		results := make(map[string]categorization.Classified, len(inputs))
		for _, input := range inputs {
			results[input.TransactionID] = categorization.Classified{Outcome: categorization.OutcomeEvaluated}
		}
		return results, nil
	}}
	worker, err := categorization.NewWorker(database, classifier)
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if classifier.calls != 2 || extraID == "" {
		t.Fatalf("first run calls=%d extra=%q, want one batch for each user", classifier.calls, extraID)
	}
	for user, want := range map[string]int{"a": 100, "b": 1} {
		var count int
		if err := database.SQL().QueryRow(`SELECT COUNT(*) FROM category_evaluations WHERE user_id = ?`, user).Scan(&count); err != nil || count != want {
			t.Fatalf("user %s evaluations=%d want=%d err=%v", user, count, want, err)
		}
	}
	var cursorID string
	var posted int64
	if err := database.SQL().QueryRow(`SELECT posted_time, transaction_id FROM category_scan_progress WHERE user_id = 'a'`).Scan(&posted, &cursorID); err != nil || posted != 199 || cursorID == extraID {
		t.Fatalf("first cursor posted=%d id=%q extra=%q err=%v", posted, cursorID, extraID, err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if classifier.calls != 3 {
		t.Fatalf("second run calls=%d, want only user a's next batch", classifier.calls)
	}
	var count int
	if err := database.SQL().QueryRow(`SELECT COUNT(*) FROM category_evaluations WHERE user_id = 'a'`).Scan(&count); err != nil || count != 101 {
		t.Fatalf("user a evaluations=%d err=%v", count, err)
	}
	if err := database.SQL().QueryRow(`SELECT transaction_id FROM category_scan_progress WHERE user_id = 'a'`).Scan(&cursorID); err != nil || cursorID != extraID {
		t.Fatalf("second cursor=%q want=%q err=%v", cursorID, extraID, err)
	}
}

func TestWorkerCursorSurvivesRestartAndWrapsToNewRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "worker-restart.db")
	scoped, database := newCategoryStoreAt(t, path)
	first := seedChargeAt(t, scoped, "FIRST", "first", "", 100)
	worker, err := categorization.NewWorker(database, categorization.KeywordClassifier{})
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	var cursorID string
	if err := database.SQL().QueryRow(`SELECT transaction_id FROM category_scan_progress WHERE user_id = 'category-user'`).Scan(&cursorID); err != nil || cursorID != first {
		t.Fatalf("cursor=%q err=%v", cursorID, err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	database, err = sqlite.OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	scoped, err = database.User("category-user")
	if err != nil {
		t.Fatal(err)
	}
	newHead := seedChargeAt(t, scoped, "NEW HEAD", "new-head", "", 50)
	classifier := &countingClassifier{inner: categorization.KeywordClassifier{}}
	worker, err = categorization.NewWorker(database, classifier)
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if classifier.calls != 1 {
		t.Fatalf("restart classifier calls=%d", classifier.calls)
	}
	if err := database.SQL().QueryRow(`SELECT transaction_id FROM category_scan_progress WHERE user_id = 'category-user'`).Scan(&cursorID); err != nil || cursorID != newHead {
		t.Fatalf("wrapped cursor=%q want=%q err=%v", cursorID, newHead, err)
	}
	var outcome string
	if err := database.SQL().QueryRow(`SELECT outcome FROM category_evaluations WHERE transaction_id = ? AND user_id = 'category-user'`, newHead).Scan(&outcome); err != nil || outcome != categorization.OutcomeEvaluated {
		t.Fatalf("new row outcome=%q err=%v", outcome, err)
	}
}

func TestWorkerWritesPerResultProducer(t *testing.T) {
	scoped, database := newCategoryStore(t)
	transactionID := seedCharge(t, scoped, "LOCAL SHOP", "shop", "")
	worker, err := categorization.NewWorker(database, stubProducerClassifier{producer: "ml-categories-v1"})
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := categoryOf(t, scoped, transactionID); got.Producer != "ml-categories-v1" {
		t.Fatalf("producer=%+v", got)
	}
}
