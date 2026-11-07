package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestCurrentPositionMatchesProjection(t *testing.T) {
	for _, name := range []string{"deterministic.json", "checkpoints.json", "payroll.json"} {
		t.Run(name, func(t *testing.T) {
			fixture := loadGolden(t, name)
			model := decodeModel(t, fixture["model"])
			settings := decodeSettings(t, fixture["settings"])
			overrides := decodeOverrides(t, fixture["overrides"])
			position, err := ResolveCurrentPosition(model, settings.FallbackProjectionStartDate, overrides)
			if err != nil {
				t.Fatal(err)
			}
			_, projection, err := ProjectRawFinancialModel(model, settings, overrides, nil)
			if err != nil {
				t.Fatal(err)
			}
			if position.NetWorth != projection.Summary.CurrentNetWorth {
				t.Fatalf("position=%v forecast current=%v", position.NetWorth, projection.Summary.CurrentNetWorth)
			}
			for index, account := range position.Accounts {
				if account.AccountID != projection.AccountSummaries[index].AccountID || account.Balance != projection.AccountSummaries[index].StartingBalance {
					t.Fatalf("account mismatch: %+v vs %+v", account, projection.AccountSummaries[index])
				}
			}
		})
	}
}

func TestCurrentPositionRejectsInvalidHistoryAndDate(t *testing.T) {
	fixture := loadGolden(t, "checkpoints.json")
	model := decodeModel(t, fixture["model"])
	for _, date := range []string{"not-a-date"} {
		if _, err := ResolveCurrentPosition(model, date, types.ModelOverrides{}); err == nil {
			t.Fatalf("accepted date %s", date)
		}
	}
}

func TestHistoricalPositionIgnoresLaterObservationsWithoutMutatingModel(t *testing.T) {
	model := &types.FinancialModel{
		Accounts: []types.Account{{ID: "checking", Name: "Checking", Kind: "cash", Enabled: true}, {ID: "other", Name: "Other", Kind: "cash", Enabled: true}},
		Checkpoints: []types.Checkpoint{
			{AccountID: "checking", Balance: 100, ObservedAt: 1773133200},
			{AccountID: "checking", Balance: 900, ObservedAt: 1773306000},
			{AccountID: "other", Balance: 800, ObservedAt: 1773306000},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	position, err := ResolveCurrentPosition(model, "2026-03-10T12:00:00Z", types.ModelOverrides{})
	if err != nil {
		t.Fatal(err)
	}
	if position.Accounts[0].Balance != 100 || position.Accounts[1].Balance != 0 {
		t.Fatalf("later observations leaked: %+v", position.Accounts)
	}
	if len(model.Checkpoints) != 3 || model.Checkpoints[1].Balance != 900 {
		t.Fatal("read mutated model")
	}
}
