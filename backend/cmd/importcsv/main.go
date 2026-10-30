// Command importcsv seeds the SQLite store from the canonical CSV files.
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/csvio"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("importcsv", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dbPath := flags.String("db", "", "required existing shared SQLite database path")
	userID := flags.String("user", "", "required existing user resource ID")
	modelPath := flags.String("model", "public/configs", "directory containing model CSV files")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	if *dbPath == "" || *userID == "" || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: importcsv --db EXISTING.db --user users/RESOURCE [--model directory]")
		return 2
	}
	if info, err := os.Stat(*dbPath); err != nil || !info.Mode().IsRegular() {
		fmt.Fprintln(stderr, "--db must name an existing shared database")
		return 1
	}
	database, err := sqlite.OpenDatabase(*dbPath)
	if err != nil {
		fmt.Fprintf(stderr, "open store: %v\n", err)
		return 1
	}
	defer database.Close()
	rowID := normalizeUserID(*userID)
	if rowID == "sample" || rowID == "fixture" {
		fmt.Fprintln(stderr, "refusing to reset legacy historical rows")
		return 1
	}
	user, err := database.User(rowID)
	if err != nil {
		fmt.Fprintf(stderr, "select existing user: %v\n", err)
		return 1
	}
	doc, err := csvio.ImportModel(*modelPath)
	if err != nil {
		fmt.Fprintf(stderr, "import: %v\n", err)
		return 1
	}
	if _, err := user.ImportDocument(doc); err != nil {
		fmt.Fprintf(stderr, "import: %v\n", err)
		return 1
	}
	fmt.Fprintln(stdout, "imported CSV into the selected user")
	return 0
}

// normalizeUserID maps a user resource to its store row: users/<hash>
// is owned by user:<hash>; raw row IDs pass through for offline operators.
func normalizeUserID(id string) string {
	if rest, ok := strings.CutPrefix(id, "users/"); ok {
		return "user:" + rest
	}
	return id
}
