package api

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
)

// Pinned evaluations are a display preference, not canonical model rows:
// reads bypass validation and revision tracking, and the single PUT
// replaces the whole ordered list. Unknown instance IDs are 404; the
// guard middleware (read-only 403, bearer 401) applies to the write.
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

func (s *Server) getPinnedEvaluations(_ context.Context, _ *struct{}) (*pinnedEvaluationsOutput, error) {
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

func (s *Server) setPinnedEvaluations(_ context.Context, input *pinnedEvaluationsInput) (*pinnedEvaluationsOutput, error) {
	ids := input.Body.InstanceIDs
	if ids == nil {
		ids = []string{}
	}
	saved, err := s.store.SetPinnedEvaluations(ids)
	if err != nil {
		return nil, rowWriteError(err)
	}
	output := &pinnedEvaluationsOutput{}
	output.Body.InstanceIDs = saved
	return output, nil
}
