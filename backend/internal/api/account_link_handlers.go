package api

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

func (s *Server) listAccountLinks(_ context.Context, _ *struct{}) (*linkListOutput, error) {
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

type linkPutInput struct {
	BridgeAccountID string `path:"bridgeAccountId"`
	Body            struct {
		ModelAccountID string `json:"modelAccountId"`
	} `json:"body"`
}

type linkOutput struct {
	Body struct {
		Link     store.AccountLink `json:"link"`
		Revision string            `json:"revision"`
	} `json:"body"`
}

func (s *Server) saveAccountLink(_ context.Context, input *linkPutInput) (*linkOutput, error) {
	link := store.AccountLink{
		BridgeAccountID: input.BridgeAccountID,
		ModelAccountID:  input.Body.ModelAccountID,
		Origin:          store.LinkOriginManual,
		LastSeenAt:      "",
	}
	existing, err := s.store.ListAccountLinks()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	for _, stored := range existing {
		if stored.BridgeAccountID == link.BridgeAccountID {
			link.BridgeName = stored.BridgeName
			link.Currency = stored.Currency
			link.LastSeenAt = stored.LastSeenAt
		}
	}
	saved, err := s.store.SaveAccountLink(link)
	if err != nil {
		return nil, rowWriteError(err)
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	output := &linkOutput{}
	output.Body.Link = saved
	output.Body.Revision = revision
	return output, nil
}

func (s *Server) deleteAccountLink(_ context.Context, input *struct {
	BridgeAccountID string `path:"bridgeAccountId"`
}) (*reorderOutput, error) {
	if err := s.store.DeleteAccountLink(input.BridgeAccountID); err != nil {
		return nil, rowWriteError(err)
	}
	revision, revErr := currentRevision(s)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	return &reorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{Revision: revision}}, nil
}
