// Command simplefin-v2-keys migrates stored SimpleFIN account keys from the
// v1 bare account ID to the connection-scoped v2 key. It also builds the
// private account-to-connection map from a live Bridge read.
//
// The map step is the only provider read. The upgrade step is offline and
// transactional: it rewrites account_links, transaction_sync_keys, and
// suppressed_sync_keys, verifies row counts, and records the migration
// marker. Neither the server nor setupdb calls this tool.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
)

const migrationMarker = "simplefin-v2-keys"

type mappingFile struct {
	Version     int                    `json:"version"`
	GeneratedAt string                 `json:"generatedAt,omitempty"`
	Users       map[string]mappingUser `json:"users"`
}

type mappingUser struct {
	Connections []mappingConnection `json:"connections"`
	Accounts    map[string]string   `json:"accounts"`
}

type mappingConnection struct {
	ConnID string `json:"connId"`
	Name   string `json:"name,omitempty"`
}

type counts struct {
	Users           int
	Links           int
	TransactionKeys int
	SuppressedKeys  int
	Converted       int
	AlreadyCurrent  int
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("simplefin-v2-keys", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dbPath := flags.String("db", "", "existing SQLite database with the app stopped")
	mappingPath := flags.String("mapping", "", "mapping JSON produced by --write-mapping")
	writeMapping := flags.String("write-mapping", "", "read the Bridge and write a private mapping JSON")
	dryRun := flags.Bool("dry-run", false, "perform the conversion in a transaction and roll it back")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if strings.TrimSpace(*dbPath) == "" || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: simplefin-v2-keys --db PATH (--mapping PATH | --write-mapping PATH) [--dry-run]")
		return 2
	}
	if *mappingPath != "" && *writeMapping != "" {
		fmt.Fprintln(stderr, "provide at most one of --mapping or --write-mapping")
		return 2
	}

	if *writeMapping != "" {
		if *dryRun {
			fmt.Fprintln(stderr, "--dry-run is only valid with --mapping")
			return 2
		}
		result, err := buildMapping(*dbPath, *writeMapping)
		if err != nil {
			fmt.Fprintf(stderr, "simplefin v2 map: %v\n", err)
			return 1
		}
		fmt.Fprintf(stdout, "simplefin v2 map complete (%d users, %d connections, %d accounts)\n", result.Users, result.Connections, result.Accounts)
		return 0
	}

	result, err := upgrade(*dbPath, *mappingPath, *dryRun)
	if err != nil {
		fmt.Fprintf(stderr, "simplefin v2 keys: %v\n", err)
		return 1
	}
	if *dryRun {
		fmt.Fprintf(stdout, "simplefin v2 keys dry run (%d users, %d links, %d transaction keys, %d suppressed keys, %d converted)\n",
			result.Users, result.Links, result.TransactionKeys, result.SuppressedKeys, result.Converted)
		return 0
	}
	fmt.Fprintf(stdout, "simplefin v2 keys complete (%d users, %d links, %d transaction keys, %d suppressed keys, %d converted)\n",
		result.Users, result.Links, result.TransactionKeys, result.SuppressedKeys, result.Converted)
	return 0
}

type mappingSummary struct {
	Users       int
	Connections int
	Accounts    int
}

func buildMapping(dbPath, outputPath string) (mappingSummary, error) {
	var summary mappingSummary
	db, err := openDatabase(dbPath, true)
	if err != nil {
		return summary, err
	}
	defer db.Close()

	users, err := simplefinUsers(db)
	if err != nil {
		return summary, err
	}
	result := mappingFile{Version: 1, GeneratedAt: time.Now().UTC().Format(time.RFC3339), Users: map[string]mappingUser{}}
	for _, userID := range users {
		accessURL, err := accessURL(db, userID)
		if err != nil {
			return summary, err
		}
		if accessURL == "" {
			return summary, fmt.Errorf("user %s has SimpleFIN rows but no stored access URL", userID)
		}
		client := &simplefin.Client{
			AccessURL:  accessURL,
			HTTPClient: &http.Client{Timeout: 30 * time.Second},
		}
		now := time.Now().UTC()
		set, err := client.Fetch(context.Background(), now.Add(-90*24*time.Hour), now.Add(24*time.Hour))
		if err != nil {
			return summary, fmt.Errorf("user %s: %w", userID, err)
		}
		if len(set.ErrList) > 0 {
			return summary, fmt.Errorf("user %s returned %d provider errors; resolve them before mapping", userID, len(set.ErrList))
		}
		user := mappingUser{Connections: []mappingConnection{}, Accounts: map[string]string{}}
		for _, connection := range set.Connections {
			user.Connections = append(user.Connections, mappingConnection{ConnID: connection.ConnID, Name: connection.Name})
		}
		for _, account := range set.Accounts {
			if existing, ok := user.Accounts[account.ID]; ok && existing != account.ConnID {
				return summary, fmt.Errorf("user %s has account id %q in two connections; purge and re-sync that user", userID, account.ID)
			}
			user.Accounts[account.ID] = account.ConnID
		}
		if len(user.Accounts) != len(set.Accounts) {
			return summary, fmt.Errorf("user %s account map is not one-to-one", userID)
		}
		result.Users[userID] = user
		summary.Users++
		summary.Connections += len(user.Connections)
		summary.Accounts += len(user.Accounts)
	}

	encoded, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return summary, err
	}
	if err := os.WriteFile(outputPath, append(encoded, '\n'), 0o600); err != nil {
		return summary, fmt.Errorf("write mapping: %w", err)
	}
	if err := os.Chmod(outputPath, 0o600); err != nil {
		return summary, fmt.Errorf("secure mapping: %w", err)
	}
	return summary, nil
}

func upgrade(dbPath, mappingPath string, dryRun bool) (counts, error) {
	var result counts
	// Probe with a read-only connection first so a database with no
	// SimpleFIN rows stays byte-identical and never checkpoints WAL.
	probe, err := openDatabase(dbPath, true)
	if err != nil {
		return result, err
	}
	users, err := simplefinUsers(probe)
	_ = probe.Close()
	if err != nil {
		return result, err
	}
	result.Users = len(users)
	if len(users) == 0 {
		return result, nil
	}
	if strings.TrimSpace(mappingPath) == "" {
		return result, fmt.Errorf("mapping is required because SimpleFIN rows exist")
	}

	db, err := openDatabase(dbPath, false)
	if err != nil {
		return result, err
	}
	defer db.Close()

	rawMapping, err := os.ReadFile(mappingPath)
	if err != nil {
		return result, fmt.Errorf("read mapping: %w", err)
	}
	var mapping mappingFile
	if err := json.Unmarshal(rawMapping, &mapping); err != nil {
		return result, fmt.Errorf("decode mapping: %w", err)
	}
	if mapping.Version != 1 || mapping.Users == nil {
		return result, fmt.Errorf("unsupported mapping version %d", mapping.Version)
	}

	marker, err := markerPresent(db)
	if err != nil {
		return result, err
	}
	if marker && !dryRun {
		// A marked database repeats read-only verification. Any bare key is
		// a partial or foreign mutation and must fail closed.
		for _, userID := range users {
			legacy, err := legacyKeys(db, userID)
			if err != nil {
				return result, err
			}
			if len(legacy) > 0 {
				return result, fmt.Errorf("user %s still has bare SimpleFIN keys after the migration marker", userID)
			}
		}
		return result, nil
	}

	if err := beginImmediate(db); err != nil {
		return result, err
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = db.Exec("ROLLBACK")
		}
	}()

	for _, userID := range users {
		userMapping, ok := mapping.Users[userID]
		if !ok {
			return result, fmt.Errorf("mapping is missing user %s", userID)
		}
		before, err := tableCounts(db, userID)
		if err != nil {
			return result, err
		}
		legacy, err := legacyKeys(db, userID)
		if err != nil {
			return result, err
		}
		result.Links += before.Links
		result.TransactionKeys += before.TransactionKeys
		result.SuppressedKeys += before.SuppressedKeys
		for _, key := range legacy {
			newKey, err := mappedKey(userID, key, userMapping)
			if err != nil {
				return result, err
			}
			if err := rewriteKey(db, userID, key, newKey); err != nil {
				return result, err
			}
			result.Converted++
		}
		after, err := tableCounts(db, userID)
		if err != nil {
			return result, err
		}
		if before.Links != after.Links || before.TransactionKeys != after.TransactionKeys || before.SuppressedKeys != after.SuppressedKeys {
			return result, fmt.Errorf("user %s row counts changed during conversion", userID)
		}
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO schema_migrations(name) VALUES (?)`, migrationMarker); err != nil {
		return result, fmt.Errorf("record migration marker: %w", err)
	}
	if dryRun {
		_, _ = db.Exec("ROLLBACK")
		return result, nil
	}
	if _, err := db.Exec("COMMIT"); err != nil {
		return result, fmt.Errorf("commit conversion: %w", err)
	}
	committed = true
	return result, nil
}

type tableCount struct {
	Links           int
	TransactionKeys int
	SuppressedKeys  int
}

func tableCounts(db *sql.DB, userID string) (tableCount, error) {
	var out tableCount
	if err := db.QueryRow(`SELECT COUNT(*) FROM account_links WHERE user_id = ?`, userID).Scan(&out.Links); err != nil {
		return out, err
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM transaction_sync_keys WHERE user_id = ? AND provider = ?`, userID, "simplefin").Scan(&out.TransactionKeys); err != nil {
		return out, err
	}
	exists, err := tableExists(db, "suppressed_sync_keys")
	if err != nil {
		return out, err
	}
	if exists {
		if err := db.QueryRow(`SELECT COUNT(*) FROM suppressed_sync_keys WHERE user_id = ? AND provider = ?`, userID, "simplefin").Scan(&out.SuppressedKeys); err != nil {
			return out, err
		}
	}
	return out, nil
}

func mappedKey(userID, legacy string, user mappingUser) (string, error) {
	if connID, ok := user.Accounts[legacy]; ok && connID != "" {
		return simplefin.AccountKey(connID, legacy), nil
	}
	if len(user.Connections) == 1 && user.Connections[0].ConnID != "" {
		return simplefin.AccountKey(user.Connections[0].ConnID, legacy), nil
	}
	return "", fmt.Errorf("user %s account %q is not in the mapping and the user has %d connections", userID, legacy, len(user.Connections))
}

func rewriteKey(db *sql.DB, userID, oldKey, newKey string) error {
	if _, err := db.Exec(`UPDATE account_links SET bridge_account_id = ? WHERE user_id = ? AND bridge_account_id = ?`, newKey, userID, oldKey); err != nil {
		return fmt.Errorf("rewrite account link: %w", err)
	}
	if _, err := db.Exec(`UPDATE transaction_sync_keys SET bridge_account_id = ? WHERE user_id = ? AND provider = ? AND bridge_account_id = ?`, newKey, userID, "simplefin", oldKey); err != nil {
		return fmt.Errorf("rewrite transaction key: %w", err)
	}
	exists, err := tableExists(db, "suppressed_sync_keys")
	if err != nil {
		return err
	}
	if exists {
		if _, err := db.Exec(`UPDATE suppressed_sync_keys SET bridge_account_id = ? WHERE user_id = ? AND provider = ? AND bridge_account_id = ?`, newKey, userID, "simplefin", oldKey); err != nil {
			return fmt.Errorf("rewrite suppressed key: %w", err)
		}
	}
	return nil
}

func legacyKeys(db *sql.DB, userID string) ([]string, error) {
	keys := map[string]struct{}{}
	appendKeys := func(rows *sql.Rows, err error) error {
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var key string
			if err := rows.Scan(&key); err != nil {
				return err
			}
			if _, _, ok := simplefin.ParseAccountKey(key); !ok {
				keys[key] = struct{}{}
			}
		}
		return rows.Err()
	}
	if err := appendKeys(db.Query(`SELECT bridge_account_id FROM account_links WHERE user_id = ?`, userID)); err != nil {
		return nil, err
	}
	if err := appendKeys(db.Query(`SELECT bridge_account_id FROM transaction_sync_keys WHERE user_id = ? AND provider = ?`, userID, "simplefin")); err != nil {
		return nil, err
	}
	exists, err := tableExists(db, "suppressed_sync_keys")
	if err != nil {
		return nil, err
	}
	if exists {
		if err := appendKeys(db.Query(`SELECT bridge_account_id FROM suppressed_sync_keys WHERE user_id = ? AND provider = ?`, userID, "simplefin")); err != nil {
			return nil, err
		}
	}
	out := make([]string, 0, len(keys))
	for key := range keys {
		out = append(out, key)
	}
	sort.Strings(out)
	return out, nil
}

func simplefinUsers(db *sql.DB) ([]string, error) {
	queries := []string{
		`SELECT user_id FROM account_links`,
		`SELECT user_id FROM transaction_sync_keys WHERE provider = 'simplefin'`,
	}
	exists, err := tableExists(db, "suppressed_sync_keys")
	if err != nil {
		return nil, err
	}
	if exists {
		queries = append(queries, `SELECT user_id FROM suppressed_sync_keys WHERE provider = 'simplefin'`)
	}
	seen := map[string]struct{}{}
	for _, query := range queries {
		rows, err := db.Query(query)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var userID string
			if err := rows.Scan(&userID); err != nil {
				rows.Close()
				return nil, err
			}
			seen[userID] = struct{}{}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	out := make([]string, 0, len(seen))
	for userID := range seen {
		out = append(out, userID)
	}
	sort.Strings(out)
	return out, nil
}

func accessURL(db *sql.DB, userID string) (string, error) {
	var value string
	err := db.QueryRow(`SELECT access_url FROM sync_credentials WHERE user_id = ? AND id = 1`, userID).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(value), nil
}

func markerPresent(db *sql.DB) (bool, error) {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE name = ?`, migrationMarker).Scan(&count); err != nil {
		return false, err
	}
	return count == 1, nil
}

func beginImmediate(db *sql.DB) error {
	if _, err := db.Exec("BEGIN IMMEDIATE"); err != nil {
		return fmt.Errorf("begin conversion: %w", err)
	}
	return nil
}

func tableExists(db *sql.DB, name string) (bool, error) {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name).Scan(&count); err != nil {
		return false, err
	}
	return count == 1, nil
}

func openDatabase(path string, readOnly bool) (*sql.DB, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return nil, err
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil || resolved != abs || !info.Mode().IsRegular() {
		return nil, fmt.Errorf("database must be an existing regular file without symlinks")
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		info, err := os.Lstat(abs + suffix)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("database sidecars must be regular files without symlinks")
		}
	}
	if !readOnly {
		if _, err := os.Lstat(abs + "-journal"); err == nil {
			return nil, fmt.Errorf("database has a hot rollback journal; stop every writer and retry")
		} else if !os.IsNotExist(err) {
			return nil, err
		}
	}
	u := &url.URL{Scheme: "file", Path: abs}
	mode := "?mode=rw&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	if readOnly {
		mode = "?mode=ro&_pragma=busy_timeout(5000)"
	}
	db, err := sql.Open("sqlite", u.String()+mode)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
