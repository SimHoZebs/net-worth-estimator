// Command refreshmodel replaces one user's financial rows in an application
// database. It never replaces the database file or copies identity records.
// Stop the application and take a SQLite backup before this offline operation.
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	blobsqlite "github.com/simhozebs/net-worth-estimator/backend/internal/blobstore/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

// Keep identity and ownership tables outside this allowlist. Unknown scoped
// tables fail closed so a schema extension cannot silently leave stale rows.
var financialTables = []string{
	"accounts", "checkpoints", "postings", "posting_sync_keys",
	"posting_id_migrations", "planned_purchases", "recurrence_rules", "evaluations",
	"projection_artifacts", "model_metadata", "payment_terms", "entity_ids",
	"account_links", "pinned_evaluations", "sync_state", "sync_credentials", "amount_presets", "safe_spending_settings",
	"receipts",
	"analysis_inputs", "transaction_source_facts", "analysis_runs", "analysis_findings", "analysis_feedback",
}

func main() {
	var target, source, sourceUser, targetUser string
	var initIssuer, initSubject string
	var financialOnly bool
	flag.StringVar(&target, "db", "", "existing application database (application must be stopped)")
	flag.StringVar(&source, "source", "", "application database snapshot")
	flag.StringVar(&sourceUser, "source-user", "", "explicit source user ID")
	flag.StringVar(&targetUser, "user", "", "existing destination user ID")
	flag.BoolVar(&financialOnly, "financial-only", false, "publish only public financial data: exclude receipts, sync credentials/mappings, and private defaults")
	flag.StringVar(&initIssuer, "init-issuer", "", "initialize a NEW database for this verified dev issuer")
	flag.StringVar(&initSubject, "init-subject", "", "initialize a NEW database for this verified dev subject")
	flag.Parse()
	if flag.NArg() != 0 {
		log.Fatal("unexpected arguments")
	}
	var err error
	if initIssuer != "" || initSubject != "" {
		if financialOnly || targetUser != "" {
			log.Fatal("initialization cannot combine with --financial-only or --user")
		}
		err = initialize(target, source, sourceUser, initIssuer, initSubject)
	} else {
		err = refresh(target, source, sourceUser, targetUser, financialOnly)
	}
	if err != nil {
		log.Fatal(err)
	}
}

func refresh(target, source, sourceUser, targetUser string, financialOnly bool) error {
	if target == "" || source == "" || sourceUser == "" {
		return errors.New("--db, --source, and --source-user are required")
	}
	if targetUser == "" {
		return errors.New("--user must name an existing user")
	}
	sourceRow := normalizeUserRow(sourceUser)
	targetRow := normalizeUserRow(targetUser)
	if targetRow == "sample" || targetRow == "fixture" {
		return errors.New("destination must be an ordinary user; legacy historical rows are never reset")
	}
	for _, path := range []string{target, source} {
		info, err := os.Stat(path)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("not a regular database file: %s", path)
		}
	}
	targetInfo, _ := os.Stat(target)
	sourceInfo, _ := os.Stat(source)
	if os.SameFile(targetInfo, sourceInfo) {
		return errors.New("source must be a separate SQLite snapshot")
	}
	db, err := sqlite.OpenDatabase(target)
	if err != nil {
		return err
	}
	defer db.Close()
	absSource, err := filepath.Abs(source)
	if err != nil {
		return err
	}
	uri := (&url.URL{Scheme: "file", Path: absSource, RawQuery: "mode=ro"}).String()
	if _, err := db.SQL().Exec("ATTACH DATABASE ? AS incoming", uri); err != nil {
		return err
	}
	defer db.SQL().Exec("DETACH DATABASE incoming")
	tables, err := checkedTables(db.SQL())
	if err != nil {
		return err
	}
	var present int
	if err := db.SQL().QueryRow("SELECT document_present FROM incoming.model_metadata WHERE user_id=? AND id=1", sourceRow).Scan(&present); err != nil {
		return fmt.Errorf("source user must contain a current financial model: %w", err)
	}
	if present != 1 {
		return errors.New("source user has no financial model")
	}
	var receipts *sqlite.ReceiptCopy
	if !financialOnly {
		sourceDB, err := sql.Open("sqlite", uri)
		if err != nil {
			return err
		}
		defer sourceDB.Close()
		// SQLite remains the configured source adapter. Future providers enter
		// here through the same port, not through the financial copy loop.
		receipts, err = db.PrepareReceiptCopy(context.Background(), sourceDB, blobsqlite.New(sourceDB), sourceRow)
		if err != nil {
			return fmt.Errorf("prepare receipt copy: %w", err)
		}
		defer receipts.Close()
	}
	tx, err := db.SQL().Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec("PRAGMA defer_foreign_keys=ON"); err != nil {
		return err
	}
	var exists bool
	if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE id=?)", targetRow).Scan(&exists); err != nil {
		return fmt.Errorf("destination user must already exist: %w", err)
	}
	if !exists {
		return errors.New("destination user must already exist")
	}
	// Child tables precede parents during deletion. Deferred checks also permit
	// future references between canonical tables within the same transaction.
	for i := len(tables) - 1; i >= 0; i-- {
		if _, err := tx.Exec("DELETE FROM "+quote(tables[i].name)+" WHERE user_id=?", targetRow); err != nil {
			return err
		}
	}
	for _, table := range tables {
		if table.name == "projection_artifacts" || table.name == "receipts" {
			continue
		}
		if financialOnly && (table.name == "account_links" || table.name == "posting_sync_keys" || table.name == "posting_id_migrations" || table.name == "transaction_source_facts" || strings.HasPrefix(table.name, "analysis_")) {
			continue
		}
		columns, values := []string{"user_id"}, []string{"?"}
		for _, column := range table.columns {
			if column == "user_id" {
				continue
			}
			columns = append(columns, quote(column))
			switch {
			case financialOnly && table.name == "model_metadata" && column == "source_path":
				values = append(values, "'sample'")
			case financialOnly && table.name == "sync_state" && column == "last_sync_at":
				values = append(values, "''")
			case financialOnly && table.name == "postings" && column == "receipt_ids":
				// Financial-only publication excludes receipts, so copied
				// postings must not reference private receipt IDs.
				values = append(values, "'[]'")
			case table.name == "sync_credentials" && (column == "access_url" || column == "bridge_host" || column == "updated_at"):
				// The Bridge key never travels with a refresh or a
				// financial-only publication: reconnect it where it will
				// run. Card selection is safe configuration and copies through.
				values = append(values, "''")
			default:
				values = append(values, quote(column))
			}
		}
		query := "INSERT INTO " + quote(table.name) + " (" + strings.Join(columns, ",") + ") SELECT " + strings.Join(values, ",") + " FROM incoming." + quote(table.name) + " WHERE user_id=?"
		if _, err := tx.Exec(query, targetRow, sourceRow); err != nil {
			return fmt.Errorf("copy %s: %w", table.name, err)
		}
	}
	if receipts != nil {
		if err := receipts.Apply(tx, targetRow); err != nil {
			return fmt.Errorf("copy receipts: %w", err)
		}
	}
	return tx.Commit()
}

// normalizeUserRow maps a user resource to the store's user row ID:
// users/<hash> is owned by user:<hash>; raw row IDs pass through for
// offline operators. The raw historical row "sample" passes through only
// as an explicit source input when an old database still contains it; it
// is never created and never valid as a destination.
func normalizeUserRow(id string) string {
	if rest, ok := strings.CutPrefix(id, "users/"); ok {
		return "user:" + rest
	}
	return id
}

type tableShape struct {
	name    string
	columns []string
}

// identityTables are user-scoped but never financial: social membership
// belongs to the group boundary, not to the copied user. They stay
// outside the allowlist and are skipped in both schemas; any other unknown
// scoped table still fails closed.
var identityTables = map[string]bool{
	"group_members": true,
}

func checkedTables(db *sql.DB) ([]tableShape, error) {
	allowed := map[string]bool{}
	for _, name := range financialTables {
		allowed[name] = true
	}
	var result []tableShape
	for _, schema := range []string{"main", "incoming"} {
		rows, err := db.Query("SELECT name FROM " + schema + ".sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
		if err != nil {
			return nil, err
		}
		var names []string
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				rows.Close()
				return nil, err
			}
			names = append(names, name)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
		var shapes []tableShape
		for _, name := range names {
			columns, err := tableColumns(db, schema, name)
			if err != nil {
				return nil, err
			}
			scoped := false
			for _, column := range columns {
				if column == "user_id" {
					scoped = true
				}
			}
			if !scoped {
				continue
			}
			if identityTables[name] {
				continue
			}
			if !allowed[name] {
				return nil, fmt.Errorf("unknown user-scoped table %s; review refresh allowlist", name)
			}
			shapes = append(shapes, tableShape{name, columns})
		}
		if schema == "main" {
			result = shapes
		} else {
			if fmt.Sprint(result) != fmt.Sprint(shapes) {
				return nil, errors.New("source and destination financial schemas differ; use a compatible current snapshot")
			}
		}
	}
	if len(result) != len(financialTables) {
		return nil, errors.New("application financial schema incomplete; use a compatible current snapshot")
	}
	return result, nil
}

func tableColumns(db *sql.DB, schema, table string) ([]string, error) {
	rows, err := db.Query("PRAGMA " + schema + ".table_info(" + quote(table) + ")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var columns []string
	for rows.Next() {
		var cid, notnull, primary int
		var name, kind string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &kind, &notnull, &defaultValue, &primary); err != nil {
			return nil, err
		}
		columns = append(columns, name)
	}
	return columns, rows.Err()
}

func quote(name string) string { return `"` + strings.ReplaceAll(name, `"`, `""`) + `"` }
