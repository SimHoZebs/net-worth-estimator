package types

import (
	"reflect"
	"testing"
)

func TestEvaluationTablesWireContract(t *testing.T) {
	var configs EvaluationTables
	var results EvaluationResultTables

	// Tables() exposes pointers into the typed JSON fields so generic runtime
	// code can append rows that are later serialized. Writing through those
	// pointers must reach the typed fields, and the type order must agree with
	// the order the API and persistence layers use.
	var names []string
	for _, table := range configs.Tables() {
		names = append(names, table.Type)
		*table.Rows = append(*table.Rows, EvaluationInstance[JsonValue]{InstanceID: table.Type})
		if rows := configs.ByType(table.Type); rows == nil || len(*rows) != 1 || (*rows)[0].InstanceID != table.Type {
			t.Fatalf("configs.ByType(%q) = %v after write, want the appended row", table.Type, rows)
		}
	}
	for _, table := range results.Tables() {
		*table.Rows = append(*table.Rows, EvaluationResultEnvelope{InstanceID: table.Type})
	}

	if !reflect.DeepEqual(names, EvaluationTypeOrder) {
		t.Fatalf("table order = %v, want %v", names, EvaluationTypeOrder)
	}
	if configs.ByType("unknown") != nil {
		t.Fatal("configs.ByType(unknown) = non-nil, want nil")
	}
	if configs.PlannedPurchases[0].InstanceID != EvaluationTypePlannedPurchases ||
		results.PlannedPurchases[0].InstanceID != EvaluationTypePlannedPurchases {
		t.Fatal("table writes did not reach typed fields")
	}
}
