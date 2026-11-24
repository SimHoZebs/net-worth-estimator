package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestStatementAllocationIsExclusiveAndAudited(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	otherID, err := newRowID()
	if err != nil {
		t.Fatal(err)
	}
	payment := types.Transaction{ID: otherID, Name: "Payment", Enabled: true}
	if _, err := s.CreateTransaction(payment); err != nil {
		t.Fatalf("create payment: %v", err)
	}
	statementID := types.DerivedStatementID("card", "2026-01-31")
	allocation, err := s.SaveStatementAllocation(types.StatementAllocation{
		StatementID: statementID, TransactionID: otherID,
		Amount: 60.20, State: "confirmed", Evidence: "test", Actor: "owner",
	})
	if err != nil {
		t.Fatalf("save allocation: %v", err)
	}
	if allocation.StatementID != statementID {
		t.Fatalf("statement id = %q, want %q", allocation.StatementID, statementID)
	}

	// One payment backs at most one allocation. The second insert conflicts.
	if _, err := s.SaveStatementAllocation(types.StatementAllocation{
		StatementID: statementID, TransactionID: otherID, Amount: 0.01,
	}); err == nil || !store.IsIDConflict(err) {
		t.Fatalf("second allocation error = %v, want id conflict", err)
	}

	found, err := s.StatementAllocationForTransaction(otherID)
	if err != nil || found == nil || found.ID != allocation.ID {
		t.Fatalf("allocation for payment = %+v, err %v", found, err)
	}

	events := allocationAuditActions(t, s, allocation.ID)
	if len(events) != 1 || events[0] != "created" {
		t.Fatalf("audit actions = %v, want [created]", events)
	}
	// A repeated state change is idempotent and adds no audit row.
	if _, err := s.SetStatementAllocationState(allocation.ID, "dismissed", "owner"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetStatementAllocationState(allocation.ID, "dismissed", "owner"); err != nil {
		t.Fatal(err)
	}
	events = allocationAuditActions(t, s, allocation.ID)
	if len(events) != 2 {
		t.Fatalf("audit actions after dismiss = %v, want 2", events)
	}

	if _, err := s.ReactivateStatementAllocation(allocation.ID, statementID, 60.20, "again", "owner"); err != nil {
		t.Fatalf("reactivate: %v", err)
	}
	events = allocationAuditActions(t, s, allocation.ID)
	if len(events) != 3 || events[2] != "confirmed" {
		t.Fatalf("audit actions after reapply = %v, want confirmed last", events)
	}

	allocations, err := s.ListStatementAllocations(statementID)
	if err != nil || len(allocations) != 1 || allocations[0].ID != allocation.ID {
		t.Fatalf("allocations for derived statement = %+v, err %v", allocations, err)
	}
	if _, err := s.StatementAllocationForTransaction(otherID); err != nil {
		t.Fatalf("payment lookup: %v", err)
	}
}

func TestStatementAllocationClear(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	transactionID, err := newRowID()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateTransaction(types.Transaction{ID: transactionID, Name: "Payment", Enabled: true}); err != nil {
		t.Fatalf("create payment: %v", err)
	}
	statementID := types.DerivedStatementID("card", "2026-01-31")
	allocation, err := s.SaveStatementAllocation(types.StatementAllocation{
		StatementID: statementID, TransactionID: transactionID,
		Amount: 60.20, Evidence: "test", Actor: "owner",
	})
	if err != nil {
		t.Fatalf("save allocation: %v", err)
	}
	if _, err := s.SetStatementAllocationState(allocation.ID, "dismissed", "owner"); err != nil {
		t.Fatalf("dismiss allocation: %v", err)
	}
	if _, err := s.ReactivateStatementAllocation(allocation.ID, statementID, 60.20, "again", "owner"); err != nil {
		t.Fatalf("reactivate allocation: %v", err)
	}
	events := allocationAuditActions(t, s, allocation.ID)
	if len(events) != 3 || events[0] != "created" || events[1] != "dismissed" || events[2] != "confirmed" {
		t.Fatalf("audit actions = %v, want [created dismissed confirmed]", events)
	}

	if err := s.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	for _, table := range []string{"statement_allocations", "statement_allocation_events", "transactions", "accounts"} {
		var count int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM ` + table + ` WHERE user_id = :user_id`).Scan(&count); err != nil {
			t.Fatalf("count %s rows: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("%s rows after clear = %d, want 0", table, count)
		}
	}
}

func TestStatementAllocationRejectsMalformedDerivedID(t *testing.T) {
	s := openSQLiteStore(t)
	bad := types.StatementAllocation{StatementID: "not-a-derived-id", TransactionID: "tx", Amount: 1}
	if _, err := s.SaveStatementAllocation(bad); err == nil {
		t.Fatal("malformed derived statement id should be rejected")
	}
	if _, err := s.ReactivateStatementAllocation("missing", "not-a-derived-id", 1, "", ""); err == nil {
		t.Fatal("reactivation with a malformed derived statement id should be rejected")
	}
}

// allocationAuditActions reads the append-only audit table directly. The
// allocation audit has no product read path, so the test verifies writes at
// the store boundary rather than through a deleted endpoint.
func allocationAuditActions(t *testing.T, s *sqliteStore, allocationID string) []string {
	t.Helper()
	rows, err := s.db.Query(`SELECT action FROM statement_allocation_events WHERE allocation_id = ? ORDER BY id`, allocationID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	actions := []string{}
	for rows.Next() {
		var action string
		if err := rows.Scan(&action); err != nil {
			t.Fatal(err)
		}
		actions = append(actions, action)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return actions
}
