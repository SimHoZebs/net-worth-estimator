package sqlite

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Keep IN lists bounded like transaction-category reads. The named user
// argument stays textually last because scoped query wrappers append it.
const transactionFactsChunkSize = 200

// LoadTransactionSourceFacts reads retained evidence JSON for the named rows
// in this user scope. That JSON includes the source-reported amount; this query
// does not select financial transaction rows or amount-resolution data a second
// time, and it never reads sync keys or unrelated rows. Large requests are split
// into bounded IN queries.
func (s *sqliteStore) LoadTransactionSourceFacts(transactionIDs []string) (map[string]types.TransactionFacts, error) {
	facts, err := loadTransactionSourceFacts(s.db, transactionIDs)
	if err != nil {
		return nil, fmt.Errorf("load transaction source facts: %w", err)
	}
	return facts, nil
}

func loadTransactionSourceFacts(db queryer, transactionIDs []string) (map[string]types.TransactionFacts, error) {
	out := map[string]types.TransactionFacts{}
	unique := make([]string, 0, len(transactionIDs))
	seen := make(map[string]bool, len(transactionIDs))
	for _, id := range transactionIDs {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		unique = append(unique, id)
	}
	for start := 0; start < len(unique); start += transactionFactsChunkSize {
		end := start + transactionFactsChunkSize
		if end > len(unique) {
			end = len(unique)
		}
		ids := unique[start:end]
		placeholders := make([]string, len(ids))
		args := make([]any, 0, len(ids))
		for index, id := range ids {
			placeholders[index] = "?"
			args = append(args, id)
		}
		rows, err := db.Query(`SELECT transaction_id, facts_json FROM transaction_source_facts
			WHERE transaction_id IN (`+strings.Join(placeholders, ",")+`) AND user_id = :user_id`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id, raw string
			if err := rows.Scan(&id, &raw); err != nil {
				rows.Close()
				return nil, err
			}
			var facts types.TransactionFacts
			if err := json.Unmarshal([]byte(raw), &facts); err != nil {
				rows.Close()
				return nil, fmt.Errorf("decode transaction evidence %s: %w", id, err)
			}
			out[id] = facts
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	return out, nil
}
