package main

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func seedCategoryRefreshData(t *testing.T, path string) {
	t.Helper()
	db, err := sqlite.OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.SQL().Exec(`INSERT INTO transactions
		(user_id, id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source)
		VALUES ('other', 'category-txn', 'PRIVATE MERCHANT', 'checking', '[]', '{}', 100, 100, 'banksync');
		INSERT INTO transaction_source_facts(user_id, transaction_id, facts_json)
		VALUES ('other', 'category-txn', '{"description":"PRIVATE MERCHANT","amount":"-42.00","currency":"USD"}');
		INSERT INTO transaction_categories(transaction_id, category, source, producer, updated_at, user_id)
		VALUES ('category-txn', 'TRAVEL', 'inferred', 'classifier-v1', 1, 'other');
		INSERT INTO category_feedback(transaction_id, action, category, name, direction, facts_json, created_at, user_id)
		VALUES ('category-txn', 'assign', 'MEDICAL', 'PRIVATE MERCHANT', 'out', '{"description":"PRIVATE MERCHANT","amount":"-42.00","currency":"USD"}', 1, 'other');
		INSERT INTO category_evaluations
		(transaction_id, evidence_hash, classifier_version, outcome, attempts, next_attempt_at, problem_code, evaluated_at, user_id)
		VALUES ('category-txn', '` + strings.Repeat("a", 64) + `', 'classifier-v1', 'assigned', 1, 0, '', 1, 'other');
		INSERT INTO category_scan_progress(posted_time, transaction_id, updated_at, user_id)
		VALUES (100, 'category-txn', 1, 'other')`)
	if err != nil {
		t.Fatal(err)
	}
}

func TestRefreshCopiesCategoryStateAndPublicCopyExcludesPrivateState(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "target.db")
	seed(t, source)
	seed(t, target)
	seedCategoryRefreshData(t, source)
	if err := refresh(target, source, "other", "owner", false); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"transaction_categories", "category_evaluations", "category_feedback", "category_scan_progress", "transaction_source_facts"} {
		if got := query(t, target, `SELECT COUNT(*) FROM `+table+` WHERE user_id='owner'`); got != "1" {
			t.Fatalf("full refresh %s=%s", table, got)
		}
	}
	if got := query(t, target, `SELECT outcome FROM category_evaluations WHERE user_id='owner'`); got != "assigned" {
		t.Fatalf("facts trigger removed copied evaluation: %s", got)
	}

	if err := refresh(target, source, "other", "owner", true); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"category_evaluations", "category_feedback", "category_scan_progress", "transaction_source_facts"} {
		if got := query(t, target, `SELECT COUNT(*) FROM `+table+` WHERE user_id='owner'`); got != "0" {
			t.Fatalf("public refresh copied private %s=%s", table, got)
		}
	}
	if got := query(t, target, `SELECT COUNT(*) FROM transaction_categories WHERE user_id='owner'`); got != "1" {
		t.Fatalf("public category rows=%s", got)
	}
}

func TestRefreshRejectsMissingDestinationCategoryFeedback(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "target.db")
	seed(t, source)
	seed(t, target)
	seedCategoryRefreshData(t, source)
	db, err := sqlite.OpenDatabase(target)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.SQL().Exec(`DROP TABLE category_feedback`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if err := refresh(target, source, "other", "owner", false); err == nil {
		t.Fatal("refresh silently discarded source category feedback")
	}
	if got := query(t, source, `SELECT COUNT(*) FROM category_feedback WHERE user_id='other'`); got != "1" {
		t.Fatalf("source feedback changed: %s", got)
	}
}

func TestRefreshDeletesDestinationLazyCategoryRowsWhenSourceLacksTables(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, "source.db"), filepath.Join(dir, "target.db")
	seed(t, source)
	seed(t, target)
	seedCategoryRefreshData(t, target)
	dropLazyCategorySchema := func(path string) {
		t.Helper()
		db, err := sqlite.OpenDatabase(path)
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		for _, trigger := range []string{
			"category_evaluations_facts_insert",
			"category_evaluations_facts_update",
			"category_evaluations_facts_delete",
			"category_evaluations_transaction_update",
		} {
			if _, err := db.SQL().Exec(`DROP TRIGGER ` + trigger); err != nil {
				t.Fatal(err)
			}
		}
		for _, table := range []string{"category_evaluations", "category_feedback", "category_scan_progress", "transaction_categories"} {
			if _, err := db.SQL().Exec(`DROP TABLE ` + table); err != nil {
				t.Fatal(err)
			}
		}
	}
	dropLazyCategorySchema(source)
	if err := refresh(target, source, "other", "owner", false); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"transaction_categories", "category_evaluations", "category_feedback", "category_scan_progress"} {
		if got := query(t, target, `SELECT COUNT(*) FROM `+table+` WHERE user_id='owner'`); got != "0" {
			t.Fatalf("stale destination %s=%s", table, got)
		}
	}
}
