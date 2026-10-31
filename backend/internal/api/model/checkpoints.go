package model

import (
	"context"
	"strconv"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type checkpointInput struct {
	Body types.Checkpoint `json:"body"`
}

type checkpointOutput struct {
	Body rowResultBody[types.Checkpoint] `json:"body"`
}

// checkpointKey identifies one observation: the account and exact instant.
// Several observations per day survive; an owner row wins only at its own
// instant.
func checkpointKey(checkpoint types.Checkpoint) string {
	return checkpoint.AccountID + "\x00" + strconv.FormatInt(checkpoint.ObservedAt, 10)
}

func (s *handler) saveCheckpoint(_ context.Context, input *checkpointInput) (*checkpointOutput, error) {
	checkpoint := input.Body
	row, issues, persisted, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.Checkpoints = replaceByID(model.Checkpoints, checkpointKey(checkpoint), checkpointKey, checkpoint)
	}, func() (types.Checkpoint, error) {
		return s.store.SaveCheckpoint(checkpoint)
	})
	if err != nil {
		return nil, err
	}
	return &checkpointOutput{Body: rowResultBody[types.Checkpoint]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *handler) deleteCheckpoint(_ context.Context, input *struct {
	AccountID  string `query:"accountId"`
	ObservedAt int64  `query:"observedAt"`
}) (*reorderOutput, error) {
	accountID := input.AccountID
	observedAt := input.ObservedAt
	_, _, _, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		kept := model.Checkpoints[:0]
		for _, checkpoint := range model.Checkpoints {
			if checkpoint.AccountID != accountID || checkpoint.ObservedAt != observedAt {
				kept = append(kept, checkpoint)
			}
		}
		if len(kept) == 0 {
			model.Checkpoints = []types.Checkpoint{}
		} else {
			model.Checkpoints = kept
		}
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeleteCheckpointAt(accountID, observedAt)
	})
	if err != nil {
		return nil, err
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}
