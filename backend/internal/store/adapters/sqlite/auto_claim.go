package sqlite

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// autoClaimSweep claims unclaimed transactions that unambiguously record a
// schedule occurrence. It runs after bank sync commits so feed rows pick up
// schedules without a separate review step. The matcher is strict and
// single-winner only; ambiguous rows stay unclaimed for manual review.
// False positives tighten the matcher, never the automatic assignment.
func (s *sqliteStore) autoClaimSweep() error {
	model, err := s.LoadModel()
	if err != nil {
		return err
	}
	if model == nil || len(model.Schedules) == 0 {
		return nil
	}
	updates := domain.FindAutoClaims(model.Transactions, model.Schedules)
	if len(updates) == 0 {
		return nil
	}
	claims := make([]types.TransactionClaimUpdate, 0, len(updates))
	for _, update := range updates {
		claims = append(claims, types.TransactionClaimUpdate{
			TransactionID: update.TransactionID,
			Claim:         update.Claim,
		})
	}
	_, err = s.SetTransactionClaims(claims)
	return err
}
