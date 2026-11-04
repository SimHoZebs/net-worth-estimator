package sync

import (
	"context"
	"errors"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type supersedeInput struct {
	BridgeAccountID string `path:"bridgeAccountId"`
	Body            struct {
		ManualAccountID string `json:"manualAccountId"`
	}
}

type supersedeOutput struct {
	Body struct {
		ManualAccountID string                       `json:"manualAccountId"`
		SyncedAccountID string                       `json:"syncedAccountId"`
		Issues          []types.ModelValidationIssue `json:"issues"`
		Saved           bool                         `json:"saved"`
		Revision        string                       `json:"revision"`
	}
}

// supersedeAccount retires one manual account in favor of the model account
// already linked to a bridge account. The synced account keeps the bank link
// and bank facts; the manual account's profile and account-scoped
// configuration move over, then the manual account and its history are
// deleted. Validation issues return in the row-write envelope with
// saved=false.
func (s *handler) supersedeAccount(_ context.Context, input *supersedeInput) (*supersedeOutput, error) {
	links, err := s.store.ListAccountLinks()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	syncedID := ""
	for _, link := range links {
		if link.BridgeAccountID == input.BridgeAccountID {
			syncedID = link.ModelAccountID
			break
		}
	}
	if syncedID == "" {
		return nil, huma.Error404NotFound("the bridge account is not linked")
	}
	result, err := s.store.SupersedeAccount(input.Body.ManualAccountID, syncedID, input.BridgeAccountID)
	if err != nil {
		switch {
		case store.IsNotFound(err):
			return nil, huma.Error404NotFound("the account could not be found")
		case errors.Is(err, store.ErrAccountSupersedeInvalid):
			message := strings.TrimPrefix(err.Error(), store.ErrAccountSupersedeInvalid.Error()+": ")
			return nil, huma.Error422UnprocessableEntity(message)
		default:
			return nil, huma.Error500InternalServerError(err.Error())
		}
	}
	revision, revErr := modelstate.CurrentRevision(s.store)
	if revErr != nil {
		return nil, huma.Error500InternalServerError(revErr.Error())
	}
	output := &supersedeOutput{}
	output.Body.ManualAccountID = input.Body.ManualAccountID
	output.Body.SyncedAccountID = syncedID
	output.Body.Issues = result.Issues
	if output.Body.Issues == nil {
		output.Body.Issues = []types.ModelValidationIssue{}
	}
	output.Body.Saved = result.Persisted
	output.Body.Revision = revision
	return output, nil
}
