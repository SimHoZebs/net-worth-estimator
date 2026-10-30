package sqlite

import (
	"fmt"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const plannedPurchaseSchema = `CREATE TABLE IF NOT EXISTS planned_purchases (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	id TEXT NOT NULL,
	position INTEGER NOT NULL,
	name TEXT NOT NULL,
	funding_account_id TEXT NOT NULL,
	cost REAL NOT NULL CHECK (cost > 0),
	earliest_date TEXT NOT NULL,
	priority INTEGER NOT NULL CHECK (priority >= 0),
	enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
	PRIMARY KEY(user_id, id),
	FOREIGN KEY(user_id, funding_account_id) REFERENCES accounts(user_id, id) DEFERRABLE INITIALLY DEFERRED
)`

func insertPlannedPurchase(tx *userTx, position int, purchase types.PlannedPurchase) error {
	_, err := tx.Exec(`INSERT INTO planned_purchases(id, position, name, funding_account_id, cost, earliest_date, priority, enabled, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, :user_id)`,
		purchase.ID, position, purchase.Name, nullable(purchase.FundingAccountID), purchase.Cost, purchase.EarliestDate, purchase.Priority, boolToInt(purchase.Enabled))
	return err
}

func loadPlannedPurchases(q queryer) ([]types.PlannedPurchase, error) {
	rows, err := q.Query(`SELECT id, name, funding_account_id, cost, earliest_date, priority, enabled FROM planned_purchases WHERE user_id = :user_id ORDER BY priority, position`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	purchases := []types.PlannedPurchase{}
	for rows.Next() {
		var p types.PlannedPurchase
		var account string
		if err := rows.Scan(&p.ID, &p.Name, &account, &p.Cost, &p.EarliestDate, &p.Priority, &p.Enabled); err != nil {
			return nil, err
		}
		p.FundingAccountID = &account
		purchases = append(purchases, p)
	}
	return purchases, rows.Err()
}

func (s *sqliteStore) CreatePlannedPurchase(p types.PlannedPurchase) (types.PlannedPurchase, error) {
	if p.ID == "" {
		id, err := newRowID()
		if err != nil {
			return types.PlannedPurchase{}, err
		}
		p.ID = id
	}
	if id, err := uuid.Parse(p.ID); err != nil || id.String() != p.ID {
		return types.PlannedPurchase{}, InvalidID(p.ID)
	}
	err := withRowTx(s.db, func(tx *userTx) error {
		if err := claimRowID(tx, p.ID, "planned-purchase"); err != nil {
			return err
		}
		position, err := nextTablePosition(tx, "planned_purchases")
		if err != nil {
			return err
		}
		return insertPlannedPurchase(tx, position, p)
	})
	if err != nil {
		return types.PlannedPurchase{}, err
	}
	return p, err
}

func (s *sqliteStore) UpdatePlannedPurchase(p types.PlannedPurchase) (types.PlannedPurchase, error) {
	err := withRowTx(s.db, func(tx *userTx) error {
		result, err := tx.Exec(`UPDATE planned_purchases SET name = ?, funding_account_id = ?, cost = ?, earliest_date = ?, priority = ?, enabled = ? WHERE id = ? AND user_id = :user_id`,
			p.Name, nullable(p.FundingAccountID), p.Cost, p.EarliestDate, p.Priority, boolToInt(p.Enabled), p.ID)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err == nil && count == 0 {
			return NotFound(p.ID)
		}
		return err
	})
	if err != nil {
		return types.PlannedPurchase{}, err
	}
	return p, err
}

func (s *sqliteStore) DeletePlannedPurchase(id string) error {
	return withRowTx(s.db, func(tx *userTx) error {
		result, err := tx.Exec(`DELETE FROM planned_purchases WHERE id = ? AND user_id = :user_id`, id)
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
}

// Purchases order by priority, then position. A move normalizes both so equal
// priorities and later imports cannot undo the owner's requested queue order.
func (s *sqliteStore) MovePlannedPurchase(id, beforeID string) error {
	return withRowTx(s.db, func(tx *userTx) error {
		purchases, err := loadPlannedPurchases(tx)
		if err != nil {
			return err
		}
		from, to := -1, len(purchases)
		for i, p := range purchases {
			if p.ID == id {
				from = i
			}
			if p.ID == beforeID {
				to = i
			}
		}
		if from < 0 {
			return NotFound(id)
		}
		if beforeID != "" && to == len(purchases) {
			return NotFound(beforeID)
		}
		if id == beforeID {
			return nil
		}
		moving := purchases[from]
		purchases = append(purchases[:from], purchases[from+1:]...)
		if from < to {
			to--
		}
		purchases = append(purchases, types.PlannedPurchase{})
		copy(purchases[to+1:], purchases[to:])
		purchases[to] = moving
		for i, p := range purchases {
			if _, err := tx.Exec(`UPDATE planned_purchases SET position = ?, priority = ? WHERE id = ? AND user_id = :user_id`, i, i, p.ID); err != nil {
				return fmt.Errorf("move planned purchase: %w", err)
			}
		}
		return nil
	})
}
