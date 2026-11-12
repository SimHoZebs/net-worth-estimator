package analyses

import (
	"context"
	"errors"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func transferPairError(err error) error {
	switch {
	case errors.Is(err, store.ErrNotFound):
		return huma.Error404NotFound("Finding not found")
	case errors.Is(err, store.ErrTransferLinkInvalid):
		return huma.Error422UnprocessableEntity(err.Error())
	case errors.Is(err, store.ErrAnalysisFeedbackConflict):
		return huma.Error409Conflict("The finding changed. Review it again.")
	default:
		return huma.Error500InternalServerError("The transfer pair could not be saved.")
	}
}

func (s *handler) confirmTransferPair(ctx context.Context, input *struct {
	ID   string `path:"id"`
	Body struct {
		PeerTransactionID string `json:"peerTransactionId" maxLength:"100"`
	}
}) (*struct {
	Body struct {
		Link     types.TransferLink `json:"link"`
		Revision string             `json:"revision"`
	}
}, error) {
	if s.canWrite != nil && !s.canWrite(ctx) {
		return nil, huma.Error403Forbidden("Write permission is required")
	}
	if input.Body.PeerTransactionID == "" {
		return nil, huma.Error422UnprocessableEntity("peerTransactionId is required")
	}
	actor := ""
	if s.actor != nil {
		actor = s.actor(ctx)
	}
	link, err := s.store.ConfirmTransferPair(input.ID, input.Body.PeerTransactionID, actor)
	if err != nil {
		return nil, transferPairError(err)
	}
	stored, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError("The transfer pair could not be saved.")
	}
	revision, err := store.ModelETag(stored)
	if err != nil {
		return nil, huma.Error500InternalServerError("The transfer pair could not be saved.")
	}
	output := &struct {
		Body struct {
			Link     types.TransferLink `json:"link"`
			Revision string             `json:"revision"`
		}
	}{}
	output.Body.Link, output.Body.Revision = link, revision
	return output, nil
}

func (s *handler) removeTransferLink(ctx context.Context, input *struct {
	TransactionID string `path:"transactionId"`
}) (*struct {
	Body struct {
		Revision string `json:"revision"`
	}
}, error) {
	if s.canWrite != nil && !s.canWrite(ctx) {
		return nil, huma.Error403Forbidden("Write permission is required")
	}
	if _, err := s.store.RemoveTransferLinkByLeg(input.TransactionID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil, huma.Error404NotFound("Transfer link not found")
		}
		return nil, huma.Error500InternalServerError("The transfer link could not be removed.")
	}
	stored, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError("The transfer link could not be removed.")
	}
	revision, err := store.ModelETag(stored)
	if err != nil {
		return nil, huma.Error500InternalServerError("The transfer link could not be removed.")
	}
	output := &struct {
		Body struct {
			Revision string `json:"revision"`
		}
	}{}
	output.Body.Revision = revision
	return output, nil
}

func (s *handler) listTransferLinks(_ context.Context, _ *struct{}) (*struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Links []types.TransferLink `json:"links"`
	}
}, error) {
	links, err := s.store.ListTransferLinks()
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	output := &struct {
		CacheControl string `header:"Cache-Control"`
		Body         struct {
			Links []types.TransferLink `json:"links"`
		}
	}{CacheControl: "private, no-store"}
	output.Body.Links = links
	return output, nil
}
