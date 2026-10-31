package model

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type evaluationInput struct {
	Body store.EvaluationUpdate `json:"body"`
}

type evaluationOutput struct {
	Body rowResultBody[store.EvaluationUpdate] `json:"body"`
}

func evalSlice(model *types.FinancialModel, evalType string) *[]types.EvaluationInstance[types.JsonValue] {
	return model.Evaluations.ByType(evalType)
}

func evalToInstance(item store.EvaluationUpdate) types.EvaluationInstance[types.JsonValue] {
	return types.EvaluationInstance[types.JsonValue]{InstanceID: item.InstanceID, Name: item.Name, Enabled: item.Enabled, Config: types.JsonValue(item.Config)}
}

func instanceIDOf(instance types.EvaluationInstance[types.JsonValue]) string {
	return instance.InstanceID
}

func (s *handler) createEvaluation(_ context.Context, input *evaluationInput) (*evaluationOutput, error) {
	item := input.Body
	row, issues, persisted, revision, err := runRowWrite(s, func(model *types.FinancialModel) {
		if slice := evalSlice(model, item.Type); slice != nil {
			*slice = replaceByID(*slice, item.InstanceID, instanceIDOf, evalToInstance(item))
		}
	}, func() (store.EvaluationUpdate, error) {
		return s.store.CreateEvaluation(item)
	})
	if err != nil {
		return nil, err
	}
	return &evaluationOutput{Body: rowResultBody[store.EvaluationUpdate]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *handler) updateEvaluation(_ context.Context, input *struct {
	InstanceID string                 `path:"instanceId"`
	Body       store.EvaluationUpdate `json:"body"`
}) (*evaluationOutput, error) {
	item := input.Body
	item.InstanceID = input.InstanceID
	row, issues, persisted, revision, err := runRowWrite(s, func(model *types.FinancialModel) {
		// A type change moves the instance across tables: remove it
		// everywhere first, then insert into the target table. The store
		// does the same atomically and keeps the pin.
		for _, evalType := range types.EvaluationTypeOrder {
			if slice := evalSlice(model, evalType); slice != nil {
				*slice = removeByID(*slice, item.InstanceID, instanceIDOf)
			}
		}
		if slice := evalSlice(model, item.Type); slice != nil {
			*slice = replaceByID(*slice, item.InstanceID, instanceIDOf, evalToInstance(item))
		}
	}, func() (store.EvaluationUpdate, error) {
		return s.store.UpdateEvaluation(item)
	})
	if err != nil {
		return nil, err
	}
	return &evaluationOutput{Body: rowResultBody[store.EvaluationUpdate]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *handler) deleteEvaluation(_ context.Context, input *struct {
	InstanceID string `path:"instanceId"`
}) (*modelstate.ReorderOutput, error) {
	instanceID := input.InstanceID
	_, _, _, revision, err := runRowWrite(s, func(model *types.FinancialModel) {
		for _, evalType := range types.EvaluationTypeOrder {
			if slice := evalSlice(model, evalType); slice != nil {
				*slice = removeByID(*slice, instanceID, instanceIDOf)
			}
		}
	}, func() (struct{}, error) {
		return struct{}{}, s.store.DeleteEvaluation(instanceID)
	})
	if err != nil {
		return nil, err
	}
	return &modelstate.ReorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}

func (s *handler) moveEvaluation(_ context.Context, input *struct {
	Body struct {
		Type       string `json:"type"`
		InstanceID string `json:"instanceId"`
		BeforeID   string `json:"beforeId,omitempty"`
	} `json:"body"`
}) (*modelstate.ReorderOutput, error) {
	evalType, instanceID, beforeID := input.Body.Type, input.Body.InstanceID, input.Body.BeforeID
	_, _, _, revision, err := runRowWrite(s, func(model *types.FinancialModel) {
		if slice := evalSlice(model, evalType); slice != nil {
			*slice = moveBeforeID(*slice, instanceID, beforeID, instanceIDOf)
		}
	}, func() (struct{}, error) {
		return struct{}{}, s.store.MoveEvaluation(evalType, instanceID, beforeID)
	})
	if err != nil {
		return nil, err
	}
	return &modelstate.ReorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}
