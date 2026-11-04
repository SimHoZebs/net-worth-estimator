package model

import (
	"context"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type postingCategoryBody struct {
	// Category is one supported category key. Null clears the owner override
	// and returns to the bank value or classifier result.
	Category *string `json:"category" nullable:"true" doc:"Supported category key; null clears the override"`
}

type postingCategoryOutput struct {
	Body struct {
		PostingID      string `json:"postingId"`
		Category       string `json:"category,omitempty"`
		CategorySource string `json:"categorySource,omitempty"`
	} `json:"body"`
}

func (s *handler) setPostingCategory(_ context.Context, input *struct {
	ID   string              `path:"id"`
	Body postingCategoryBody `json:"body"`
}) (*postingCategoryOutput, error) {
	if input.Body.Category != nil {
		value := strings.TrimSpace(*input.Body.Category)
		if !types.ValidCategory(value) {
			return nil, huma.Error422UnprocessableEntity("unsupported category")
		}
		input.Body.Category = &value
	}
	result, err := s.store.SetUserPostingCategory(input.ID, input.Body.Category)
	if err != nil {
		if store.IsNotFound(err) {
			return nil, huma.Error404NotFound("transaction not found")
		}
		return nil, huma.Error500InternalServerError(err.Error())
	}
	output := &postingCategoryOutput{}
	output.Body.PostingID = result.PostingID
	output.Body.Category = result.Category
	output.Body.CategorySource = result.Source
	return output, nil
}
