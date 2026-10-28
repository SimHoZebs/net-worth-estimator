package sqlite

import (
	"fmt"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func insertPurchasePolicy(tx *planTx, posting *types.Posting) error {
	if posting.Purchase == nil {
		return nil
	}
	_, err := tx.Exec(`INSERT INTO purchase_policies (posting_id, priority, plan_id) VALUES (?,?, :plan_id)`, posting.ID, posting.Purchase.Priority)
	if err != nil {
		return fmt.Errorf("save purchase policy %s: %w", posting.ID, err)
	}
	return nil
}

func loadPurchasePolicies(q queryer, postings []types.Posting) error {
	rows, err := q.Query(`SELECT posting_id, priority FROM purchase_policies WHERE plan_id = :plan_id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	byID := make(map[string]*types.Posting, len(postings))
	for index := range postings {
		byID[postings[index].ID] = &postings[index]
	}
	for rows.Next() {
		var id string
		var policy types.PurchasePolicy
		if err := rows.Scan(&id, &policy.Priority); err != nil {
			return err
		}
		if posting := byID[id]; posting != nil {
			posting.Purchase = &policy
		}
	}
	return rows.Err()
}
