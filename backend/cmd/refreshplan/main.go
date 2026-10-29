// Command refreshplan replaces one account's financial rows in an application
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
	"posting_id_migrations", "purchase_policies", "recurrence_rules", "evaluations",
	"projection_artifacts", "model_metadata", "payment_terms", "entity_ids",
	"account_links", "pinned_evaluations", "sync_state", "sync_credentials", "amount_presets", "safe_spending_settings",
	"receipts",
}

func main() {
	var target, source, sourcePlan, targetPlan string
	var initIssuer, initSubject string
	var sample bool
	flag.StringVar(&target, "db", "", "existing application database (application must be stopped)")
	flag.StringVar(&source, "source", "", "application database snapshot")
	flag.StringVar(&sourcePlan, "source-plan", "", "explicit source account ID")
	flag.StringVar(&targetPlan, "account", "", "existing destination private account ID")
	flag.BoolVar(&sample, "sample", false, "publish canonical financial data to accounts/sample")
	flag.StringVar(&initIssuer, "init-issuer", "", "initialize a NEW database for this verified dev issuer")
	flag.StringVar(&initSubject, "init-subject", "", "initialize a NEW database for this verified dev subject")
	flag.Parse()
	if flag.NArg() != 0 {
		log.Fatal("unexpected arguments")
	}
	var err error
	if initIssuer != "" || initSubject != "" {
		if sample || targetPlan != "" {
			log.Fatal("initialization cannot combine with --sample or --account")
		}
		err = initialize(target, source, sourcePlan, initIssuer, initSubject)
	} else {
		err = refresh(target, source, sourcePlan, targetPlan, sample)
	}
	if err != nil {
		log.Fatal(err)
	}
}

func refresh(target, source, sourcePlan, targetPlan string, sample bool) error {
	if target == "" || source == "" || sourcePlan == "" {
		return errors.New("--db, --source, and --source-plan are required")
	}
	if sample {
		if targetPlan != "" && targetPlan != sampleResourceID {
			return errors.New("--sample can only replace accounts/sample")
		}
		targetPlan = sampleResourceID
	} else if targetPlan == "" || normalizeAccountRow(targetPlan) == sqlite.SampleAccountID {
		return errors.New("--account must name an existing private account; use --sample to publish public data")
	}
	sourceRow := normalizeAccountRow(sourcePlan)
	targetRow := normalizeAccountRow(targetPlan)
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
	if err := db.SQL().QueryRow("SELECT document_present FROM incoming.model_metadata WHERE account_id=? AND id=1", sourceRow).Scan(&present); err != nil {
		return fmt.Errorf("source account must contain a current financial model: %w", err)
	}
	if present != 1 {
		return errors.New("source account has no financial model")
	}
	var receipts *sqlite.ReceiptCopy
	if !sample {
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
	if sample {
		// The financial copy supplies singleton rows and defaults. Create only
		// the registry row here, within that same transaction, so a failed first
		// publication cannot expose a blank sample.
		if _, err := tx.Exec("INSERT INTO app_accounts(id, issuer, subject) VALUES (?, 'sample', 'sample') ON CONFLICT(id) DO NOTHING", targetRow); err != nil {
			return err
		}
	}
	var exists bool
	if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM app_accounts WHERE id=?)", targetRow).Scan(&exists); err != nil {
		return fmt.Errorf("destination account must already exist: %w", err)
	}
	if !exists {
		return errors.New("destination account must already exist")
	}
	if sample {
		if targetRow != sqlite.SampleAccountID {
			return errors.New("sample account ownership conflict")
		}
	} else if targetRow == sqlite.SampleAccountID {
		return errors.New("destination must be a private account")
	}
	// Child tables precede parents during deletion. Deferred checks also permit
	// future references between canonical tables within the same transaction.
	for i := len(tables) - 1; i >= 0; i-- {
		if _, err := tx.Exec("DELETE FROM "+quote(tables[i].name)+" WHERE account_id=?", targetRow); err != nil {
			return err
		}
	}
	for _, table := range tables {
		if table.name == "projection_artifacts" || table.name == "receipts" {
			continue
		}
		if sample && (table.name == "account_links" || table.name == "posting_sync_keys" || table.name == "posting_id_migrations") {
			continue
		}
		columns, values := []string{"account_id"}, []string{"?"}
		for _, column := range table.columns {
			if column == "account_id" {
				continue
			}
			columns = append(columns, quote(column))
			switch {
			case sample && table.name == "model_metadata" && column == "source_path":
				values = append(values, "'sample'")
			case sample && table.name == "sync_state" && column == "last_sync_at":
				values = append(values, "''")
			case sample && table.name == "postings" && column == "receipt_ids":
				// Sample publication excludes receipts, so copied postings
				// must not reference private receipt IDs.
				values = append(values, "'[]'")
			case table.name == "sync_credentials" && (column == "access_url" || column == "bridge_host" || column == "updated_at"):
				// The Bridge key never travels with a refresh or a sample:
				// reconnect it where it will run. Card selection is safe
				// configuration and copies through.
				values = append(values, "''")
			default:
				values = append(values, quote(column))
			}
		}
		query := "INSERT INTO " + quote(table.name) + " (" + strings.Join(columns, ",") + ") SELECT " + strings.Join(values, ",") + " FROM incoming." + quote(table.name) + " WHERE account_id=?"
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

// sampleResourceID is the guest sample account resource. normalizeAccountRow
// maps it (and any private account resource) to the store's account row ID:
// accounts/<hash> is owned by user:<hash>; raw row IDs pass through for
// offline operators.
const sampleResourceID = "accounts/sample"

func normalizeAccountRow(id string) string {
	if id == sampleResourceID {
		return sqlite.SampleAccountID
	}
	if rest, ok := strings.CutPrefix(id, "accounts/"); ok {
		return "user:" + rest
	}
	return id
}

type tableShape struct {
	name    string
	columns []string
}

// identityTables are account-scoped but never financial: social membership
// belongs to the group boundary, not to the copied account. They stay
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
				if column == "account_id" {
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
				return nil, fmt.Errorf("unknown account-scoped table %s; review refresh allowlist", name)
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
