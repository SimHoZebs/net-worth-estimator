package sqlite

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
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

func TestAnalysisLifecycleTriggersFireOnBothSatellites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trigger.db")
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	s := privateTestPlan(t, d, "owner")
	seedAccount(t, s, "checking")
	account := "checking"
	posting, err := s.CreatePosting(types.Posting{Name: "Trigger expense", SourceAccountID: &account, Amount: types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}}, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	revision := func() int64 {
		t.Helper()
		var out int64
		if err := s.db.QueryRow(`SELECT revision FROM analysis_inputs WHERE user_id = :user_id`).Scan(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	if _, err := s.db.Exec(`INSERT INTO transaction_source_facts(posting_id, facts_json, user_id) VALUES (?, '{}', :user_id)`, posting.ID); err != nil {
		t.Fatal(err)
	}
	before := revision()
	if _, err := s.db.Exec(`UPDATE posting_sim SET enabled = 0 WHERE posting_id = ? AND user_id = :user_id`, posting.ID); err != nil {
		t.Fatal(err)
	}
	if got := revision(); got != before+1 {
		t.Fatalf("sim enabled flip revision = %d, want %d", got, before+1)
	}
	before = revision()
	if _, err := s.db.Exec(`UPDATE postings SET pending = 1 WHERE id = ? AND user_id = :user_id`, posting.ID); err != nil {
		t.Fatal(err)
	}
	if got := revision(); got != before+1 {
		t.Fatalf("pending flip revision = %d, want %d", got, before+1)
	}
	before = revision()
	if _, err := s.db.Exec(`UPDATE postings SET name = 'Renamed' WHERE id = ? AND user_id = :user_id`, posting.ID); err != nil {
		t.Fatal(err)
	}
	if got := revision(); got != before {
		t.Fatalf("name update revision = %d, want unchanged %d", got, before)
	}
}
