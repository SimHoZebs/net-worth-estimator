package domain

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Golden parity tests: fixture pairs are produced by the TypeScript engine
// (src/lib/projection/__tests__/__goldenDump.test.ts) and verified here.
// Floats compare exactly unless produced through transcendentals (A10), where
// a tight relative tolerance applies.

const goldenDir = "../../testdata/golden"

const (
	exactEpsilon   = 0.0
	floatTolerance = 1e-9
)

func loadGolden(t *testing.T, name string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(goldenDir, name))
	if err != nil {
		t.Fatalf("read golden %s: %v", name, err)
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("parse golden %s: %v", name, err)
	}
	return payload
}

func decodeDocument(t *testing.T, raw any) *types.FinancialModelDocument {
	t.Helper()
	data, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	var document types.FinancialModelDocument
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatalf("decode document: %v", err)
	}
	return &document
}

func decodeSettings(t *testing.T, raw any) *types.ProjectionRuntimeSettings {
	t.Helper()
	data, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	var settings types.ProjectionRuntimeSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		t.Fatalf("decode settings: %v", err)
	}
	return &settings
}

func decodeOverrides(t *testing.T, raw any) types.ModelOverrides {
	t.Helper()
	data, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	var overrides types.ModelOverrides
	if err := json.Unmarshal(data, &overrides); err != nil {
		t.Fatalf("decode overrides: %v", err)
	}
	return overrides
}

func decodeIncomeData(t *testing.T, raw any) *types.IncomeDataSnapshot {
	t.Helper()
	if raw == nil {
		return nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	var snapshot types.IncomeDataSnapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		t.Fatalf("decode income data: %v", err)
	}
	return &snapshot
}

func toAny(t *testing.T, value any) any {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var payload any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func toMap(t *testing.T, value any) map[string]any {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

// compareValues asserts deep equality with float tolerance.
func compareValues(t *testing.T, path string, expected, actual any) {
	t.Helper()
	switch expectedValue := expected.(type) {
	case nil:
		if actual != nil {
			t.Errorf("%s: expected null, got %v", path, actual)
		}
	case float64:
		actualNumber, ok := actual.(float64)
		if !ok {
			t.Errorf("%s: expected number %v, got %T %v", path, expectedValue, actual, actual)
			return
		}
		diff := math.Abs(expectedValue - actualNumber)
		scale := math.Max(math.Abs(expectedValue), math.Abs(actualNumber))
		tolerance := floatTolerance * math.Max(scale, 1)
		if diff > tolerance && diff > exactEpsilon {
			t.Errorf("%s: expected %v, got %v (diff %v)", path, expectedValue, actualNumber, diff)
		}
	case string:
		if actual != expectedValue {
			t.Errorf("%s: expected %q, got %v", path, expectedValue, actual)
		}
	case bool:
		if actual != expectedValue {
			t.Errorf("%s: expected %v, got %v", path, expectedValue, actual)
		}
	case []any:
		actualList, ok := actual.([]any)
		if !ok {
			t.Errorf("%s: expected array of %d, got %T", path, len(expectedValue), actual)
			return
		}
		if len(actualList) != len(expectedValue) {
			t.Errorf("%s: expected array length %d, got %d", path, len(expectedValue), len(actualList))
			return
		}
		for index := range expectedValue {
			compareValues(t, sprintfPath(path, index), expectedValue[index], actualList[index])
		}
	case map[string]any:
		actualMap, ok := actual.(map[string]any)
		if !ok {
			t.Errorf("%s: expected object, got %T", path, actual)
			return
		}
		for key, subExpected := range expectedValue {
			subActual, present := actualMap[key]
			if !present {
				t.Errorf("%s.%s: missing key", path, key)
				continue
			}
			compareValues(t, path+"."+key, subExpected, subActual)
		}
	default:
		t.Errorf("%s: unsupported expected type %T", path, expected)
	}
}

func sprintfPath(path string, index int) string {
	return path + "[" + itoa(index) + "]"
}

func itoa(value int) string {
	digits := "0123456789"
	if value == 0 {
		return "0"
	}
	out := ""
	negative := value < 0
	if negative {
		value = -value
	}
	for value > 0 {
		out = string(digits[value%10]) + out
		value /= 10
	}
	if negative {
		return "-" + out
	}
	return out
}

func TestGoldenDeterministic(t *testing.T) {
	payload := loadGolden(t, "deterministic.json")
	document := decodeDocument(t, payload["document"])
	settings := decodeSettings(t, payload["settings"])
	overrides := decodeOverrides(t, payload["overrides"])
	expectedResult := payload["result"].(map[string]any)

	result, err := ProjectFinancialModelDocument(document, settings, overrides, nil, nil)
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	compareValues(t, "result", expectedResult, toAny(t, result))
}

func TestGoldenCheckpoints(t *testing.T) {
	payload := loadGolden(t, "checkpoints.json")
	document := decodeDocument(t, payload["document"])
	settings := decodeSettings(t, payload["settings"])
	overrides := decodeOverrides(t, payload["overrides"])

	path, result, err := ProjectRawFinancialModelDocument(document, settings, overrides, nil, nil)
	if err != nil {
		t.Fatalf("project raw: %v", err)
	}
	compareValues(t, "result", payload["result"], toAny(t, result))

	// Path-specific checks: historical replay rows and movement events.
	expectedPath := payload["path"].(map[string]any)
	compareValues(t, "path.movementEvents", expectedPath["movementEvents"], toAny(t, path.MovementEvents))
	compareValues(t, "path.rows", expectedPath["rows"], toAny(t, path.Rows))
}

func TestGoldenIncome(t *testing.T) {
	payload := loadGolden(t, "income.json")
	document := decodeDocument(t, payload["document"])
	settings := decodeSettings(t, payload["settings"])
	overrides := decodeOverrides(t, payload["overrides"])
	incomeData := decodeIncomeData(t, payload["incomeData"])

	result, err := ProjectFinancialModelDocument(document, settings, overrides, nil, incomeData)
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	compareValues(t, "result", payload["result"], toAny(t, result))
}

func TestGoldenStochasticSeeded(t *testing.T) {
	payload := loadGolden(t, "stochastic.json")
	document := decodeDocument(t, payload["document"])
	settings := decodeSettings(t, payload["settings"])
	overrides := decodeOverrides(t, payload["overrides"])
	configRaw := payload["config"].(map[string]any)
	seed := int64(configRaw["seed"].(float64))
	config := types.StochasticConfig{RunCount: int(configRaw["runCount"].(float64)), Seed: &seed}

	result, err := StochasticProjection(context.Background(), document, settings, overrides, config, nil, nil)
	if err != nil {
		t.Fatalf("stochastic: %v", err)
	}
	compareValues(t, "result.bands", payload["result"].(map[string]any)["bands"], toAny(t, result.Bands))
	compareValues(t, "result.milestones", payload["result"].(map[string]any)["milestones"], toAny(t, result.Milestones))
}
