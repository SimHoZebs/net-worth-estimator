package domain

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
	"testing"
)

func TestBalanceAdjustmentsUseExactReplayWithoutForecast(t *testing.T) {
	model := observerFixture()
	model.Checkpoints[1].Balance = 850
	model.Checkpoints[1].Source = "user"
	rows, err := ResolveBalanceAdjustments(model, "2026-03-10T16:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("want both same-day observations, got %+v", rows)
	}
	if rows[0].ObservedAt != unixAt(10, 9) || rows[1].ObservedAt != unixAt(10, 15) || rows[1].PreviousBalance != 900 || rows[1].Balance != 850 || rows[1].Adjustment != -50 || rows[1].Source != "user" {
		t.Fatalf("incorrect evidence: %+v", rows)
	}
	position, err := ResolveCurrentPosition(model, "2026-03-10T16:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if position.Accounts[0].Balance != rows[1].Balance || len(model.Transactions) != 1 {
		t.Fatal("adjustment must reconcile balance without creating a transaction")
	}
	rows, err = ResolveBalanceAdjustments(model, "2026-03-10T12:00:00Z")
	if err != nil || len(rows) != 1 {
		t.Fatalf("cut must omit later observations: %+v %v", rows, err)
	}
}
