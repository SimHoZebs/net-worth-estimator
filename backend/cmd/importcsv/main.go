// Command importcsv seeds the SQLite store from the canonical CSV files.
package main

import (
	"flag"
	"fmt"
	"io"
	"os"

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
	accountID := flags.String("account", "", "required existing account scope ID")
	legacyPlan := flags.String("plan", "", "deprecated alias for --account")
	modelPath := flags.String("model", "public/configs", "directory containing model CSV files")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *legacyPlan != "" {
		if *accountID != "" {
			fmt.Fprintln(stderr, "--plan and --account conflict; use --account")
			return 2
		}
		*accountID = *legacyPlan
	}
	*accountID = sqlite.NormalizeAccountID(*accountID)

	if *dbPath == "" || *accountID == "" || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: importcsv --db EXISTING.db --account user:<hash>|<name>|sample [--model directory]")
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
	plan, err := database.Account(*accountID)
	if err != nil {
		fmt.Fprintf(stderr, "select existing account scope: %v\n", err)
		return 1
	}
	doc, err := csvio.ImportModel(*modelPath)
	if err != nil {
		fmt.Fprintf(stderr, "import: %v\n", err)
		return 1
	}
	if _, err := plan.ImportDocument(doc); err != nil {
		fmt.Fprintf(stderr, "import: %v\n", err)
		return 1
	}
	fmt.Fprintln(stdout, "imported CSV into the selected account scope")
	return 0
}
