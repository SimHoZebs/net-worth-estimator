package sqlite

import (
	"errors"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestAnalysisFeedbackSameIDsStayUserScoped(t *testing.T) {
	d := openSharedTestDatabase(t)
	a, b := privateTestPlan(t, d, "a"), privateTestPlan(t, d, "b")
	seedAnalysisEvidence(t, a)
	seedAnalysisEvidence(t, b)
	fa, fb := completeTestAnalysis(t, a, "v1"), completeTestAnalysis(t, b, "v1")
	if _, err := b.ReviewAnalysisFinding(fa.ID, feedbackInput(t, fa, "confirm")); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("cross-user write=%v", err)
	}
	if _, err := b.db.Exec(`UPDATE analysis_findings SET id=? WHERE id=? AND user_id=:user_id`, fa.ID, fb.ID); err != nil {
		t.Fatal(err)
	}
	fb.ID = fa.ID
	input := feedbackInput(t, fa, "confirm")
	if _, err := a.ReviewAnalysisFinding(fa.ID, input); err != nil {
		t.Fatal(err)
	}
	input.RunID = fb.RunID
	input.Action = "reject"
	if _, err := b.ReviewAnalysisFinding(fb.ID, input); err != nil {
		t.Fatal(err)
	}
	if onlyFinding(t, a).Review.Decision != "confirmed" || onlyFinding(t, b).Review.Decision != "rejected" {
		t.Fatal("same request/finding IDs crossed scopes")
	}
	for _, s := range []*sqliteStore{a, b} {
		items, err := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{FindingID: fa.ID})
		if err != nil || len(items) != 1 {
			t.Fatalf("scoped audit=%+v %v", items, err)
		}
	}
	if err := a.DeletePosting(fa.PostingID); err != nil {
		t.Fatal(err)
	}
	items, _ := a.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	other, _ := b.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if len(items) != 0 || len(other) != 1 {
		t.Fatal("deletion crossed scopes or retained feedback")
	}
}

func TestAnalysisFeedbackExplicitSchemaUpgradeAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "upgrade.db")
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	s := privateTestPlan(t, d, "owner")
	seedAnalysisEvidence(t, s)
	finding := completeTestAnalysis(t, s, "v1")
	// Recreate the immediately preceding Analysis schema with its saved finding.
	for _, query := range []string{
		`DROP TABLE analysis_feedback`,
		`ALTER TABLE analysis_findings DROP COLUMN review_json`,
		`ALTER TABLE analysis_findings DROP COLUMN feedback_revision`,
		`UPDATE analysis_findings SET dismissed=1`,
		`DELETE FROM schema_migrations WHERE name='analysis-feedback-v1'`,
	} {
		if _, err := d.SQL().Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	if runtime, err := OpenDatabase(path); !errors.Is(err, ErrSetupRequired) {
		if runtime != nil {
			runtime.Close()
		}
		t.Fatalf("runtime accepted pre-feedback schema: %v", err)
	}
	d, err = SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	s = privateTestPlan(t, d, "owner")
	upgraded := onlyFinding(t, s)
	if upgraded.ID != finding.ID || !upgraded.Dismissed || upgraded.Review != nil || upgraded.FeedbackRevision != 0 {
		t.Fatalf("upgrade lost original=%+v", upgraded)
	}
	input := feedbackInput(t, upgraded, "confirm")
	event, err := s.ReviewAnalysisFinding(finding.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	// Setup is idempotent and runtime reopen preserves saved labels and audit.
	d, err = SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	d, err = OpenDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	s = privateTestPlan(t, d, "owner")
	items, err := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(items) != 1 || !reflect.DeepEqual(items[0], event) || onlyFinding(t, s).Review.Decision != "confirmed" {
		t.Fatalf("restart=%+v %v", items, err)
	}
}
