// Command migratedb merges explicit legacy SQLite sources into a new shared
// database. Stop every application service before use. Sources remain read-only.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/simhozebs/net-worth-estimator/backend/internal/dbmigration"
)

func main() {
	manifest := flag.String("manifest", "", "required version-1 JSON migration manifest")
	db := flag.String("db", "", "required NEW shared database path (must not exist)")
	dry := flag.Bool("dry-run", false, "validate and verify a disposable target without publishing")
	flag.Parse()
	if *manifest == "" || *db == "" || flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "usage: migratedb --manifest manifest.json --db NEW.db [--dry-run]; stop all services first")
		os.Exit(2)
	}
	m, err := dbmigration.ReadManifest(*manifest)
	if err == nil {
		var report dbmigration.Report
		report, err = dbmigration.Run(m, *db, *dry)
		if err == nil {
			json.NewEncoder(os.Stdout).Encode(report)
			return
		}
	}
	fmt.Fprintln(os.Stderr, "migration failed:", err)
	os.Exit(1)
}
