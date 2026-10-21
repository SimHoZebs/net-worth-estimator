package types

import (
	"reflect"
	"testing"
)

func TestEvaluationTablesShareStableTypeOrder(t *testing.T) {
	var configs EvaluationTables
	var results EvaluationResultTables
	configTables, resultTables := configs.Tables(), results.Tables()
	var names []string
	for index, table := range configTables {
		names = append(names, table.Type)
		if table.Type != resultTables[index].Type || table.Rows != configs.ByType(table.Type) {
			t.Fatalf("table mismatch for %s", table.Type)
		}
		*table.Rows = append(*table.Rows, EvaluationInstance[JsonValue]{InstanceID: table.Type})
		*resultTables[index].Rows = append(*resultTables[index].Rows, EvaluationResultEnvelope{InstanceID: table.Type})
	}
	if !reflect.DeepEqual(names, EvaluationTypeOrder) || configs.ByType("unknown") != nil {
		t.Fatalf("table order = %v", names)
	}
	if configs.PlannedPurchases[0].InstanceID != EvaluationTypePlannedPurchases || results.PlannedPurchases[0].InstanceID != EvaluationTypePlannedPurchases {
		t.Fatal("table writes did not reach typed fields")
	}
}
