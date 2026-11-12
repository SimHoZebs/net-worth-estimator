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

// A checkpoint that matches the modeled balance reconciles nothing: it must
// stay out of the adjustment rows while still applying and remaining the
// account's latest observation.
func TestBalanceAdjustmentsOmitZeroDeltaObservation(t *testing.T) {
	model := observerFixture()
	rows, err := ResolveBalanceAdjustments(model, "2026-03-10T16:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("want only the 09:00 adjustment, got %+v", rows)
	}
	if rows[0].ObservedAt != unixAt(10, 9) || rows[0].PreviousBalance != 0 || rows[0].Balance != 1000 || rows[0].Adjustment != 1000 {
		t.Fatalf("incorrect adjustment: %+v", rows[0])
	}
	position, err := ResolveCurrentPosition(model, "2026-03-10T16:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if position.Accounts[0].Balance != 900 {
		t.Fatalf("zero-delta observation must still apply: %+v", position.Accounts[0])
	}
	if position.Accounts[0].ObservedBalance == nil || *position.Accounts[0].ObservedBalance != 900 || position.Accounts[0].ObservedAt == nil || *position.Accounts[0].ObservedAt != unixAt(10, 15) {
		t.Fatalf("15:00 observation must remain the latest observation: %+v", position.Accounts[0])
	}
}
