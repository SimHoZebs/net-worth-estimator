// Command setupdb explicitly provisions the shared application database.
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("setupdb", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dbPath := flags.String("db", "", "required shared SQLite database path to provision")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if strings.TrimSpace(*dbPath) == "" || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: setupdb --db PATH")
		return 2
	}
	// TEMPORARY (remove after production is migrated and verified):
	// run the one-time plans-to-users migration before provisioning.
	// No-op on databases that are already on user scope or do not exist yet.
	if _, statErr := os.Stat(*dbPath); statErr == nil {
		migrated, err := sqlite.MigratePlansToUsers(*dbPath)
		if err != nil {
			fmt.Fprintf(stderr, "migrate plans to users: %v\n", err)
			return 1
		}
		if migrated {
			fmt.Fprintln(stdout, "plans to users migration complete")
		}
	} else if !os.IsNotExist(statErr) {
		fmt.Fprintf(stderr, "stat database: %v\n", statErr)
		return 1
	}
	database, err := sqlite.SetupDatabase(*dbPath)
	if err != nil {
		fmt.Fprintf(stderr, "setup database: %v\n", err)
		return 1
	}
	if err := database.Close(); err != nil {
		fmt.Fprintf(stderr, "close database: %v\n", err)
		return 1
	}
	fmt.Fprintln(stdout, "application database setup complete")
	return 0
}
