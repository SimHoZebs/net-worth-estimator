// Command migrate-plans-to-users performs the one-time shared-plans-v1 to
// shared-accounts-v1 migration in place. TEMPORARY: delete after production
// is migrated and verified. The deploy pipeline calls it via setupdb on
// every deploy; it exits 0 without changes when already migrated.
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
	flags := flag.NewFlagSet("migrate-plans-to-users", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dbPath := flags.String("db", "", "required shared SQLite database path to migrate in place")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if strings.TrimSpace(*dbPath) == "" || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: migrate-plans-to-users --db PATH")
		return 2
	}
	migrated, err := sqlite.MigratePlansToUsers(*dbPath)
	if err != nil {
		fmt.Fprintf(stderr, "migrate plans to users: %v\n", err)
		return 1
	}
	if migrated {
		fmt.Fprintln(stdout, "plans to users migration complete")
	} else {
		fmt.Fprintln(stdout, "already on user scope; nothing to do")
	}
	return 0
}
