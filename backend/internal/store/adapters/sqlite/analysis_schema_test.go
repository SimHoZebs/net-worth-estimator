package sqlite

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestAnalysisUpgradeIsExplicitAndPreservesFinancialData(t *testing.T) {
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
	d, err = SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	scoped, err := d.User("owner")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := scoped.LoadDocument()
	if err != nil || len(doc.Accounts) != 1 || doc.Accounts[0].ID != "checking" {
		t.Fatalf("upgrade changed model: %+v %v", doc, err)
	}
}
