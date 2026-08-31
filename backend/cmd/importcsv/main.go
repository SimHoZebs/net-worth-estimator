// Command importcsv seeds the SQLite store from the canonical CSV files.
package main

import (
	"flag"
	"fmt"
	"log"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

func main() {
	dbPath := flag.String("db", "net-worth-estimator.db", "SQLite database path")
	modelPath := flag.String("model", "public/configs", "directory containing model CSV files")
	incomePath := flag.String("income", "public/data/income", "directory containing income CSV files")
	flag.Parse()

	database, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer database.Close()
	if _, _, err := database.ImportCSV(*modelPath, *incomePath); err != nil {
		log.Fatalf("import: %v", err)
	}
	fmt.Printf("imported %s and %s into %s\n", *modelPath, *incomePath, *dbPath)
}
