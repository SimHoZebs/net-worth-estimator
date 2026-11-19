package safespending

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestSafeSpendingEvaluationStaysOutsideProjectionAndConfigurableTables(t *testing.T) {
	definition, ok := evidenceEvaluations.Get(evaluationType)
	if !ok || definition.NeedsProjectionPath() || definition.IsSimulator() {
		t.Fatal("Safe Spending must register as a projection-free reader")
	}
	if _, ok := domain.EvaluationRegistryInstance.Get(evaluationType); ok {
		t.Fatal("Safe Spending must not be registered in the projection registry")
	}
	configured := types.EmptyEvaluationTables()
	if configured.ByType(evaluationType) != nil {
		t.Fatal("Safe Spending must not be a configurable evaluation")
	}
}

func TestSafeSpendingEvaluationUsesRequestedSettingsWindowAndFactualCut(t *testing.T) {
	const start, end = "2026-11-15", "2026-11-17"
	m := baseModel()
	m.Checkpoints = append(m.Checkpoints, types.Checkpoint{
		AccountID: "checking", Balance: 9999, AvailableBalance: ptr(9999.0), ObservedAt: stamp("2026-11-15T13:00:00Z"),
	})
	m.Schedules = []types.Schedule{
		bill("included", end, 20),
		bill("excluded-by-settings", start, 50),
		bill("excluded-by-window", "2026-11-18", 70),
	}
	settings := &types.SafeSpendingSettings{
		SpendingAccountIDs: []string{"checking"},
		TransactionIDs:     []string{"included", "excluded-by-window"},
	}
	got, err := Evaluate(m, settings, start, end, stamp("2026-11-15T12:00:00Z"))
	if err != nil {
		t.Fatal(err)
	}
	if got.Start != start || got.End != end || got.Status != "available" ||
		len(got.OutstandingObligations) != 1 || got.OutstandingObligations[0].Name != "included" {
		t.Fatalf("unexpected Safe Spending summary: %+v", got)
	}
	assertMoney(t, got.CheckingAvailable, 1244.43)
	assertMoney(t, got.OutstandingBillsTotal, 20)
	assertMoney(t, got.CashAfterBills, 1224.43)
}
