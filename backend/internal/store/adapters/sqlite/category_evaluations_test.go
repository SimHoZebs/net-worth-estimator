package sqlite

import (
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedCategoryTransaction(t *testing.T, s *sqliteStore, name, bankID string, posted int64, facts types.TransactionFacts) string {
	t.Helper()
	transaction := bankSeedTransaction(name, "checking", "42.00", false)
	transaction.PostedTime = posted
	transaction.TransactionTime = posted
	applyDirectives(t, s, []BankDirective{
		categoryUpsertDirective(transaction, ProviderSimpleFIN, "bridge", bankID, facts),
	})
	var id string
	if err := s.db.QueryRow(`SELECT transaction_id FROM transaction_sync_keys WHERE provider = ? AND bridge_account_id = ? AND bank_transaction_id = ? AND user_id = :user_id`,
		ProviderSimpleFIN, "bridge", bankID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func categoryBatchFor(t *testing.T, candidates []types.TransactionCategoryCandidate, version string, outcomes ...string) types.TransactionCategoryBatch {
	t.Helper()
	if len(candidates) == 0 {
		t.Fatal("empty category batch")
	}
	if len(outcomes) > 0 && len(outcomes) != len(candidates) {
		t.Fatal("outcome count does not match candidates")
	}
	batch := types.TransactionCategoryBatch{
		ClassifierVersion: version,
		Evaluations:       make([]types.TransactionCategoryEvaluation, 0, len(candidates)),
		Cursor: types.TransactionCategoryCursor{
			PostedTime:    candidates[len(candidates)-1].PostedTime,
			TransactionID: candidates[len(candidates)-1].TransactionID,
		},
	}
	for index, candidate := range candidates {
		outcome := types.TransactionCategoryOutcomeEvaluated
		if len(outcomes) > 0 {
			outcome = outcomes[index]
		}
		evaluation := types.TransactionCategoryEvaluation{
			TransactionID: candidate.TransactionID,
			EvidenceHash:  candidate.EvidenceHash,
			Outcome:       outcome,
		}
		if outcome == types.TransactionCategoryOutcomeAssigned {
			evaluation.Category = types.CategoryTravel
			evaluation.Producer = "test-classifier"
		}
		if outcome == types.TransactionCategoryOutcomeDeferred {
			evaluation.ProblemCode = "unsanitized provider detail"
		}
		batch.Evaluations = append(batch.Evaluations, evaluation)
	}
	return batch
}

func recordCategoryBatch(t *testing.T, s *sqliteStore, batch types.TransactionCategoryBatch) {
	t.Helper()
	if err := s.RecordTransactionCategoryBatch(batch); err != nil {
		t.Fatal(err)
	}
}

type categoryEvaluationState struct {
	outcome       string
	problemCode   string
	attempts      int64
	nextAttemptAt int64
	evaluatedAt   int64
}

func readCategoryEvaluation(t *testing.T, s *sqliteStore, transactionID string) categoryEvaluationState {
	t.Helper()
	var state categoryEvaluationState
	if err := s.db.QueryRow(`SELECT outcome, problem_code, attempts, next_attempt_at, evaluated_at
		FROM category_evaluations WHERE transaction_id = ? AND user_id = :user_id`, transactionID).
		Scan(&state.outcome, &state.problemCode, &state.attempts, &state.nextAttemptAt, &state.evaluatedAt); err != nil {
		t.Fatal(err)
	}
	return state
}

func TestCategoryCandidatesUseDurableKeysetCursorAndWrap(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cursor.db")
	s := openSQLiteStoreAt(t, path)
	seedAccount(t, s, "checking")
	facts := categoryFacts("LOCAL SHOP", "")
	third := seedCategoryTransaction(t, s, "THIRD", "third", 300, facts)
	first := seedCategoryTransaction(t, s, "FIRST", "first", 100, facts)
	second := seedCategoryTransaction(t, s, "SECOND", "second", 200, facts)

	candidates, err := s.ListTransactionCategoryCandidates(2)
	if err != nil || len(candidates) != 2 {
		t.Fatalf("candidates=%+v err=%v", candidates, err)
	}
	if candidates[0].TransactionID != first || candidates[1].TransactionID != second {
		t.Fatalf("keyset order=%+v", candidates)
	}
	if candidates[0].PostedTime != 100 || candidates[0].Attempts != 0 || candidates[0].EvidenceHash == "" {
		t.Fatalf("candidate metadata=%+v", candidates[0])
	}
	recordCategoryBatch(t, s, categoryBatchFor(t, candidates, "classifier-v1",
		types.TransactionCategoryOutcomeAssigned, types.TransactionCategoryOutcomeEvaluated))
	if got := loadedCategory(t, s, first); got.Category != types.CategoryTravel || got.Source != types.CategorySourceInferred {
		t.Fatalf("assigned category=%+v", got)
	}
	if got := readCategoryEvaluation(t, s, first); got.outcome != types.TransactionCategoryOutcomeAssigned || got.attempts != 1 || got.nextAttemptAt != 0 {
		t.Fatalf("assigned evaluation=%+v", got)
	}
	var version string
	if err := s.db.QueryRow(`SELECT classifier_version FROM category_evaluations WHERE transaction_id = ? AND user_id = :user_id`, first).Scan(&version); err != nil || version != "classifier-v1" {
		t.Fatalf("classifier version=%q err=%v", version, err)
	}
	var cursor types.TransactionCategoryCursor
	if err := s.db.QueryRow(`SELECT posted_time, transaction_id FROM category_scan_progress WHERE user_id = :user_id`).Scan(&cursor.PostedTime, &cursor.TransactionID); err != nil || cursor.TransactionID != second || cursor.PostedTime != 200 {
		t.Fatalf("cursor=%+v err=%v", cursor, err)
	}

	candidates, err = s.ListTransactionCategoryCandidates(2)
	if err != nil || len(candidates) != 1 || candidates[0].TransactionID != third {
		t.Fatalf("terminal rows were not skipped: %+v err=%v", candidates, err)
	}
	recordCategoryBatch(t, s, categoryBatchFor(t, candidates, "classifier-v1"))

	// The cursor survives reopening, and a backdated new row is found by the
	// single wrap to the head rather than by a newest-first rescan.
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	s = reopened.(*sqliteStore)
	t.Cleanup(func() { _ = s.Close() })
	newHead := seedCategoryTransaction(t, s, "NEW HEAD", "new-head", 50, facts)
	candidates, err = s.ListTransactionCategoryCandidates(2)
	if err != nil || len(candidates) != 1 || candidates[0].TransactionID != newHead {
		t.Fatalf("wrapped candidates=%+v err=%v", candidates, err)
	}
}

func TestCategoryDeferredRetryBackoffAndTerminalClear(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	id := seedCategoryTransaction(t, s, "LOCAL SHOP", "retry", 100, categoryFacts("LOCAL SHOP", ""))
	candidates, err := s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("candidates=%+v err=%v", candidates, err)
	}
	recordCategoryBatch(t, s, categoryBatchFor(t, candidates, "classifier-v1", types.TransactionCategoryOutcomeDeferred))
	state := readCategoryEvaluation(t, s, id)
	if state.outcome != types.TransactionCategoryOutcomeDeferred || state.problemCode != types.TransactionCategoryProblemProvider || state.attempts != 1 {
		t.Fatalf("first defer=%+v", state)
	}
	if got := state.nextAttemptAt - state.evaluatedAt; got != 15 {
		t.Fatalf("first backoff=%ds", got)
	}
	candidates, err = s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 0 {
		t.Fatalf("future retry was eligible: %+v err=%v", candidates, err)
	}

	if _, err := s.db.Exec(`UPDATE category_evaluations SET next_attempt_at = 0 WHERE transaction_id = ? AND user_id = :user_id`, id); err != nil {
		t.Fatal(err)
	}
	candidates, err = s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 1 || candidates[0].Attempts != 1 {
		t.Fatalf("due retry=%+v err=%v", candidates, err)
	}
	recordCategoryBatch(t, s, categoryBatchFor(t, candidates, "classifier-v1", types.TransactionCategoryOutcomeDeferred))
	state = readCategoryEvaluation(t, s, id)
	if state.attempts != 2 || state.nextAttemptAt-state.evaluatedAt != 30 {
		t.Fatalf("second defer=%+v", state)
	}

	for attempt := int64(3); attempt <= 9; attempt++ {
		if _, err := s.db.Exec(`UPDATE category_evaluations SET next_attempt_at = 0 WHERE transaction_id = ? AND user_id = :user_id`, id); err != nil {
			t.Fatal(err)
		}
		candidates, err = s.ListTransactionCategoryCandidates(1)
		if err != nil || len(candidates) != 1 || candidates[0].Attempts != int(attempt-1) {
			t.Fatalf("attempt %d candidates=%+v err=%v", attempt, candidates, err)
		}
		recordCategoryBatch(t, s, categoryBatchFor(t, candidates, "classifier-v1", types.TransactionCategoryOutcomeDeferred))
		state = readCategoryEvaluation(t, s, id)
		wantDelay := int64(15) << (attempt - 1)
		if wantDelay > 3600 {
			wantDelay = 3600
		}
		if state.attempts != attempt || state.nextAttemptAt-state.evaluatedAt != wantDelay {
			t.Fatalf("attempt %d state=%+v want delay=%d", attempt, state, wantDelay)
		}
	}

	if _, err := s.db.Exec(`UPDATE category_evaluations SET next_attempt_at = 0 WHERE transaction_id = ? AND user_id = :user_id`, id); err != nil {
		t.Fatal(err)
	}
	candidates, err = s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("terminal retry candidates=%+v err=%v", candidates, err)
	}
	recordCategoryBatch(t, s, categoryBatchFor(t, candidates, "classifier-v2", types.TransactionCategoryOutcomeEvaluated))
	state = readCategoryEvaluation(t, s, id)
	if state.outcome != types.TransactionCategoryOutcomeEvaluated || state.attempts != 10 || state.nextAttemptAt != 0 || state.problemCode != "" {
		t.Fatalf("terminal state=%+v", state)
	}
}

func TestCategoryEvidenceChangesMakeRowsEligibleAgain(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	facts := categoryFacts("LOCAL SHOP", "")
	id := seedCategoryTransaction(t, s, "LOCAL SHOP", "evidence", 100, facts)
	candidates, err := s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("candidates=%+v err=%v", candidates, err)
	}
	recordCategoryBatch(t, s, categoryBatchFor(t, candidates, "classifier-v1"))
	candidates, err = s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 0 {
		t.Fatalf("unchanged evidence was eligible: %+v err=%v", candidates, err)
	}

	if _, err := s.db.Exec(`UPDATE transaction_source_facts SET facts_json = ? WHERE transaction_id = ? AND user_id = :user_id`,
		`{"description":"CHANGED","amount":"-42.00","currency":"USD","posted_time":100}`, id); err != nil {
		t.Fatal(err)
	}
	candidates, err = s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("changed facts=%+v err=%v", candidates, err)
	}
	recordCategoryBatch(t, s, categoryBatchFor(t, candidates, "classifier-v1", types.TransactionCategoryOutcomeAssigned))
	if got := loadedCategory(t, s, id); got.Source != types.CategorySourceInferred {
		t.Fatalf("inferred category=%+v", got)
	}

	if _, err := s.db.Exec(`UPDATE transactions SET name = ? WHERE id = ? AND user_id = :user_id`, "CHANGED NAME", id); err != nil {
		t.Fatal(err)
	}
	if got := loadedCategory(t, s, id); got.Category != "" {
		t.Fatalf("stale inferred category survived name change: %+v", got)
	}
	candidates, err = s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("changed name=%+v err=%v", candidates, err)
	}
	recordCategoryBatch(t, s, categoryBatchFor(t, candidates, "classifier-v1", types.TransactionCategoryOutcomeAssigned))

	if _, err := s.db.Exec(`UPDATE transactions SET source_account_id = NULL WHERE id = ? AND user_id = :user_id`, id); err != nil {
		t.Fatal(err)
	}
	candidates, err = s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 1 || candidates[0].Direction != "in" {
		t.Fatalf("changed direction=%+v err=%v", candidates, err)
	}
	recordCategoryBatch(t, s, categoryBatchFor(t, candidates, "classifier-v1"))

	if _, err := s.db.Exec(`DELETE FROM transaction_source_facts WHERE transaction_id = ? AND user_id = :user_id`, id); err != nil {
		t.Fatal(err)
	}
	candidates, err = s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 1 || candidates[0].Facts != nil {
		t.Fatalf("deleted facts=%+v err=%v", candidates, err)
	}
}

func TestLegacyInferredAssignmentsAreNotMassReprocessed(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	id := seedCategoryTransaction(t, s, "LOCAL SHOP", "legacy", 100, categoryFacts("LOCAL SHOP", ""))
	if err := withRowTx(s.db, func(tx *userTx) error {
		return writeTransactionCategory(tx, id, types.CategoryTravel, types.CategorySourceInferred, "old-classifier")
	}); err != nil {
		t.Fatal(err)
	}
	candidates, err := s.ListTransactionCategoryCandidates(10)
	if err != nil || len(candidates) != 0 {
		t.Fatalf("legacy inferred row was queued: %+v err=%v", candidates, err)
	}
	if _, err := s.db.Exec(`UPDATE transactions SET name = ? WHERE id = ? AND user_id = :user_id`, "CHANGED NAME", id); err != nil {
		t.Fatal(err)
	}
	candidates, err = s.ListTransactionCategoryCandidates(10)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("changed legacy row was not queued: %+v err=%v", candidates, err)
	}
}

func TestCategoryBatchSkipsStaleEvidenceAndPreservesPrecedence(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	facts := categoryFacts("LOCAL SHOP", "")
	stale := seedCategoryTransaction(t, s, "STALE", "stale", 100, facts)
	userOwned := seedCategoryTransaction(t, s, "USER OWNED", "user", 200, facts)
	bankOwned := seedCategoryTransaction(t, s, "BANK OWNED", "bank", 300, facts)
	assigned := seedCategoryTransaction(t, s, "ASSIGNED", "assigned", 400, facts)
	candidates, err := s.ListTransactionCategoryCandidates(4)
	if err != nil || len(candidates) != 4 {
		t.Fatalf("candidates=%+v err=%v", candidates, err)
	}
	if _, err := s.db.Exec(`INSERT INTO transaction_categories(transaction_id, category, source, producer, updated_at, user_id)
		VALUES (?, ?, 'user', '', 1, :user_id)`, userOwned, types.CategoryMedical); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO transaction_categories(transaction_id, category, source, producer, updated_at, user_id)
		VALUES (?, ?, 'bank', 'simplefin', 1, :user_id)`, bankOwned, types.CategoryFoodAndDrink); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE transactions SET name = ? WHERE id = ? AND user_id = :user_id`, "CHANGED BEFORE PUBLISH", stale); err != nil {
		t.Fatal(err)
	}
	recordCategoryBatch(t, s, categoryBatchFor(t, candidates, "classifier-v1",
		types.TransactionCategoryOutcomeAssigned, types.TransactionCategoryOutcomeAssigned,
		types.TransactionCategoryOutcomeAssigned, types.TransactionCategoryOutcomeAssigned))
	if got := loadedCategory(t, s, stale); got.Category != "" {
		t.Fatalf("stale result created a category: %+v", got)
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM category_evaluations WHERE transaction_id = ? AND user_id = :user_id`, stale).Scan(&count); err != nil || count != 0 {
		t.Fatalf("stale evaluation count=%d err=%v", count, err)
	}
	if got := loadedCategory(t, s, userOwned); got.Category != types.CategoryMedical || got.Source != types.CategorySourceUser {
		t.Fatalf("user precedence changed: %+v", got)
	}
	if got := loadedCategory(t, s, bankOwned); got.Category != types.CategoryFoodAndDrink || got.Source != types.CategorySourceBank {
		t.Fatalf("bank precedence changed: %+v", got)
	}
	if got := loadedCategory(t, s, assigned); got.Category != types.CategoryTravel || got.Source != types.CategorySourceInferred {
		t.Fatalf("current assignment missing: %+v", got)
	}
	if got := readCategoryEvaluation(t, s, userOwned); got.outcome != types.TransactionCategoryOutcomeAssigned {
		t.Fatalf("user-owned evaluation=%+v", got)
	}
	if got := readCategoryEvaluation(t, s, bankOwned); got.outcome != types.TransactionCategoryOutcomeAssigned {
		t.Fatalf("bank-owned evaluation=%+v", got)
	}
}

func TestCategoryBatchRollsBackCategoryEvaluationAndCursorTogether(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	facts := categoryFacts("LOCAL SHOP", "")
	seedCategoryTransaction(t, s, "FIRST", "first", 100, facts)
	seedCategoryTransaction(t, s, "SECOND", "second", 200, facts)
	candidates, err := s.ListTransactionCategoryCandidates(2)
	if err != nil || len(candidates) != 2 {
		t.Fatalf("candidates=%+v err=%v", candidates, err)
	}
	if _, err := s.db.Exec(`CREATE TRIGGER reject_category_evaluation BEFORE INSERT ON category_evaluations
		BEGIN SELECT RAISE(ABORT, 'test failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordTransactionCategoryBatch(categoryBatchFor(t, candidates, "classifier-v1",
		types.TransactionCategoryOutcomeAssigned, types.TransactionCategoryOutcomeEvaluated)); err == nil {
		t.Fatal("expected evaluation failure")
	}
	for _, table := range []string{"transaction_categories", "category_evaluations", "category_scan_progress"} {
		var count int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM ` + table + ` WHERE user_id = :user_id`).Scan(&count); err != nil || count != 0 {
			t.Fatalf("%s rows=%d err=%v", table, count, err)
		}
	}
}

func TestExplicitUserAssignAndClearDeleteEvaluation(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	id := seedCategoryTransaction(t, s, "LOCAL SHOP", "clear", 100, categoryFacts("LOCAL SHOP", ""))
	candidates, err := s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("candidates=%+v err=%v", candidates, err)
	}
	recordCategoryBatch(t, s, categoryBatchFor(t, candidates, "classifier-v1"))
	category := types.CategoryMedical
	if _, err := s.SetUserTransactionCategory(id, &category); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM category_evaluations WHERE transaction_id = ? AND user_id = :user_id`, id).Scan(&count); err != nil || count != 0 {
		t.Fatalf("assign kept evaluation count=%d err=%v", count, err)
	}
	if _, err := s.SetUserTransactionCategory(id, nil); err != nil {
		t.Fatal(err)
	}
	candidates, err = s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 1 || candidates[0].TransactionID != id {
		t.Fatalf("clear did not requeue: %+v err=%v", candidates, err)
	}
}

func TestUserCategoryJournalFailureRollsBackEvaluationDeletion(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	id := seedCategoryTransaction(t, s, "LOCAL SHOP", "journal-rollback", 100, categoryFacts("LOCAL SHOP", ""))
	candidates, err := s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("candidates=%+v err=%v", candidates, err)
	}
	recordCategoryBatch(t, s, categoryBatchFor(t, candidates, "classifier-v1"))
	if _, err := s.db.Exec(`CREATE TRIGGER fail_category_evaluation_journal BEFORE INSERT ON category_feedback
		BEGIN SELECT RAISE(ABORT, 'test failure'); END`); err != nil {
		t.Fatal(err)
	}
	category := types.CategoryMedical
	if _, err := s.SetUserTransactionCategory(id, &category); err == nil {
		t.Fatal("expected journal failure")
	}
	if got := readCategoryEvaluation(t, s, id); got.outcome != types.TransactionCategoryOutcomeEvaluated {
		t.Fatalf("evaluation deletion escaped rollback: %+v", got)
	}
	if got := loadedCategory(t, s, id); got.Source == types.CategorySourceUser {
		t.Fatalf("user category escaped rollback: %+v", got)
	}
}

func TestSetupCreatesCategorySchemaObjects(t *testing.T) {
	d := openSharedTestDatabase(t)
	for _, table := range categorySchemaTableNames {
		var count int
		if err := d.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("table %s count=%d err=%v", table, count, err)
		}
	}
	for _, trigger := range categoryTriggerNames {
		var count int
		if err := d.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = ?`, trigger).Scan(&count); err != nil || count != 1 {
			t.Fatalf("trigger %s count=%d err=%v", trigger, count, err)
		}
	}
	for _, index := range []string{"transactions_category_scan", "category_evaluations_retry", "category_feedback_user_txn"} {
		var count int
		if err := d.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?`, index).Scan(&count); err != nil || count != 1 {
			t.Fatalf("index %s count=%d err=%v", index, count, err)
		}
	}
}

func TestSetupLeavesAdditiveCategorySchemaForFirstUse(t *testing.T) {
	path := filepath.Join(t.TempDir(), "category-upgrade.db")
	database, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.EnsureUser("owner", "https://issuer.test", "owner"); err != nil {
		t.Fatal(err)
	}
	for _, name := range categoryTriggerNames {
		if _, err := database.db.Exec(`DROP TRIGGER ` + name); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"category_evaluations", "category_scan_progress", "category_feedback"} {
		if _, err := database.db.Exec(`DROP TABLE ` + name); err != nil {
			t.Fatal(err)
		}
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	database, err = SetupDatabase(path)
	if err != nil {
		t.Fatalf("setup rejected additive category schema: %v", err)
	}
	defer database.Close()
	for _, name := range []string{"category_evaluations", "category_scan_progress", "category_feedback"} {
		var count int
		if err := database.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name).Scan(&count); err != nil || count != 0 {
			t.Fatalf("setup provisioned %s early: count=%d err=%v", name, count, err)
		}
	}
	scoped, err := database.User("owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ListTransactionCategoryCandidates(1); err != nil {
		t.Fatal(err)
	}
	for _, name := range categorySchemaTableNames {
		var count int
		if err := database.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name).Scan(&count); err != nil || count != 1 {
			t.Fatalf("table %s count=%d err=%v", name, count, err)
		}
	}
	for _, name := range categoryTriggerNames {
		var count int
		if err := database.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = ?`, name).Scan(&count); err != nil || count != 1 {
			t.Fatalf("trigger %s count=%d err=%v", name, count, err)
		}
	}
}

func TestRuntimeSelfHealsCategoryTriggersAfterOfflineSchemaWork(t *testing.T) {
	path := filepath.Join(t.TempDir(), "category-trigger-upgrade.db")
	database, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.EnsureUser("owner", "https://issuer.test", "owner"); err != nil {
		t.Fatal(err)
	}
	if _, err := database.db.Exec(`DROP TRIGGER category_evaluations_facts_insert`); err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	database, err = OpenDatabase(path)
	if err != nil {
		t.Fatalf("runtime rejected self-healing category trigger: %v", err)
	}
	defer database.Close()
	scoped, err := database.User("owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ListTransactionCategoryCandidates(1); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := database.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'category_evaluations_facts_insert'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("category trigger count=%d err=%v", count, err)
	}
}

func TestCategorySchemaSelfHealsTablesAndTriggers(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	seedCategoryTransaction(t, s, "LOCAL SHOP", "heal", 100, categoryFacts("LOCAL SHOP", ""))
	for _, name := range categoryTriggerNames {
		if _, err := s.db.Exec(`DROP TRIGGER ` + name); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"category_evaluations", "category_scan_progress", "category_feedback"} {
		if _, err := s.db.Exec(`DROP TABLE ` + name); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.ListTransactionCategoryCandidates(1); err != nil {
		t.Fatal(err)
	}
	for _, name := range categorySchemaTableNames {
		var count int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name).Scan(&count); err != nil || count != 1 {
			t.Fatalf("table %s count=%d err=%v", name, count, err)
		}
	}
	for _, name := range categoryTriggerNames {
		var count int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = ?`, name).Scan(&count); err != nil || count != 1 {
			t.Fatalf("trigger %s count=%d err=%v", name, count, err)
		}
	}
}

func TestCategoryRetryDelayCapsAtOneHour(t *testing.T) {
	for attempts, want := range map[int64]time.Duration{
		0:  categoryRetryInitial,
		1:  categoryRetryInitial,
		2:  30 * time.Second,
		3:  time.Minute,
		7:  16 * time.Minute,
		8:  32 * time.Minute,
		9:  time.Hour,
		20: time.Hour,
	} {
		if got := categoryRetryDelay(attempts); got != want {
			t.Fatalf("attempts %d delay=%s want=%s", attempts, got, want)
		}
	}
}

func TestCategoryEvaluationIsSanitizedAndCascades(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	id := seedCategoryTransaction(t, s, "LOCAL SHOP", "cascade", 100, categoryFacts("LOCAL SHOP", ""))
	candidates, err := s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("candidates=%+v err=%v", candidates, err)
	}
	batch := categoryBatchFor(t, candidates, "classifier-v1", types.TransactionCategoryOutcomeDeferred)
	batch.Evaluations[0].ProblemCode = "PRIVATE DESCRIPTOR https://user:pass@example.test"
	recordCategoryBatch(t, s, batch)
	if got := readCategoryEvaluation(t, s, id); got.problemCode != types.TransactionCategoryProblemProvider {
		t.Fatalf("problem code=%q", got.problemCode)
	}
	if err := s.DeleteTransaction(id); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM category_evaluations WHERE transaction_id = ? AND user_id = :user_id`, id).Scan(&count); err != nil || count != 0 {
		t.Fatalf("evaluation rows=%d err=%v", count, err)
	}
}

func TestCategoryBatchRejectsInvalidOutcomeWithoutRawValues(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	id := seedCategoryTransaction(t, s, "PRIVATE DESCRIPTOR", "invalid", 100, categoryFacts("PRIVATE DESCRIPTOR", ""))
	candidates, err := s.ListTransactionCategoryCandidates(1)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("candidates=%+v err=%v", candidates, err)
	}
	batch := categoryBatchFor(t, candidates, "classifier-v1")
	batch.Evaluations[0].Outcome = "PRIVATE DESCRIPTOR"
	err = s.RecordTransactionCategoryBatch(batch)
	if err == nil || fmt.Sprint(err) != "category classification returned an invalid outcome" {
		t.Fatalf("invalid outcome error=%v", err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM category_evaluations WHERE transaction_id = ? AND user_id = :user_id`, id).Scan(&count); err != nil || count != 0 {
		t.Fatalf("evaluation rows=%d err=%v", count, err)
	}
}
