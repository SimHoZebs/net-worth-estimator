package sqlite

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSetupAndRuntimeRejectMissingAnalysisSchemaWithoutChanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "upgrade.db")
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	s := privateTestPlan(t, d, "owner")
	seedAccount(t, s, "checking")
	for _, name := range analysisTriggerNames {
		if _, err := d.db.Exec(`DROP TRIGGER ` + name); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"analysis_findings", "analysis_runs", "analysis_inputs", "transaction_source_facts"} {
		if _, err := d.db.Exec(`DROP TABLE ` + name); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := d.db.Exec(`DELETE FROM schema_migrations WHERE name='transaction-analysis-v1'`); err != nil {
		t.Fatal(err)
	}
	d.Close()
	if opened, err := OpenDatabase(path); !errors.Is(err, ErrSetupRequired) {
		if opened != nil {
			opened.Close()
		}
		t.Fatalf("runtime accepted missing analysis schema: %v", err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if opened, err := SetupDatabase(path); !errors.Is(err, ErrSetupRequired) {
		if opened != nil {
			opened.Close()
		}
		t.Fatalf("setup accepted missing analysis schema: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("rejected setup changed source: %v", err)
	}
}
