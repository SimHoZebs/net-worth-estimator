package store

import (
	"encoding/json"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func decodeMigratedAmount(t *testing.T, raw string) types.PostingAmountResolution {
	t.Helper()
	var amount types.PostingAmountResolution
	if err := json.Unmarshal([]byte(raw), &amount); err != nil {
		t.Fatalf("decode migrated amount: %v", err)
	}
	return amount
}

func TestMigrateV12FoldsRateIntoOccurrenceRate(t *testing.T) {
	rewritten, err := migrateV12Amount(
		`{"resolver":"expression","config":{"expression":"bal * rate"},"inputs":{"bal":{"source":"provider","provider":"model-value","arguments":{"id":"vault"}},"rate":{"source":"provider","provider":"occurrence-rate","arguments":{}}}}`,
		0.12, 0, 0.3,
	)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	amount := decodeMigratedAmount(t, rewritten)
	rate, ok := amount.Inputs["rate"]
	if !ok {
		t.Fatalf("migrated inputs = %+v, want a rate input", amount.Inputs)
	}
	if rate.Arguments["annualRate"] != 0.12 || rate.Arguments["volatility"] != 0.3 {
		t.Fatalf("migrated rate args = %+v", rate.Arguments)
	}
}

func TestMigrateV12DropsInertRates(t *testing.T) {
	rewritten, err := migrateV12Amount(
		`{"resolver":"expression","config":{"expression":"1000"},"inputs":{}}`,
		0, 0, 0.08,
	)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	amount := decodeMigratedAmount(t, rewritten)
	if len(amount.Inputs) != 0 {
		t.Fatalf("migrated inputs = %+v, want none", amount.Inputs)
	}
	if expression, _ := amount.Config["expression"].(string); expression != "1000" {
		t.Fatalf("migrated expression = %q, want 1000", expression)
	}
}

func TestMigrateV12RewritesGrowthExplicitly(t *testing.T) {
	rewritten, err := migrateV12Amount(
		`{"resolver":"expression","config":{"expression":"250"},"inputs":{}}`,
		0, 0.02, 0,
	)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	amount := decodeMigratedAmount(t, rewritten)
	growth, ok := amount.Inputs["growth"]
	if !ok || growth.Provider != "growth-factor" {
		t.Fatalf("migrated inputs = %+v, want a growth-factor input", amount.Inputs)
	}
	if growth.Arguments["annualGrowthRate"] != 0.02 {
		t.Fatalf("migrated growth args = %+v", growth.Arguments)
	}
	if expression, _ := amount.Config["expression"].(string); expression != "(250) * growth" {
		t.Fatalf("migrated expression = %q", expression)
	}
}

func TestMigrateV12KeepsExistingRateArgs(t *testing.T) {
	rewritten, err := migrateV12Amount(
		`{"resolver":"expression","config":{"expression":"bal * rate"},"inputs":{"rate":{"source":"provider","provider":"occurrence-rate","arguments":{"annualRate":0.07,"volatility":0.15}}}}`,
		0.99, 0, 0.99,
	)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	amount := decodeMigratedAmount(t, rewritten)
	rate := amount.Inputs["rate"]
	if rate.Arguments["annualRate"] != 0.07 || rate.Arguments["volatility"] != 0.15 {
		t.Fatalf("migrated rate args = %+v, want existing values kept", rate.Arguments)
	}
}
