package model

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
)

// Pinned evaluations are a display preference, not canonical model rows:
// reads bypass validation and revision tracking, and the single PUT
// replaces the whole ordered list. Unknown instance IDs are 404; the
// The read-only kill switch and outer session permissions apply to the write.
type pinnedEvaluationsOutput struct {
	Body struct {
		InstanceIDs []string `json:"instanceIds"`
	} `json:"body"`
}

type pinnedEvaluationsInput struct {
	Body struct {
		InstanceIDs []string `json:"instanceIds"`
	} `json:"body"`
}

func (s *handler) getPinnedEvaluations(_ context.Context, _ *struct{}) (*pinnedEvaluationsOutput, error) {
	ids, err := s.store.ListPinnedEvaluations()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	if ids == nil {
		ids = []string{}
	}
	output := &pinnedEvaluationsOutput{}
	output.Body.InstanceIDs = ids
	return output, nil
}

func (s *handler) setPinnedEvaluations(_ context.Context, input *pinnedEvaluationsInput) (*pinnedEvaluationsOutput, error) {
	ids := input.Body.InstanceIDs
	if ids == nil {
		ids = []string{}
	}
	saved, err := s.store.SetPinnedEvaluations(ids)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	output := &pinnedEvaluationsOutput{}
	output.Body.InstanceIDs = saved
	return output, nil
}
