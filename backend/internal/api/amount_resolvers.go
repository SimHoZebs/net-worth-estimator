package api

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
)

type amountResolversOutput struct {
	Body struct {
		Resolvers   []domain.AmountResolverInfo `json:"resolvers"`
		Providers   []domain.AmountProviderInfo `json:"providers"`
		IncomeSteps []domain.AmountResolverInfo `json:"incomeSteps"`
	} `json:"body"`
}

func (s *Server) getAmountResolvers(_ context.Context, _ *struct{}) (*amountResolversOutput, error) {
	output := &amountResolversOutput{}
	output.Body.Resolvers = domain.ListAmountResolverSpecs()
	output.Body.Providers = domain.ListAmountProviderSpecs()
	output.Body.IncomeSteps = domain.ListIncomeStepSpecs()
	if output.Body.Resolvers == nil {
		output.Body.Resolvers = []domain.AmountResolverInfo{}
	}
	if output.Body.Providers == nil {
		output.Body.Providers = []domain.AmountProviderInfo{}
	}
	if output.Body.IncomeSteps == nil {
		output.Body.IncomeSteps = []domain.AmountResolverInfo{}
	}
	return output, nil
}
