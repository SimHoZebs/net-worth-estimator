package model

import (
	"context"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Amount presets persist as rows instead of living in code. The store owns
// the table and ordering; this layer validates shape (names, labels, and
// the amount descriptor) before anything is written. The amount descriptor
// validates shape-only: presets may reference placeholder IDs that resolve
// at authoring time, so references are never checked against stored data.
// Presets never touch the canonical model, its validation, or its
// revision: simulation reads copied descriptors, never presets.

type presetListOutput struct {
	Body struct {
		Presets []types.AmountPreset `json:"presets"`
	} `json:"body"`
}

type presetResultBody struct {
	Row       types.AmountPreset           `json:"row"`
	Issues    []types.ModelValidationIssue `json:"issues"`
	Persisted bool                         `json:"persisted"`
}

type presetOutput struct {
	Body presetResultBody `json:"body"`
}

func presetIssues(preset types.AmountPreset) []types.ModelValidationIssue {
	issues := []types.ModelValidationIssue{}
	if err := store.ValidateAmountPresetName(preset.Name); err != nil {
		issues = append(issues, types.ModelValidationIssue{
			Severity: types.SeverityError, Code: "invalid-name",
			Message: err.Error(), Path: []any{"name"},
		})
	}
	if strings.TrimSpace(preset.Label) == "" {
		issues = append(issues, types.ModelValidationIssue{
			Severity: types.SeverityError, Code: "invalid-label",
			Message: "preset label must be a non-empty string", Path: []any{"label"},
		})
	}
	if _, err := domain.ValidateAmountDescriptor(preset.Amount, nil); err != nil {
		issues = append(issues, types.ModelValidationIssue{
			Severity: types.SeverityError, Code: "invalid-amount",
			Message: err.Error(), Path: []any{"amount"},
		})
	}
	return issues
}

func rejectedPreset(issues []types.ModelValidationIssue) *presetOutput {
	return &presetOutput{Body: presetResultBody{Row: types.AmountPreset{}, Issues: issues, Persisted: false}}
}

func (s *handler) listPresets(_ context.Context, _ *struct{}) (*presetListOutput, error) {
	presets, err := s.store.ListAmountPresets()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	if presets == nil {
		presets = []types.AmountPreset{}
	}
	output := &presetListOutput{}
	output.Body.Presets = presets
	return output, nil
}

func (s *handler) createPreset(_ context.Context, input *struct {
	Body types.AmountPreset `json:"body"`
}) (*presetOutput, error) {
	preset := input.Body
	issues := presetIssues(preset)
	if hasErrorIssues(issues) {
		return rejectedPreset(issues), nil
	}
	row, err := s.store.CreateAmountPreset(preset)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	return &presetOutput{Body: presetResultBody{Row: row, Issues: issues, Persisted: true}}, nil
}

func (s *handler) updatePreset(_ context.Context, input *struct {
	ID   string             `path:"id"`
	Body types.AmountPreset `json:"body"`
}) (*presetOutput, error) {
	preset := input.Body
	preset.ID = input.ID
	stored, err := findPreset(s, input.ID)
	if err != nil {
		return nil, err
	}
	if preset.Name != stored.Name {
		return nil, huma.Error422UnprocessableEntity("preset name is immutable")
	}
	issues := presetIssues(preset)
	if hasErrorIssues(issues) {
		return rejectedPreset(issues), nil
	}
	row, err := s.store.UpdateAmountPreset(preset)
	if err != nil {
		return nil, modelstate.WriteError(err)
	}
	return &presetOutput{Body: presetResultBody{Row: row, Issues: issues, Persisted: true}}, nil
}

func findPreset(s *handler, id string) (types.AmountPreset, error) {
	presets, err := s.store.ListAmountPresets()
	if err != nil {
		return types.AmountPreset{}, huma.Error500InternalServerError(err.Error())
	}
	for _, preset := range presets {
		if preset.ID == id {
			return preset, nil
		}
	}
	return types.AmountPreset{}, huma.Error404NotFound("preset not found")
}

func (s *handler) deletePreset(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*struct {
	Body struct {
		DeletedID string `json:"deletedId"`
	} `json:"body"`
}, error) {
	if err := s.store.DeleteAmountPreset(input.ID); err != nil {
		return nil, modelstate.WriteError(err)
	}
	output := &struct {
		Body struct {
			DeletedID string `json:"deletedId"`
		} `json:"body"`
	}{}
	output.Body.DeletedID = input.ID
	return output, nil
}

func (s *handler) movePreset(_ context.Context, input *struct {
	Body struct {
		ID       string `json:"id"`
		BeforeID string `json:"beforeId,omitempty"`
	} `json:"body"`
}) (*struct {
	Body struct {
		MovedID string `json:"movedId"`
	} `json:"body"`
}, error) {
	if err := s.store.MoveAmountPreset(input.Body.ID, input.Body.BeforeID); err != nil {
		return nil, modelstate.WriteError(err)
	}
	output := &struct {
		Body struct {
			MovedID string `json:"movedId"`
		} `json:"body"`
	}{}
	output.Body.MovedID = input.Body.ID
	return output, nil
}
