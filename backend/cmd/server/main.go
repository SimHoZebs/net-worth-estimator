// Command server runs the net-worth-estimator backend.
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func main() {
	port := 8787
	if parsed, err := strconv.Atoi(envOr("PORT", "8787")); err == nil && parsed > 0 {
		port = parsed
	}
	dbPath := envOr("NET_WORTH_ESTIMATOR_DB", filepath.Join(os.TempDir(), "net-worth-estimator.db"))
	modelPath := envOr("NET_WORTH_ESTIMATOR_MODEL_PATH", "public/configs")
	incomePath := envOr("NET_WORTH_ESTIMATOR_INCOME_PATH", "public/data/income")

	database, err := store.Open(dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer database.Close()

	exists, err := database.DocumentExists()
	if err != nil {
		log.Fatalf("check store: %v", err)
	}
	if !exists {
		if err := database.ImportCSV(modelPath, incomePath); err != nil {
			log.Fatalf("seed from CSV: %v", err)
		}
		fmt.Printf("seeded database from %s and %s\n", modelPath, incomePath)
	}

	handler := api.New(database, modelPath, incomePath)
	address := fmt.Sprintf(":%d", port)
	fmt.Printf("listening on %s\n", address)
	if err := http.ListenAndServe(address, handler); err != nil {
		log.Fatalf("server: %v", err)
	}
}
