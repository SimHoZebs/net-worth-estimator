// Command importcsv seeds the SQLite store from the canonical CSV files.
package main

import (
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("importcsv", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dbPath := flags.String("db", "", "required existing shared SQLite database path")
	planID := flags.String("plan", "", "required existing plan resource ID")
	modelPath := flags.String("model", "public/configs", "directory containing model CSV files")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	if *dbPath == "" || *planID == "" || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: importcsv --db EXISTING.db --plan plans/RESOURCE [--model directory]")
		return 2
	}
	if info, err := os.Stat(*dbPath); err != nil || !info.Mode().IsRegular() {
		fmt.Fprintln(stderr, "--db must name an existing shared database")
		return 1
	}
	database, err := store.OpenDatabase(*dbPath)
	if err != nil {
		fmt.Fprintf(stderr, "open store: %v\n", err)
		return 1
	}
	defer database.Close()
	plan, err := database.Plan(*planID)
	if err != nil {
		fmt.Fprintf(stderr, "select existing plan: %v\n", err)
		return 1
	}
	if _, err := plan.ImportCSV(*modelPath); err != nil {
		fmt.Fprintf(stderr, "import: %v\n", err)
		return 1
	}
	fmt.Fprintln(stdout, "imported CSV into the selected plan")
	return 0
}
