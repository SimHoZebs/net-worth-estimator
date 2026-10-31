package model

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/simhozebs/net-worth-estimator/backend/internal/api/internal/modelstate"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type plannedPurchaseBody struct {
	ID               *string `json:"id,omitempty" format:"uuid"`
	Name             string  `json:"name" minLength:"1" maxLength:"100"`
	FundingAccountID *string `json:"fundingAccountId"`
	Cost             float64 `json:"cost" exclusiveMinimum:"0" maximum:"10000000000"`
	EarliestDate     string  `json:"earliestDate" format:"date"`
	Enabled          bool    `json:"enabled"`
	Priority         *int    `json:"priority,omitempty" minimum:"0"`
}

func (b plannedPurchaseBody) purchase(id string) types.PlannedPurchase {
	if id == "" && b.ID != nil {
		id = *b.ID
	}
	p := types.PlannedPurchase{ID: id, Name: b.Name, FundingAccountID: b.FundingAccountID, Cost: b.Cost, EarliestDate: b.EarliestDate, Enabled: b.Enabled}
	if b.Priority != nil {
		p.Priority = *b.Priority
	}
	return p
}

func plannedPurchaseID(p types.PlannedPurchase) string { return p.ID }

type plannedPurchaseOutput struct {
	Body rowResultBody[types.PlannedPurchase]
}

func (s *handler) registerPlannedPurchaseRoutes(api huma.API) {
	huma.Register(api, huma.Operation{OperationID: "list-planned-purchases", Method: "GET", Path: "/planned-purchases", Summary: "List the planned purchase queue"}, s.listPlannedPurchases)
	huma.Register(api, huma.Operation{OperationID: "create-planned-purchase", Method: "POST", Path: "/planned-purchases", Summary: "Create one planned purchase"}, s.createPlannedPurchase)
	huma.Register(api, huma.Operation{OperationID: "update-planned-purchase", Method: "PATCH", Path: "/planned-purchases/{id}", Summary: "Replace one planned purchase"}, s.updatePlannedPurchase)
	huma.Register(api, huma.Operation{OperationID: "delete-planned-purchase", Method: "DELETE", Path: "/planned-purchases/{id}", Summary: "Delete one planned purchase"}, s.deletePlannedPurchase)
	huma.Register(api, huma.Operation{OperationID: "move-planned-purchase", Method: "POST", Path: "/planned-purchases/reorder", Summary: "Move one planned purchase"}, s.movePlannedPurchase)
}

func (s *handler) listPlannedPurchases(_ context.Context, _ *struct{}) (*struct {
	Body struct {
		PlannedPurchases []types.PlannedPurchase `json:"plannedPurchases"`
		Revision         string                  `json:"revision"`
	}
}, error) {
	model, err := s.store.LoadModel()
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	out := &struct {
		Body struct {
			PlannedPurchases []types.PlannedPurchase `json:"plannedPurchases"`
			Revision         string                  `json:"revision"`
		}
	}{}
	out.Body.PlannedPurchases = []types.PlannedPurchase{}
	if model != nil {
		out.Body.PlannedPurchases = model.PlannedPurchases
	}
	out.Body.Revision, err = store.ModelETag(model)
	return out, err
}

func (s *handler) createPlannedPurchase(_ context.Context, input *struct{ Body plannedPurchaseBody }) (*plannedPurchaseOutput, error) {
	p := input.Body.purchase("")
	row, issues, persisted, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		if input.Body.Priority == nil {
			for _, existing := range model.PlannedPurchases {
				if existing.Priority >= p.Priority {
					p.Priority = existing.Priority + 1
				}
			}
		}
		model.PlannedPurchases = replaceByID(model.PlannedPurchases, p.ID, plannedPurchaseID, p)
	}, func() (types.PlannedPurchase, error) { return s.store.CreatePlannedPurchase(p) })
	if err != nil {
		return nil, err
	}
	return &plannedPurchaseOutput{Body: rowResultBody[types.PlannedPurchase]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *handler) updatePlannedPurchase(_ context.Context, input *struct {
	ID   string `path:"id"`
	Body plannedPurchaseBody
}) (*plannedPurchaseOutput, error) {
	p := input.Body.purchase(input.ID)
	row, issues, persisted, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		if input.Body.Priority == nil {
			for _, existing := range model.PlannedPurchases {
				if existing.ID == p.ID {
					p.Priority = existing.Priority
				}
			}
		}
		model.PlannedPurchases = replaceByID(model.PlannedPurchases, p.ID, plannedPurchaseID, p)
	}, func() (types.PlannedPurchase, error) { return s.store.UpdatePlannedPurchase(p) })
	if err != nil {
		return nil, err
	}
	return &plannedPurchaseOutput{Body: rowResultBody[types.PlannedPurchase]{Row: row, Issues: issues, Persisted: persisted, Revision: revision}}, nil
}

func (s *handler) deletePlannedPurchase(_ context.Context, input *struct {
	ID string `path:"id"`
}) (*modelstate.ReorderOutput, error) {
	_, _, _, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.PlannedPurchases = removeByID(model.PlannedPurchases, input.ID, plannedPurchaseID)
	}, func() (struct{}, error) { return struct{}{}, s.store.DeletePlannedPurchase(input.ID) })
	if err != nil {
		return nil, err
	}
	return &modelstate.ReorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{revision}}, nil
}

func (s *handler) movePlannedPurchase(_ context.Context, input *reorderInput) (*modelstate.ReorderOutput, error) {
	_, _, _, revision, err := runFinanceRowWrite(s, func(model *types.FinancialModel) {
		model.PlannedPurchases = moveBeforeID(model.PlannedPurchases, input.Body.ID, input.Body.BeforeID, plannedPurchaseID)
		for i := range model.PlannedPurchases {
			model.PlannedPurchases[i].Priority = i
		}
	}, func() (struct{}, error) {
		return struct{}{}, s.store.MovePlannedPurchase(input.Body.ID, input.Body.BeforeID)
	})
	if err != nil {
		return nil, err
	}
	return &modelstate.ReorderOutput{Body: struct {
		Revision string `json:"revision"`
	}{revision}}, nil
}
