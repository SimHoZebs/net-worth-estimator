// Command syncaudit lists phantom void bank rows for one model account:
// voids with exactly one tip-bounded settled sibling under the same
// join the live reconciler uses for pending-to-posted transitions.
// Read-only: it never writes, so it runs safely against a live database.
// The listing doubles as the review artifact the backend lifecycle would
// auto-apply on fresh feeds; historical pairs never reappear in a feed,
// so the operator reviews them here instead.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"text/tabwriter"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "syncaudit:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	fs := flag.NewFlagSet("syncaudit", flag.ContinueOnError)
	dbPath := fs.String("db", "", "existing application database")
	userID := fs.String("user", "", "existing user ID owning the account")
	account := fs.String("account", "", "model account ID to audit")
	format := fs.String("format", "", "output format: table or json (default table)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *dbPath == "" || *userID == "" || *account == "" {
		fs.Usage()
		return fmt.Errorf("db, user, and account are required")
	}
	if *format == "" {
		*format = "table"
	}
	if *format != "table" && *format != "json" {
		return fmt.Errorf("format must be table or json")
	}
	database, err := sqlite.OpenDatabase(*dbPath)
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	defer database.Close()
	if ok, err := database.HasUser(*userID); err != nil || !ok {
		if err == nil {
			err = fmt.Errorf("unknown user %s", *userID)
		}
		return err
	}
	scoped, err := database.User(*userID)
	if err != nil {
		return fmt.Errorf("scope store: %w", err)
	}
	model, err := scoped.LoadModel()
	if err != nil {
		return fmt.Errorf("load model: %w", err)
	}
	known := false
	for _, row := range model.Accounts {
		if row.ID == *account {
			known = true
			break
		}
	}
	if !known {
		return fmt.Errorf("unknown model account %s", *account)
	}
	bank, err := scoped.LoadBankPostings()
	if err != nil {
		return fmt.Errorf("load bank postings: %w", err)
	}
	return printPairs(*format, simplefin.AuditHistoricalVoids(bank, *account))
}

func printPairs(format string, pairs []simplefin.HistoricalVoidPair) error {
	if format == "json" {
		raw, err := json.MarshalIndent(pairs, "", "  ")
		if err != nil {
			return err
		}
		if pairs == nil {
			raw = []byte("[]")
		}
		fmt.Println(string(raw))
		return nil
	}
	if len(pairs) == 0 {
		fmt.Println("no phantom voids")
		return nil
	}
	writer := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(writer, "VOID\tSETTLED\tNAME\tVOID\tSETTLED\tVOID DAY\tPOSTED DAY")
	for _, pair := range pairs {
		fmt.Fprintf(writer, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
			pair.VoidID, pair.SettledID, pair.Name, pair.VoidAmount, pair.SettledAmount,
			time.Unix(pair.VoidTime, 0).UTC().Format("2006-01-02"),
			time.Unix(pair.SettledTime, 0).UTC().Format("2006-01-02"))
	}
	return writer.Flush()
}
