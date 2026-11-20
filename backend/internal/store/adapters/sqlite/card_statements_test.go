package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedCardStatementFixture(t *testing.T, s *sqliteStore, accountID, transactionID string) (types.CardStatement, types.StatementAllocation) {
	t.Helper()
	statement, err := s.SaveCardStatement(types.CardStatement{
		AccountID: accountID, ClosingDate: "2026-01-31", DueDate: "2026-02-20",
		Balance: 100.30, Currency: "USD", Source: "user",
	})
	if err != nil {
		t.Fatalf("save statement: %v", err)
	}
	allocation, err := s.SaveStatementAllocation(types.StatementAllocation{
		StatementID: statement.ID, TransactionID: transactionID,
		Amount: 60.20, State: "confirmed", Evidence: "test", Actor: "owner",
	})
	if err != nil {
		t.Fatalf("save allocation: %v", err)
	}
	return statement, allocation
}

func TestCardStatementAllocationIsExclusiveAndAudited(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	card, err := s.CreateAccount(types.Account{ID: "card", Name: "Card", Kind: types.AccountKindCreditCard, Enabled: true})
	if err != nil {
		t.Fatalf("create card: %v", err)
	}
	otherID, err := newRowID()
	if err != nil {
		t.Fatal(err)
	}
	payment := types.Transaction{ID: otherID, Name: "Payment", Enabled: true}
	if _, err := s.CreateTransaction(payment); err != nil {
		t.Fatalf("create payment: %v", err)
	}
	statement, allocation := seedCardStatementFixture(t, s, card.ID, otherID)

	// One payment backs at most one allocation. The second insert conflicts.
	if _, err := s.SaveStatementAllocation(types.StatementAllocation{
		StatementID: statement.ID, TransactionID: otherID, Amount: 0.01,
	}); err == nil || !store.IsIDConflict(err) {
		t.Fatalf("second allocation error = %v, want id conflict", err)
	}

	found, err := s.StatementAllocationForTransaction(otherID)
	if err != nil || found == nil || found.ID != allocation.ID {
		t.Fatalf("allocation for payment = %+v, err %v", found, err)
	}

	events, err := s.ListStatementAllocationEvents(allocation.ID)
	if err != nil || len(events) != 1 || events[0].Action != "created" {
		t.Fatalf("events = %+v, err %v", events, err)
	}
	// A repeated state change is idempotent and adds no audit row.
	if _, err := s.SetStatementAllocationState(allocation.ID, "dismissed", "owner"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetStatementAllocationState(allocation.ID, "dismissed", "owner"); err != nil {
		t.Fatal(err)
	}
	events, err = s.ListStatementAllocationEvents(allocation.ID)
	if err != nil || len(events) != 2 {
		t.Fatalf("events after dismiss = %+v, err %v", events, err)
	}

	if _, err := s.ReactivateStatementAllocation(allocation.ID, statement.ID, 60.20, "again", "owner"); err != nil {
		t.Fatalf("reactivate: %v", err)
	}
	events, err = s.ListStatementAllocationEvents(allocation.ID)
	if err != nil || len(events) != 3 || events[2].Action != "confirmed" {
		t.Fatalf("events after reapply = %+v, err %v", events, err)
	}

	// Deleting the statement cascades its allocation and audit trail but does
	// not touch the payment transaction, which stays cash activity.
	if err := s.DeleteCardStatement(statement.ID); err != nil {
		t.Fatalf("delete statement: %v", err)
	}
	allocations, err := s.ListStatementAllocations(statement.ID)
	if err != nil || len(allocations) != 0 {
		t.Fatalf("allocations after delete = %+v, err %v", allocations, err)
	}
	events, err = s.ListStatementAllocationEvents(allocation.ID)
	if err != nil || len(events) != 0 {
		t.Fatalf("events after delete = %+v, err %v", events, err)
	}
	if _, err := s.StatementAllocationForTransaction(otherID); err != nil {
		t.Fatalf("payment lookup after delete: %v", err)
	}
}
