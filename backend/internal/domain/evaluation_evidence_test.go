package domain

import (
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestEvaluateEvidenceRequiresARegisteredProjectionFreeReader(t *testing.T) {
	registry := NewEvaluationRegistry()
	registry.Register(accountBalanceDefinition)
	simulator := projectionFreeDefinition().Evaluator
	registry.Register(&SimulatorDefinition{Evaluator: simulator})
	for _, tc := range []struct {
		evaluationType string
		message        string
	}{
		{"unknown", "no evaluator is registered"},
		{types.EvaluationTypeAccountBalance, "not a projection-free reader"},
		{simulator.Type, "not a projection-free reader"},
	} {
		t.Run(tc.evaluationType, func(t *testing.T) {
			_, err := registry.EvaluateEvidence(tc.evaluationType, nil, nil)
			if err == nil || !strings.Contains(err.Error(), tc.message) {
				t.Fatalf("EvaluateEvidence error = %v, want %q", err, tc.message)
			}
		})
	}
}

func TestEvaluateEvidenceUsesReaderSimulationGuard(t *testing.T) {
	oldTries, oldPause := resimGuardTries, resimGuardPause
	resimGuardTries, resimGuardPause = 3, time.Millisecond
	defer func() { resimGuardTries, resimGuardPause = oldTries, oldPause }()

	reader := projectionFreeDefinition()
	reader.EvaluatePath = func(_ *EvaluationContext, _ any) (PathResult, error) {
		_, err := Simulate(types.SimulationRequest{})
		return nil, err
	}
	registry := NewEvaluationRegistry()
	registry.Register(reader)
	_, err := registry.EvaluateEvidence(reader.Type, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "must not rerun the base simulation") {
		t.Fatalf("EvaluateEvidence error = %v, want a reader simulation violation", err)
	}
}
