package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const accountDisplaysDDL = `CREATE TABLE IF NOT EXISTS account_displays (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	account_id TEXT NOT NULL,
	display_json TEXT NOT NULL,
	PRIMARY KEY(user_id, account_id),
	FOREIGN KEY(user_id, account_id) REFERENCES accounts(user_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
)`

func saveAccountDisplay(tx *userTx, account types.Account) error {
	if account.Display == nil {
		_, err := tx.Exec(`DELETE FROM account_displays WHERE account_id = ? AND user_id = :user_id`, account.ID)
		return err
	}
	data, err := json.Marshal(account.Display)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO account_displays (account_id, display_json, user_id) VALUES (?, ?, :user_id) ON CONFLICT(user_id, account_id) DO UPDATE SET display_json = excluded.display_json`, account.ID, string(data))
	return err
}

func loadAccountDisplays(q queryer, accounts []types.Account) error {
	rows, err := q.Query(`SELECT account_id, display_json FROM account_displays WHERE user_id = :user_id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	byID := map[string]*types.Account{}
	for i := range accounts {
		byID[accounts[i].ID] = &accounts[i]
	}
	for rows.Next() {
		var id, data string
		if err := rows.Scan(&id, &data); err != nil {
			return err
		}
		if a := byID[id]; a != nil {
			if err := json.Unmarshal([]byte(data), &a.Display); err != nil {
				return fmt.Errorf("load account display: %w", err)
			}
		}
	}
	return rows.Err()
}

// SaveLoan changes all owned records in one user-scoped transaction. It
// never replaces the model, sync records, sharing grants, or history.
// Adoption writes one existing principal alongside one new interest account
// and two new rules, so update mode inserts rows it does not already own.
func (s *sqliteStore) SaveLoan(bundle types.LoanBundle, create bool) (types.Account, error) {
	if len(bundle.Accounts) != 2 || len(bundle.Schedules) != 2 {
		return types.Account{}, fmt.Errorf("invalid loan bundle")
	}
	err := withRowTx(s.db, func(tx *userTx) error {
		for i := range bundle.Accounts {
			a := &bundle.Accounts[i]
			if create {
				if err := insertAccountTx(tx, a); err != nil {
					return err
				}
			} else {
				exists, err := accountExists(tx, a.ID)
				if err != nil {
					return err
				}
				if exists {
					if err := updateAccountTx(tx, a); err != nil {
						return err
					}
				} else if err := insertAccountTx(tx, a); err != nil {
					return err
				}
			}
			if err := saveAccountDisplay(tx, *a); err != nil {
				return err
			}
		}
		for _, c := range bundle.Checkpoints {
			if err := upsertCheckpointTx(tx, c); err != nil {
				return err
			}
		}
		for i := range bundle.Schedules {
			r := &bundle.Schedules[i]
			if create {
				position, err := nextTablePosition(tx, "recurrence_rules")
				if err != nil {
					return err
				}
				if err := claimRowID(tx, r.ID, "rule"); err != nil {
					return err
				}
				if err := insertRule(tx, position, r); err != nil {
					return err
				}
				continue
			}
			var position, priority int
			if err := tx.QueryRow(`SELECT position, priority FROM recurrence_rules WHERE id = ? AND user_id = :user_id`, r.ID).Scan(&position, &priority); err != nil {
				if err != sql.ErrNoRows {
					return err
				}
				fresh, err := nextTablePosition(tx, "recurrence_rules")
				if err != nil {
					return err
				}
				if err := claimRowID(tx, r.ID, "rule"); err != nil {
					return err
				}
				if err := insertRule(tx, fresh, r); err != nil {
					return err
				}
				continue
			}
			r.Priority = priority
			if _, err := tx.Exec(`DELETE FROM recurrence_rules WHERE id = ? AND user_id = :user_id`, r.ID); err != nil {
				return err
			}
			if err := insertRule(tx, position, r); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return types.Account{}, err
	}
	if err := s.markDirtyStart(); err != nil {
		return types.Account{}, err
	}
	return bundle.Accounts[0], nil
}

func (s *sqliteStore) DeleteLoan(id string) error {
	err := withRowTx(s.db, func(tx *userTx) error {
		model, err := loadModel(tx)
		if err != nil {
			return err
		}
		if model == nil {
			return NotFound(id)
		}
		for _, a := range model.Accounts {
			if a.ID != id || a.Display == nil {
				continue
			}
			for _, ruleID := range []string{a.Display.InterestScheduleID, a.Display.PaymentScheduleID} {
				if _, err := tx.Exec(`DELETE FROM transaction_claims WHERE fulfills_rule_id = ? AND user_id = :user_id`, ruleID); err != nil {
					return err
				}
				if _, err := tx.Exec(`DELETE FROM recurrence_rules WHERE id = ? AND user_id = :user_id`, ruleID); err != nil {
					return err
				}
				if err := releaseRowID(tx, ruleID); err != nil {
					return err
				}
			}
			for _, c := range a.Display.Components {
				for _, table := range []string{"checkpoints", "checkpoint_available_balances"} {
					if _, err := tx.Exec(`DELETE FROM `+table+` WHERE model_account_id = ? AND user_id = :user_id`, c.AccountID); err != nil {
						return err
					}
				}
				if _, err := tx.Exec(`DELETE FROM accounts WHERE id = ? AND user_id = :user_id`, c.AccountID); err != nil {
					return err
				}
				if err := stripSharingPolicyAccount(tx, c.AccountID); err != nil {
					return err
				}
				if err := releaseRowID(tx, c.AccountID); err != nil {
					return err
				}
			}
			return nil
		}
		return NotFound(id)
	})
	if err != nil {
		return err
	}
	return s.markDirtyStart()
}
