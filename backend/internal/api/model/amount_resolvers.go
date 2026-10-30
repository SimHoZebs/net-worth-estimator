package model

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/domain"
)

type amountResolversOutput struct {
	Body struct {
		Resolvers []domain.AmountResolverInfo `json:"resolvers"`
		Providers []domain.AmountProviderInfo `json:"providers"`
	} `json:"body"`
}

func (s *handler) getAmountResolvers(_ context.Context, _ *struct{}) (*amountResolversOutput, error) {
	output := &amountResolversOutput{}
	output.Body.Resolvers = domain.ListAmountResolverSpecs()
	output.Body.Providers = domain.ListAmountProviderSpecs()
	if output.Body.Resolvers == nil {
		output.Body.Resolvers = []domain.AmountResolverInfo{}
	}
	if output.Body.Providers == nil {
		output.Body.Providers = []domain.AmountProviderInfo{}
	}
	return output, nil
}
