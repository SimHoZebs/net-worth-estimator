package csvio

import (
	"encoding/csv"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestPostingUUIDRequiresCanonicalForm(t *testing.T) {
	for _, test := range []struct {
		id   string
		want bool
	}{
		{"550e8400-e29b-41d4-a716-446655440000", true},
		{"550E8400-E29B-41D4-A716-446655440000", false},
		{"{550e8400-e29b-41d4-a716-446655440000}", false},
		{"legacy-payment", false},
	} {
		if got := isUUID(test.id); got != test.want {
			t.Fatalf("isUUID(%q) = %v, want %v", test.id, got, test.want)
		}
	}
}

func TestImportModelRemapsFICashflowSources(t *testing.T) {
	const existingUUID = "01900000-0000-7000-8000-000000000001"
	const amount = `{"resolver":"expression","config":{"expression":"100"},"inputs":{}}`
	path := t.TempDir()
	files := map[string][][]string{
		AccountsFile: {
			{"id", "name", "enabled"},
			{"old-payment", "old-payment", "true"},
		},
		CheckpointsFile: {{"AccountId", "Balance", "ObservedAt"}},
		PostingsFile: {
			{"id", "name", "amount", "postedTime", "enabled"},
			{"old-payment", "old-payment", amount, "1785628800", "true"},
			{existingUUID, "Existing UUID", amount, "1785628800", "true"},
		},
		FIFile: {
			{"instanceId", "name", "sources", "continuingPostingIds", "enabled"},
			{"fi", "old-payment", `[{"type":"cashflow","postingId":"old-payment","included":true},{"type":"cashflow","postingId":"` + existingUUID + `","included":false},{"type":"asset","accountId":"old-payment","included":true}]`, `["old-payment"]`, "true"},
		},
		ThresholdFile:      {{"instanceId"}},
		AccountBalanceFile: {{"instanceId"}},
		FulfillmentFile:    {{"instanceId"}},
	}
	for name, records := range files {
		filename := filepath.Join(path, name)
		if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
			t.Fatal(err)
		}
		file, err := os.Create(filename)
		if err != nil {
			t.Fatal(err)
		}
		err = csv.NewWriter(file).WriteAll(records)
		closeErr := file.Close()
		if err != nil || closeErr != nil {
			t.Fatalf("write %s: %v, close: %v", name, err, closeErr)
		}
	}
	document, err := ImportModel(path)
	if err != nil {
		t.Fatal(err)
	}
	id := document.Postings[0].ID
	if !isUUID(id) || id == existingUUID || document.Postings[1].ID != existingUUID {
		t.Fatal("import changed an existing UUID or did not generate a new posting UUID")
	}
	fi := document.Evaluations.FinancialIndependence[0]
	config := fi.Config.(map[string]any)
	wantSources := []any{
		map[string]any{"type": "cashflow", "postingId": id, "included": true},
		map[string]any{"type": "cashflow", "postingId": existingUUID, "included": false},
		map[string]any{"type": "asset", "accountId": "old-payment", "included": true},
	}
	if !reflect.DeepEqual(config["sources"], wantSources) || !reflect.DeepEqual(config["continuingPostingIds"], []any{id}) {
		t.Fatalf("imported FI references = %+v", config)
	}
	if document.Accounts[0].ID != "old-payment" || document.Postings[0].Name != "old-payment" || fi.Name != "old-payment" {
		t.Fatal("import rewrote an account ID or presentation string")
	}
}

func writeCSVDir(t *testing.T, files map[string][][]string) string {
	t.Helper()
	path := t.TempDir()
	for name, records := range files {
		filename := filepath.Join(path, name)
		if err := os.MkdirAll(filepath.Dir(filename), 0o700); err != nil {
			t.Fatal(err)
		}
		file, err := os.Create(filename)
		if err != nil {
			t.Fatal(err)
		}
		if err := csv.NewWriter(file).WriteAll(records); err != nil {
			file.Close()
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
	}
	return path
}

func TestImportCheckpointsRequireInstants(t *testing.T) {
	base := map[string][][]string{
		AccountsFile: {
			{"id", "name", "enabled"},
			{"checking", "Checking", "true"},
		},
		PostingsFile: {
			{"id", "name", "amount", "postedTime", "enabled"},
		},
		RulesFile:          {{"id", "name", "amount", "frequency", "startDate", "enabled"}},
		FIFile:             {{"instanceId"}},
		ThresholdFile:      {{"instanceId"}},
		AccountBalanceFile: {{"instanceId"}},
		FulfillmentFile:    {{"instanceId"}},
	}
	legacy := map[string][][]string{
		CheckpointsFile: {{"AccountId", "Balance", "ObservedAt"}, {"checking", "1000", ""}},
	}
	for k, v := range base {
		legacy[k] = v
	}
	if _, err := ImportModel(writeCSVDir(t, legacy)); err == nil {
		t.Fatalf("date-only checkpoint must fail without an instant")
	}
	stamped := map[string][][]string{
		CheckpointsFile: {{"AccountId", "Balance", "ObservedAt"}, {"checking", "1000", "1773187199"}},
	}
	for k, v := range base {
		stamped[k] = v
	}
	document, err := ImportModel(writeCSVDir(t, stamped))
	if err != nil {
		t.Fatalf("timestamped checkpoint must import: %v", err)
	}
	if len(document.Checkpoints) != 1 || document.Checkpoints[0].ObservedAt != 1773187199 {
		t.Fatalf("checkpoint = %+v, want the exact instant", document.Checkpoints)
	}
}
