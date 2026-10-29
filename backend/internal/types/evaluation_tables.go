package types

// EvaluationTable exposes ordered wire tables to generic runtime, persistence,
// and API code. Typed JSON fields remain the public contract.
type EvaluationTable[T any] struct {
	Type string
	Rows *[]T
}

func (t *EvaluationTables) Tables() []EvaluationTable[EvaluationInstance[JsonValue]] {
	return []EvaluationTable[EvaluationInstance[JsonValue]]{
		{EvaluationTypeFinancialIndependence, &t.FinancialIndependence},
		{EvaluationTypeNetWorthThreshold, &t.NetWorthThreshold},
		{EvaluationTypeAccountBalance, &t.AccountBalance},
		{EvaluationTypePostingFulfillment, &t.PostingFulfillment},
		{EvaluationTypeCycleFulfillment, &t.CycleFulfillment},
		{EvaluationTypePlannedPurchases, &t.PlannedPurchases},
		{EvaluationTypeWhatIf, &t.WhatIf},
	}
}

func (t *EvaluationTables) ByType(evaluationType string) *[]EvaluationInstance[JsonValue] {
	for _, table := range t.Tables() {
		if table.Type == evaluationType {
			return table.Rows
		}
	}
	return nil
}

func (t *EvaluationResultTables) Tables() []EvaluationTable[EvaluationResultEnvelope] {
	return []EvaluationTable[EvaluationResultEnvelope]{
		{EvaluationTypeFinancialIndependence, &t.FinancialIndependence},
		{EvaluationTypeNetWorthThreshold, &t.NetWorthThreshold},
		{EvaluationTypeAccountBalance, &t.AccountBalance},
		{EvaluationTypePostingFulfillment, &t.PostingFulfillment},
		{EvaluationTypeCycleFulfillment, &t.CycleFulfillment},
		{EvaluationTypePlannedPurchases, &t.PlannedPurchases},
		{EvaluationTypeWhatIf, &t.WhatIf},
	}
}
