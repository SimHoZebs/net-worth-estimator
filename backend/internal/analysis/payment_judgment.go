package analysis

import (
	"context"

	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func judgePayments(ctx context.Context, evaluator judgment.Evaluator, patterns []*classifiedPayment) error {
	requests := make([]types.AnalysisJudgmentInput, 0, len(patterns))
	for _, pat := range patterns {
		requests = append(requests, *pat.judgmentInput())
	}
	// Bound HTTP payloads and provider work independently of registry size.
	var deferred error
	for start := 0; start < len(requests); start += 100 {
		end := min(start+100, len(requests))
		decisions, err := judgment.Assess(ctx, evaluator, requests[start:end])
		if err != nil && (deferred == nil || err == judgment.ErrUnavailable) {
			deferred = err
		}
		for i := range decisions {
			patterns[start+i].judgment = &decisions[i]
		}
	}
	return deferred
}
