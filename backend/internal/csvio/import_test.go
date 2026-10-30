package csvio

import (
	"encoding/csv"
	"os"
	"path/filepath"
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
	} {
		if got := isUUID(test.id); got != test.want {
			t.Fatalf("isUUID(%q) = %v, want %v", test.id, got, test.want)
		}
	}
}

func TestImportModelPreservesCanonicalPostingIDs(t *testing.T) {
	const postingID = "01900000-0000-7000-8000-000000000001"
	const amount = `{"resolver":"expression","config":{"expression":"100"},"inputs":{}}`
	files := map[string][][]string{
		AccountsFile: {
			{"id", "name", "enabled"},
			{"checking", "Checking", "true"},
		},
		CheckpointsFile: {{"AccountId", "Balance", "ObservedAt"}},
		PostingsFile: {
			{"id", "name", "amount", "postedTime", "enabled"},
			{postingID, "Pay", amount, "1785628800", "true"},
		},
		RulesFile:          {{"id", "name", "amount", "frequency", "startDate", "enabled"}},
		FIFile:             {{"instanceId"}},
		ThresholdFile:      {{"instanceId"}},
		AccountBalanceFile: {{"instanceId"}},
		FulfillmentFile:    {{"instanceId"}},
	}
	model, err := ImportModel(writeCSVDir(t, files))
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Postings) != 1 || model.Postings[0].ID != postingID {
		t.Fatalf("postings = %+v, want the canonical UUID preserved", model.Postings)
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
	missingInstant := map[string][][]string{
		CheckpointsFile: {{"AccountId", "Balance", "ObservedAt"}, {"checking", "1000", ""}},
	}
	for k, v := range base {
		missingInstant[k] = v
	}
	if _, err := ImportModel(writeCSVDir(t, missingInstant)); err == nil {
		t.Fatalf("checkpoint without required observedAt must fail")
	}
	stamped := map[string][][]string{
		CheckpointsFile: {{"AccountId", "Balance", "ObservedAt"}, {"checking", "1000", "1773187199"}},
	}
	for k, v := range base {
		stamped[k] = v
	}
	model, err := ImportModel(writeCSVDir(t, stamped))
	if err != nil {
		t.Fatalf("timestamped checkpoint must import: %v", err)
	}
	if len(model.Checkpoints) != 1 || model.Checkpoints[0].ObservedAt != 1773187199 {
		t.Fatalf("checkpoint = %+v, want the exact instant", model.Checkpoints)
	}
}
