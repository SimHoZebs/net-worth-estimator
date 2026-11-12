package integration

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func importTestModel() types.FinancialModel {
	return types.FinancialModel{
		Accounts: []types.Account{
			{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true, Display: types.PassthroughDisplay("checking", "Checking")},
			{ID: "savings", Name: "Savings", Kind: types.AccountKindCash, Enabled: true, Display: types.PassthroughDisplay("savings", "Savings")},
		},
		Checkpoints: []types.Checkpoint{},
		Transactions: []types.Transaction{{
			ID: "01900000-0000-7000-8000-000000000001", Name: "Rent", SourceAccountID: ptr("checking"),
			Destinations: []string{"savings"},
			Amount: types.TransactionAmountResolution{
				Resolver: "expression",
				Config:   map[string]any{"expression": "100"},
				Inputs:   map[string]types.AmountInputBinding{},
			},
			PostedTime:      1785542400,
			TransactionTime: 1785542400,
			Enabled:         true,
			Source:          "simplefin",
			Pending:         true,
			ExecutionOrder:  7,
		}},
		Schedules: []types.Schedule{
			{
				ID: "01900000-0000-7000-8000-000000000003", Name: "Salary", Destinations: []string{"checking"},
				Amount:    types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "100"}, Inputs: map[string]types.AmountInputBinding{}},
				Frequency: types.FrequencyMonthly, StartDate: "2026-01-01", Priority: 1, Enabled: true,
			},
			{
				ID: "01900000-0000-7000-8000-000000000004", Name: "Gym", Destinations: []string{"checking"},
				Amount:    types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "40"}, Inputs: map[string]types.AmountInputBinding{}},
				Frequency: types.FrequencyMonthly, StartDate: "2026-02-01", Priority: 2, Enabled: true,
			},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
}

func importRequest(t *testing.T, handler http.Handler, body any) writeResult[struct{}] {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	response := doRowRequest(t, handler, http.MethodPost, "/v1/model/import", string(payload))
	if response.Code != http.StatusOK {
		t.Fatalf("import status = %d, body %s", response.Code, response.Body.String())
	}
	var result struct {
		Value    struct{}                     `json:"value"`
		Issues   []types.ModelValidationIssue `json:"issues"`
		Saved    bool                         `json:"saved"`
		Revision string                       `json:"revision"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode import: %v", err)
	}
	return writeResult[struct{}]{Result: result.Value, Issues: result.Issues, Saved: result.Saved, Revision: result.Revision}
}

func TestImportModelMergesReviewedDocument(t *testing.T) {
	database := openAPIStore(t)
	seed := importTestModel()
	if _, err := database.ImportModel(&seed); err != nil {
		t.Fatalf("seed import: %v", err)
	}
	handler := New(database, Config{})

	document := importTestModel()
	document.Transactions[0].Name = "Rent revised"
	document.Transactions = append(document.Transactions, types.Transaction{
		ID: "01900000-0000-7000-8000-000000000002", Name: "Food", SourceAccountID: ptr("checking"),
		Destinations: []string{"savings"},
		Amount: types.TransactionAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": "25"},
			Inputs:   map[string]types.AmountInputBinding{},
		},
		PostedTime: 1785628800, TransactionTime: 1785628800, Enabled: true,
	})
	document.Schedules[0].Name = "Salary revised"
	document.Schedules[0], document.Schedules[1] = document.Schedules[1], document.Schedules[0]
	document.Schedules[0].Priority, document.Schedules[1].Priority = 1, 2

	result := importRequest(t, handler, map[string]any{"model": document})
	if !result.Saved {
		t.Fatalf("import issues = %+v", result.Issues)
	}
	stored, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(stored.Transactions) != 2 {
		t.Fatalf("transactions = %+v, want the reviewed rows", stored.Transactions)
	}
	rent := stored.Transactions[0]
	if rent.Name != "Rent revised" {
		t.Fatalf("name = %q, want the document value", rent.Name)
	}
	if rent.Source != "user" || rent.ExecutionOrder != 7 {
		t.Fatalf("lifecycle = source %q order %d, want stored values", rent.Source, rent.ExecutionOrder)
	}
	if stored.Transactions[1].ID != "01900000-0000-7000-8000-000000000002" {
		t.Fatalf("second transaction = %+v, want the new row", stored.Transactions[1])
	}
	if len(stored.Schedules) != 2 || stored.Schedules[0].ID != "01900000-0000-7000-8000-000000000004" || stored.Schedules[0].Name != "Gym" {
		t.Fatalf("schedules = %+v, want the document order", stored.Schedules)
	}
	if stored.Schedules[1].Name != "Salary revised" {
		t.Fatalf("schedule name = %q, want the document value", stored.Schedules[1].Name)
	}
}

func TestImportModelReleasesClaimsBeforeDeletingSchedule(t *testing.T) {
	database := openAPIStore(t)
	seed := importTestModel()
	seed.Transactions[0].Claim = &types.TransactionClaim{
		ScheduleID:     seed.Schedules[0].ID,
		OccurrenceDate: "2026-01-01",
	}
	if _, err := database.ImportModel(&seed); err != nil {
		t.Fatalf("seed import: %v", err)
	}
	handler := New(database, Config{})

	document := importTestModel()
	document.Transactions[0].Claim = nil
	document.Schedules = document.Schedules[1:]
	result := importRequest(t, handler, map[string]any{"model": document})
	if !result.Saved {
		t.Fatalf("import issues = %+v", result.Issues)
	}
	stored, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(stored.Schedules) != 1 || stored.Schedules[0].ID != seed.Schedules[1].ID {
		t.Fatalf("schedules = %+v, want the removed schedule gone", stored.Schedules)
	}
	if stored.Transactions[0].Claim != nil {
		t.Fatalf("claim = %+v, want the document's release", stored.Transactions[0].Claim)
	}
}

func TestImportModelCreatesClaimedOccurrenceOnEmptyServer(t *testing.T) {
	database := openAPIStore(t)
	handler := New(database, Config{})
	document := importTestModel()
	document.Transactions[0].Claim = &types.TransactionClaim{
		ScheduleID:     document.Schedules[0].ID,
		OccurrenceDate: "2026-01-01",
	}
	result := importRequest(t, handler, map[string]any{"model": document})
	if !result.Saved {
		t.Fatalf("import issues = %+v", result.Issues)
	}
	stored, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if stored == nil || len(stored.Transactions) != 1 || stored.Transactions[0].Claim == nil {
		t.Fatalf("transactions = %+v, want the claimed occurrence", stored)
	}
}

func TestImportModelRejectsInvalidDocumentWithoutWriting(t *testing.T) {
	database := openAPIStore(t)
	seed := importTestModel()
	if _, err := database.ImportModel(&seed); err != nil {
		t.Fatalf("seed import: %v", err)
	}
	handler := New(database, Config{})

	document := importTestModel()
	document.Transactions[0].Destinations = []string{"missing"}
	result := importRequest(t, handler, map[string]any{"model": document})
	if result.Saved {
		t.Fatal("invalid import reported saved")
	}
	if len(result.Issues) == 0 {
		t.Fatal("invalid import reported no issues")
	}
	stored, err := database.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if stored.Transactions[0].Destinations[0] != "savings" {
		t.Fatalf("stored destinations = %+v, want the original row", stored.Transactions[0].Destinations)
	}
}
