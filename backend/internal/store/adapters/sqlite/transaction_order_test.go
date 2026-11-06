package sqlite

import (
	"testing"
)

func TestTransactionExecutionOrderSurvivesOwnerUpdatesAndDisplayMoves(t *testing.T) {
	database := openTestStore(t)
	seedAccount(t, database, "checking")
	first := testTransactionFixture("01900000-0000-7000-8000-000000000001")
	first.ExecutionOrder = 999
	first, err := database.CreateTransaction(first)
	if err != nil || first.ExecutionOrder != 1 {
		t.Fatalf("first execution order = %d, err %v", first.ExecutionOrder, err)
	}
	second, err := database.CreateTransaction(testTransactionFixture("01900000-0000-7000-8000-000000000002"))
	if err != nil || second.ExecutionOrder != 2 {
		t.Fatalf("second execution order = %d, err %v", second.ExecutionOrder, err)
	}
	first.ExecutionOrder = 999
	first.Name = "Updated name"
	updated, err := database.UpdateTransaction(first)
	if err != nil || updated.ExecutionOrder != 1 {
		t.Fatalf("updated execution order = %d, err %v", updated.ExecutionOrder, err)
	}
	if err := database.MoveTransaction(second.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	model, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if model.Transactions[0].ID != second.ID || model.Transactions[0].ExecutionOrder != 2 || model.Transactions[1].ExecutionOrder != 1 {
		t.Fatal("display move changed equal-time execution order")
	}
}
