// Command seedtest injects or clears tagged bulk rows for one user in an
// existing application database. It is a local operator helper for
// development and test setup. It is not built into the deployment image,
// and the production server never calls it.
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/integrationfixtures"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// normalizeUserRow maps a user resource to the store's user row ID:
// users/<hash> is owned by user:<hash>; raw row IDs pass through for
// offline operators. Only ordinary current users are supported.
func normalizeUserRow(id string) string {
	if rest, ok := strings.CutPrefix(id, "users/"); ok {
		return "user:" + rest
	}
	return id
}

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("seedtest", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dbPath := flags.String("db", "", "required existing application database path")
	user := flags.String("user", "", "required existing destination user ID (users/<64hex>)")
	bulk := flags.String("bulk", "", "bulk spec NxM[:seed], for example 20x200:7")
	clear := flags.Bool("clear", false, "remove tagged bulk rows instead of injecting")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if strings.TrimSpace(*dbPath) == "" || strings.TrimSpace(*user) == "" || flags.NArg() != 0 {
		fmt.Fprintln(stderr, "usage: seedtest --db PATH --user users/<64hex> [--bulk NxM[:seed] | --clear]")
		return 2
	}
	if *clear == (*bulk != "") {
		fmt.Fprintln(stderr, "usage: seedtest --db PATH --user users/<64hex> [--bulk NxM[:seed] | --clear]")
		return 2
	}
	var spec integrationfixtures.BulkSpec
	if !*clear {
		parsed, err := integrationfixtures.ParseBulkSpec(*bulk)
		if err != nil {
			fmt.Fprintf(stderr, "bulk spec: %v\n", err)
			return 2
		}
		if parsed.Accounts == 0 {
			fmt.Fprintln(stderr, "usage: seedtest --db PATH --user users/<64hex> [--bulk NxM[:seed] | --clear]")
			return 2
		}
		spec = parsed
	}
	database, err := sqlite.OpenDatabase(*dbPath)
	if err != nil {
		fmt.Fprintf(stderr, "open database: %v\n", err)
		return 1
	}
	defer database.Close()
	row := normalizeUserRow(*user)
	present, err := database.HasUser(row)
	if err != nil {
		fmt.Fprintf(stderr, "resolve user: %v\n", err)
		return 1
	}
	if !present {
		fmt.Fprintf(stderr, "destination user must already exist: %s\n", *user)
		return 1
	}
	scoped, err := database.User(row)
	if err != nil {
		fmt.Fprintf(stderr, "resolve user: %v\n", err)
		return 1
	}
	if *clear {
		result, err := integrationfixtures.ClearSeed(scoped)
		if err != nil {
			fmt.Fprintf(stderr, "clear bulk: %v\n", err)
			return 1
		}
		fmt.Fprintf(stdout, "cleared bulk: %d accounts, %d transactions, %d rules\n", result.Accounts, result.Transactions, result.Rules)
		return 0
	}
	result, err := integrationfixtures.InjectBulk(scoped, spec)
	if err != nil {
		fmt.Fprintf(stderr, "inject bulk: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "injected bulk: %d accounts, %d transactions, %d rules\n", result.Accounts, result.Transactions, result.Rules)
	return 0
}
