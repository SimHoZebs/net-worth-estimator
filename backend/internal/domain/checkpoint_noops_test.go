package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestNoopCheckpointKeysUseRawBalance(t *testing.T) {
	model := observerFixture()
	keys, err := NoopCheckpointKeys(model, "2026-03-10T16:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	key := ObservationKey{AccountID: "checking", ObservedAt: unixAt(10, 15)}
	if _, ok := keys[key]; !ok {
		t.Fatalf("15:00 checkpoint should be a raw no-op: %+v", keys)
	}
	if _, ok := keys[ObservationKey{AccountID: "checking", ObservedAt: unixAt(10, 9)}]; ok {
		t.Fatalf("09:00 checkpoint changes the opening balance: %+v", keys)
	}

	model.Checkpoints[1].Balance = 900.4
	keys, err = NoopCheckpointKeys(model, "2026-03-10T16:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := keys[key]; ok {
		t.Fatalf("a sub-dollar balance change must not be treated as a no-op: %+v", keys)
	}
}

func TestNoopCheckpointKeysIgnoreScheduledGuesses(t *testing.T) {
	account := "checking"
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 100, ObservedAt: unixAt(10, 9)},
			{AccountID: account, Balance: 110, ObservedAt: unixAt(12, 9)},
			{AccountID: account, Balance: 110, ObservedAt: unixAt(13, 9)},
		},
		Schedules: []types.Schedule{{
			ID: "guessed-income", Name: "Guessed income", Destinations: []string{account},
			Amount: expenseAmount("10"), Recurrence: monthlyTestRecurrence(),
			StartDate: "2026-03-11", Enabled: true,
		}},
		Evaluations: types.EmptyEvaluationTables(),
	}
	keys, err := NoopCheckpointKeys(model, "2026-03-13T16:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := keys[ObservationKey{AccountID: account, ObservedAt: unixAt(12, 9)}]; ok {
		t.Fatalf("checkpoint must reset the actual-only balance from 100 to 110: %+v", keys)
	}
	if _, ok := keys[ObservationKey{AccountID: account, ObservedAt: unixAt(13, 9)}]; !ok {
		t.Fatalf("checkpoint matching the actual-only balance must remain a no-op: %+v", keys)
	}
}
