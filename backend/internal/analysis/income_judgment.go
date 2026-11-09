package analysis

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func judgeIncome(ctx context.Context, evaluator judgment.Evaluator, patterns []*incomePattern) error {
	requests := make([]types.AnalysisJudgmentInput, 0, len(patterns))
	for _, pat := range patterns {
		requests = append(requests, *pat.judgmentInput())
	}
	decisions, err := judgment.Assess(ctx, evaluator, requests)
	for i := range patterns {
		patterns[i].judgment = &decisions[i]
	}
	return err
}
