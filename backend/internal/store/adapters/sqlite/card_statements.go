package sqlite

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// This file implements the recorded-statement sidecars. These rows are
// evidence, not projection inputs: writes deliberately do not mark the model
// dirty. The payment transactions they reference stay cash activity and are
// never reclassified as spend.

func scanCardStatement(rows interface{ Scan(...any) error }) (types.CardStatement, error) {
	var statement types.CardStatement
	err := rows.Scan(
		&statement.ID, &statement.AccountID, &statement.ClosingDate, &statement.DueDate,
		&statement.Balance, &statement.Currency, &statement.Source, &statement.Note, &statement.CreatedAt,
	)
	return statement, err
}

const cardStatementColumns = `id, account_id, closing_date, due_date, balance, currency, source, note, created_at`

func (s *sqliteStore) GetCardStatement(id string) (types.CardStatement, error) {
	var statement types.CardStatement
	err := s.db.QueryRow(`SELECT `+cardStatementColumns+` FROM card_statements WHERE id = ? AND user_id = :user_id`, id).Scan(
		&statement.ID, &statement.AccountID, &statement.ClosingDate, &statement.DueDate,
		&statement.Balance, &statement.Currency, &statement.Source, &statement.Note, &statement.CreatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return types.CardStatement{}, NotFound(id)
		}
		return types.CardStatement{}, err
	}
	return statement, nil
}

func (s *sqliteStore) ListCardStatements(accountID string) ([]types.CardStatement, error) {
	query := `SELECT ` + cardStatementColumns + ` FROM card_statements WHERE 1 = 1`
	args := []any{}
	if accountID != "" {
		query += ` AND account_id = ?`
		args = append(args, accountID)
	}
	query += ` AND user_id = :user_id`
	query += ` ORDER BY closing_date, position`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	statements := []types.CardStatement{}
	for rows.Next() {
		statement, err := scanCardStatement(rows)
		if err != nil {
			return nil, err
		}
		statements = append(statements, statement)
	}
	return statements, rows.Err()
}

func (s *sqliteStore) SaveCardStatement(statement types.CardStatement) (types.CardStatement, error) {
	if statement.ID == "" {
		id, err := newRowID()
		if err != nil {
			return types.CardStatement{}, err
		}
		statement.ID = id
	}
	if id, err := uuid.Parse(statement.ID); err != nil || id.String() != statement.ID {
		return types.CardStatement{}, InvalidID(statement.ID)
	}
	err := withRowTx(s.db, func(tx *userTx) error {
		var exists int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM card_statements WHERE id = ? AND user_id = :user_id`, statement.ID).Scan(&exists); err != nil {
			return err
		}
		position := 0
		if exists == 0 {
			if err := claimRowID(tx, statement.ID, "card-statement"); err != nil {
				return err
			}
			next, err := nextTablePosition(tx, "card_statements")
			if err != nil {
				return err
			}
			position = next
			statement.CreatedAt = time.Now().Unix()
			_, err = tx.Exec(`INSERT INTO card_statements(id, position, account_id, closing_date, due_date, balance, currency, source, note, created_at, user_id)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :user_id)`,
				statement.ID, position, statement.AccountID, statement.ClosingDate, statement.DueDate,
				statement.Balance, statement.Currency, statement.Source, statement.Note, statement.CreatedAt)
			if err != nil {
				if isUniqueViolation(err) {
					return IDConflict(statement.ClosingDate)
				}
				return err
			}
			return nil
		}
		var storedID, storedCurrency, storedSource, storedNote string
		var storedCreated int64
		if err := tx.QueryRow(`SELECT id, currency, source, note, created_at FROM card_statements WHERE id = ? AND user_id = :user_id`, statement.ID).Scan(
			&storedID, &storedCurrency, &storedSource, &storedNote, &storedCreated,
		); err != nil {
			return err
		}
		statement.CreatedAt = storedCreated
		if statement.Currency == "" {
			statement.Currency = storedCurrency
		}
		if statement.Source == "" {
			statement.Source = storedSource
		}
		if statement.Note == "" {
			statement.Note = storedNote
		}
		_, err := tx.Exec(`UPDATE card_statements SET account_id = ?, closing_date = ?, due_date = ?, balance = ?, currency = ?, source = ?, note = ? WHERE id = ? AND user_id = :user_id`,
			statement.AccountID, statement.ClosingDate, statement.DueDate, statement.Balance,
			statement.Currency, statement.Source, statement.Note, statement.ID)
		if err != nil {
			if isUniqueViolation(err) {
				return IDConflict(statement.ClosingDate)
			}
			return err
		}
		return nil
	})
	if err != nil {
		return types.CardStatement{}, err
	}
	return statement, nil
}

func (s *sqliteStore) DeleteCardStatement(id string) error {
	err := withRowTx(s.db, func(tx *userTx) error {
		result, err := tx.Exec(`DELETE FROM card_statements WHERE id = ? AND user_id = :user_id`, id)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count == 0 {
			return NotFound(id)
		}
		return releaseRowID(tx, id)
	})
	return err
}

func scanStatementAllocation(rows interface{ Scan(...any) error }) (types.StatementAllocation, error) {
	var allocation types.StatementAllocation
	err := rows.Scan(
		&allocation.ID, &allocation.StatementID, &allocation.TransactionID, &allocation.Amount,
		&allocation.State, &allocation.Evidence, &allocation.Actor, &allocation.CreatedAt, &allocation.UpdatedAt,
	)
	return allocation, err
}

const statementAllocationColumns = `id, statement_id, transaction_id, amount, state, evidence, actor, created_at, updated_at`

func (s *sqliteStore) ListStatementAllocations(statementID string) ([]types.StatementAllocation, error) {
	query := `SELECT ` + statementAllocationColumns + ` FROM statement_allocations WHERE 1 = 1`
	args := []any{}
	if statementID != "" {
		query += ` AND statement_id = ?`
		args = append(args, statementID)
	}
	query += ` AND user_id = :user_id`
	query += ` ORDER BY created_at, position`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	allocations := []types.StatementAllocation{}
	for rows.Next() {
		allocation, err := scanStatementAllocation(rows)
		if err != nil {
			return nil, err
		}
		allocations = append(allocations, allocation)
	}
	return allocations, rows.Err()
}

func (s *sqliteStore) StatementAllocationForTransaction(transactionID string) (*types.StatementAllocation, error) {
	allocation, err := scanStatementAllocation(s.db.QueryRow(
		`SELECT `+statementAllocationColumns+` FROM statement_allocations WHERE transaction_id = ? AND user_id = :user_id`, transactionID))
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &allocation, nil
}

func (s *sqliteStore) SaveStatementAllocation(allocation types.StatementAllocation) (types.StatementAllocation, error) {
	if allocation.ID == "" {
		id, err := newRowID()
		if err != nil {
			return types.StatementAllocation{}, err
		}
		allocation.ID = id
	}
	if id, err := uuid.Parse(allocation.ID); err != nil || id.String() != allocation.ID {
		return types.StatementAllocation{}, InvalidID(allocation.ID)
	}
	if allocation.State == "" {
		allocation.State = "confirmed"
	}
	err := withRowTx(s.db, func(tx *userTx) error {
		var statements int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM card_statements WHERE id = ? AND user_id = :user_id`, allocation.StatementID).Scan(&statements); err != nil {
			return err
		}
		if statements == 0 {
			return NotFound(allocation.StatementID)
		}
		if err := claimRowID(tx, allocation.ID, "statement-allocation"); err != nil {
			return err
		}
		position, err := nextTablePosition(tx, "statement_allocations")
		if err != nil {
			return err
		}
		now := time.Now().Unix()
		allocation.CreatedAt, allocation.UpdatedAt = now, now
		_, err = tx.Exec(`INSERT INTO statement_allocations(id, position, statement_id, transaction_id, amount, state, evidence, actor, created_at, updated_at, user_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, :user_id)`,
			allocation.ID, position, allocation.StatementID, allocation.TransactionID,
			allocation.Amount, allocation.State, allocation.Evidence, allocation.Actor, now, now)
		if err != nil {
			if isUniqueViolation(err) {
				return IDConflict(allocation.TransactionID)
			}
			return err
		}
		return appendAllocationEvent(tx, allocation.ID, "created", allocation.Actor, now)
	})
	if err != nil {
		return types.StatementAllocation{}, err
	}
	return allocation, nil
}

func (s *sqliteStore) ReactivateStatementAllocation(id, statementID string, amount float64, evidence, actor string) (types.StatementAllocation, error) {
	var allocation types.StatementAllocation
	err := withRowTx(s.db, func(tx *userTx) error {
		now := time.Now().Unix()
		var state, transactionID string
		if err := tx.QueryRow(`SELECT state, transaction_id FROM statement_allocations WHERE id = ? AND user_id = :user_id`, id).Scan(&state, &transactionID); err != nil {
			if err == sql.ErrNoRows {
				return NotFound(id)
			}
			return err
		}
		if state != "dismissed" {
			return IDConflict(transactionID)
		}
		var statements int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM card_statements WHERE id = ? AND user_id = :user_id`, statementID).Scan(&statements); err != nil {
			return err
		}
		if statements == 0 {
			return NotFound(statementID)
		}
		result, err := tx.Exec(`UPDATE statement_allocations SET statement_id = ?, amount = ?, state = 'confirmed', evidence = ?, actor = ?, updated_at = ? WHERE id = ? AND user_id = :user_id`,
			statementID, amount, evidence, actor, now, id)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count == 0 {
			return NotFound(id)
		}
		if err := appendAllocationEvent(tx, id, "confirmed", actor, now); err != nil {
			return err
		}
		allocation, err = scanStatementAllocation(tx.QueryRow(
			`SELECT `+statementAllocationColumns+` FROM statement_allocations WHERE id = ? AND user_id = :user_id`, id))
		return err
	})
	if err != nil {
		return types.StatementAllocation{}, err
	}
	return allocation, nil
}

func (s *sqliteStore) SetStatementAllocationState(id, state, actor string) (types.StatementAllocation, error) {
	var allocation types.StatementAllocation
	err := withRowTx(s.db, func(tx *userTx) error {
		now := time.Now().Unix()
		// Read the current state inside the same transaction so a repeated
		// dismiss or undo is a no-op instead of a second audit event. SQLite
		// serializes these writes, so the last committed state wins cleanly.
		var current string
		if err := tx.QueryRow(`SELECT state FROM statement_allocations WHERE id = ? AND user_id = :user_id`, id).Scan(&current); err != nil {
			if err == sql.ErrNoRows {
				return NotFound(id)
			}
			return err
		}
		if current == state {
			var scanErr error
			allocation, scanErr = scanStatementAllocation(tx.QueryRow(
				`SELECT `+statementAllocationColumns+` FROM statement_allocations WHERE id = ? AND user_id = :user_id`, id))
			return scanErr
		}
		result, err := tx.Exec(`UPDATE statement_allocations SET state = ?, actor = ?, updated_at = ? WHERE id = ? AND user_id = :user_id`,
			state, actor, now, id)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count == 0 {
			return NotFound(id)
		}
		if err := appendAllocationEvent(tx, id, state, actor, now); err != nil {
			return err
		}
		allocation, err = scanStatementAllocation(tx.QueryRow(
			`SELECT `+statementAllocationColumns+` FROM statement_allocations WHERE id = ? AND user_id = :user_id`, id))
		return err
	})
	if err != nil {
		return types.StatementAllocation{}, err
	}
	return allocation, nil
}

func appendAllocationEvent(tx *userTx, allocationID, action, actor string, createdAt int64) error {
	var next int64
	if err := tx.QueryRow(`SELECT COALESCE(MAX(id), 0) + 1 FROM statement_allocation_events WHERE user_id = :user_id`).Scan(&next); err != nil {
		return err
	}
	_, err := tx.Exec(`INSERT INTO statement_allocation_events(id, allocation_id, action, actor, created_at, user_id)
		VALUES (?, ?, ?, ?, ?, :user_id)`, next, allocationID, action, actor, createdAt)
	return err
}

func (s *sqliteStore) ListStatementAllocationEvents(allocationID string) ([]types.StatementAllocationEvent, error) {
	rows, err := s.db.Query(`SELECT id, allocation_id, action, actor, created_at FROM statement_allocation_events WHERE allocation_id = ? AND user_id = :user_id ORDER BY id`, allocationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []types.StatementAllocationEvent{}
	for rows.Next() {
		var event types.StatementAllocationEvent
		if err := rows.Scan(&event.ID, &event.AllocationID, &event.Action, &event.Actor, &event.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}
