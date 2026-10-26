package store

import (
	"testing"
)

func TestPostingExecutionOrderSurvivesOwnerUpdatesAndDisplayMoves(t *testing.T) {
	database := openTestStore(t)
	seedAccount(t, database, "checking")
	first := testPostingFixture("01900000-0000-7000-8000-000000000001")
	first.ExecutionOrder = 999
	first, err := database.CreatePosting(first)
	if err != nil || first.ExecutionOrder != 1 {
		t.Fatalf("first execution order = %d, err %v", first.ExecutionOrder, err)
	}
	second, err := database.CreatePosting(testPostingFixture("01900000-0000-7000-8000-000000000002"))
	if err != nil || second.ExecutionOrder != 2 {
		t.Fatalf("second execution order = %d, err %v", second.ExecutionOrder, err)
	}
	first.ExecutionOrder = 999
	first.Name = "Updated name"
	updated, err := database.UpdatePosting(first)
	if err != nil || updated.ExecutionOrder != 1 {
		t.Fatalf("updated execution order = %d, err %v", updated.ExecutionOrder, err)
	}
	if err := database.MovePosting(second.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	document, err := database.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	if document.Postings[0].ID != second.ID || document.Postings[0].ExecutionOrder != 2 || document.Postings[1].ExecutionOrder != 1 {
		t.Fatal("display move changed equal-time execution order")
	}
}
