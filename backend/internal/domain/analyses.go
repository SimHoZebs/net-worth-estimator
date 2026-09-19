package domain

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Analyses ported from src/lib/analysis/: posting observations, shared
// classification plan, payroll detection, and salary estimation.

// RunPostingAnalyses executes the composed analysis pipeline.
func RunPostingAnalyses(document *types.FinancialModelDocument) (map[string]any, error) {
	dataset := BuildPostingObservationDataset(requireEnabledDocument(document))
	requirementIDs := []string{"payer", "payroll", "payment-rail"}
	classified := RunClassification([]*classifier{
		payerClassifier(), payrollClassifier(), paymentRailClassifier(),
	}, dataset)
	detection, detectionDiagnostics := runPayrollDetection(classified, requirementIDs)
	estimate, estimateDiagnostics := runSalaryEstimate(detection)
	return map[string]any{
		"observations":     dataset,
		"classification":   map[string]any{"classified": summarizeClassification(classified)},
		"payrollDetection": map[string]any{"result": detection, "diagnostics": detectionDiagnostics},
		"salaryEstimate":   map[string]any{"result": estimate, "diagnostics": estimateDiagnostics},
	}, nil
}

func requireEnabledDocument(document *types.FinancialModelDocument) *types.FinancialModelDocument {
	// Observations derive from the effective enabled postings only.
	return document
}
