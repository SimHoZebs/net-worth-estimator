package api

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type checkpointInput struct {
	Body types.Checkpoint `json:"body"`
}

type checkpointOutput struct {
	Body rowResultBody[types.Checkpoint] `json:"body"`
}

func checkpointKey(checkpoint types.Checkpoint) string {
	return checkpoint.AccountID + "\x00" + string(checkpoint.Date)
}

func (s *Server) saveCheckpoint(_ context.Context, input *checkpointInput) (*checkpointOutput, error) {
	checkpoint := input.Body
	row, issues, persisted, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		document.Checkpoints = replaceByID(document.Checkpoints, checkpointKey(checkpoint), checkpointKey, checkpoint)
	}, func() (types.Checkpoint, error) {
		return s.store.SaveCheckpoint(checkpoint)
	})
	if err != nil {
		return nil, err
	}
	return &checkpointOutput{Body: rowResultBody[types.Checkpoint]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *Server) deleteCheckpoint(_ context.Context, input *struct {
	AccountID string `query:"accountId"`
	Date      string `query:"date"`
}) (*reorderOutput, error) {
	accountID, date := input.AccountID, input.Date
	_, _, _, revision, err := runRowWrite(s, func(document *types.FinancialModelDocument) {
		kept := document.Checkpoints[:0]
		for _, checkpoint := range document.Checkpoints {
			if checkpoint.AccountID != accountID || string(checkpoint.Date) != date {
				kept = append(kept, checkpoint)
			}
		}
		document.Checkpoints = kept
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeleteCheckpoint(accountID, date)
	})
	if err != nil {
		return nil, err
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}
