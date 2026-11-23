package sync

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

type linkListOutput struct {
	Body struct {
		Links []store.AccountLink `json:"links"`
	} `json:"body"`
}

func (s *handler) listAccountLinks(_ context.Context, _ *struct{}) (*linkListOutput, error) {
	links, err := s.store.ListAccountLinks()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	if links == nil {
		links = []store.AccountLink{}
	}
	output := &linkListOutput{}
	output.Body.Links = links
	return output, nil
}
