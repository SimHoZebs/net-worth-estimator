package domain

import (
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func recordedHistoryInstant(month time.Month, day, hour int) int64 {
	return time.Date(2026, month, day, hour, 0, 0, 0, time.UTC).Unix()
}

func recordedHistoryModel() *types.FinancialModel {
	account := "checking"
	cap := 2500.0
	return &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 10000, Source: "banksync", ObservedAt: time.Date(2025, time.December, 1, 9, 0, 0, 0, time.UTC).Unix()},
			{AccountID: account, Balance: 10500, Source: "banksync", ObservedAt: recordedHistoryInstant(time.January, 15, 9)},
			{AccountID: account, Balance: 9300, Source: "banksync", ObservedAt: recordedHistoryInstant(time.February, 20, 9)},
		},
		Transactions: []types.Transaction{
			{
				ID: "rent-feb-actual", Name: "February rent", SourceAccountID: &account,
				Amount: expenseAmount("950"), TransactionTime: recordedHistoryInstant(time.February, 5, 12),
				PostedTime: recordedHistoryInstant(time.February, 5, 12), Enabled: true, Source: "user",
				Claim: &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-02-01"},
			},
			{
				ID: "backdated-inflow", Name: "Backdated inflow", Destinations: []string{account},
				Amount: expenseAmount("500"), TransactionTime: recordedHistoryInstant(time.January, 20, 12),
				PostedTime: recordedHistoryInstant(time.January, 20, 12), Enabled: true, Source: "user",
			},
		},
		Schedules: []types.Schedule{{
			ID: "rent", Name: "Rent", SourceAccountID: &account, Amount: expenseAmount("1000"),
			Recurrence: monthlyTestRecurrence(), StartDate: "2026-01-01", AnnualCap: &cap, Priority: 1, Enabled: true,
		}},
		Evaluations: types.EmptyEvaluationTables(),
	}
}

func TestRecordedHistoryReadMatchesFullPreparation(t *testing.T) {
	model := recordedHistoryModel()
	settings := &types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: "2026-03-01", HorizonYears: 1, Evaluations: types.EmptyEvaluationTables(),
	}
	rows, balances, err := HistoricalProjectionRows(model, settings, types.EmptyModelOverrides())
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := PrepareSimulationRequest(model, settings, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(balances, prepared.Request.InitialState.Balances) {
		t.Fatalf("recorded balances = %v, full preparation = %v", balances, prepared.Request.InitialState.Balances)
	}
	if balances["checking"] != 9300 {
		t.Fatalf("latest checkpoint must win, got %v", balances["checking"])
	}
	path, _, err := ProjectRawFinancialModel(model, settings, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	historical := make([]types.ProjectionRow, 0, len(path.Rows))
	for _, row := range path.Rows {
		if row.IsHistorical {
			historical = append(historical, row)
		}
	}
	if !reflect.DeepEqual(rows, historical) {
		t.Fatalf("recorded rows differ from full projection:\nrecorded=%+v\nfull=%+v", rows, historical)
	}
	if got := prepared.Request.InitialState.RealizedTransactionAmountsByYear["rent"]["2026"]; got != 2000 {
		t.Fatalf("modeled schedule ledger = %v, want January plus March", got)
	}
	if got := prepared.Request.InitialState.RealizedTransactionAmountsByYear["rent-feb-actual"]["2026"]; got != 950 {
		t.Fatalf("claimed actual ledger = %v, want 950", got)
	}
	if got := prepared.Request.InitialState.RealizedTransactionAmountsByYear["backdated-inflow"]["2026"]; got != 500 {
		t.Fatalf("backdated actual ledger = %v, want 500", got)
	}
}

func TestRecordedHistoryReadPreservesCutoffAndValidation(t *testing.T) {
	model := recordedHistoryModel()
	model.Checkpoints[2].Balance = 10050
	model.Checkpoints = append(model.Checkpoints, types.Checkpoint{
		AccountID: "checking", Balance: 9000, ObservedAt: recordedHistoryInstant(time.March, 1, 15),
	})
	cut := recordedHistoryInstant(time.March, 1, 12)
	settings := &types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: "2026-03-01", HorizonYears: 1,
		AsOfInstant: &cut, Evaluations: types.EmptyEvaluationTables(),
	}
	rows, balances, err := HistoricalProjectionRows(model, settings, types.EmptyModelOverrides())
	if err != nil {
		t.Fatal(err)
	}
	if balances["checking"] != 10050 {
		t.Fatalf("balance at intraday cutoff = %v, want 10050", balances["checking"])
	}
	for _, row := range rows {
		if row.Date == "2026-03-01" {
			t.Fatal("checkpoint after the cutoff appeared in recorded history")
		}
	}
	prepared, err := PrepareSimulationRequest(model, settings, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(balances, prepared.Request.InitialState.Balances) {
		t.Fatalf("cutoff balances differ: %v vs %v", balances, prepared.Request.InitialState.Balances)
	}

	model.Checkpoints = append(model.Checkpoints, types.Checkpoint{
		AccountID: "checking", Balance: 1, ObservedAt: recordedHistoryInstant(time.March, 2, 9),
	})
	settings.AsOfInstant = nil
	if _, _, err := HistoricalProjectionRows(model, settings, types.EmptyModelOverrides()); err == nil {
		t.Fatal("recorded-history read accepted a checkpoint after projection start")
	} else {
		var preparationErr *SimulationPreparationError
		if !errors.As(err, &preparationErr) {
			t.Fatalf("recorded-history error = %T, want preparation error", err)
		}
	}
	if _, err := PrepareSimulationRequest(model, settings, types.EmptyModelOverrides(), nil); err == nil {
		t.Fatal("full preparation accepted a checkpoint after projection start")
	}
}
