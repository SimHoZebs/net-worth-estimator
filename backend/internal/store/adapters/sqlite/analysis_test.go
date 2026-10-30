package sqlite

import (
	"reflect"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedAnalysisEvidence(t *testing.T, s *sqliteStore) string {
	t.Helper()
	seedAccount(t, s, "checking")
	keys := bankKeys(SourceSimpleFIN, "bank", "charge")
	facts := types.TransactionFacts{Description: "KLARNA PAY IN 4", Amount: "-25.00", Currency: "USD", PostedTime: 1785628800}
	applyDirectives(t, s, []BankDirective{
		bankUpsertDirective(bankSeedPosting("KLARNA", "checking", "25", false), SourceSimpleFIN, "bank", "charge"),
		{Observe: &BankObservation{Keys: keys, Facts: facts}},
	})
	rows, err := s.LoadBankPostings()
	if err != nil || len(rows) != 1 {
		t.Fatalf("bank=%+v err=%v", rows, err)
	}
	return rows[0].Posting.ID
}

func completeTestAnalysis(t *testing.T, s *sqliteStore, version string) types.AnalysisFinding {
	t.Helper()
	run, input, claimed, err := s.ClaimAnalysis("bnpl", version)
	if err != nil || !claimed || len(input.Transactions) != 1 {
		t.Fatalf("claim=%+v input=%+v claimed=%v err=%v", run, input, claimed, err)
	}
	detection := types.AnalysisDetection{PostingID: input.Transactions[0].PostingID, Kind: "bnpl", Provider: "klarna", Strength: "strong", Evidence: []types.AnalysisEvidence{{Code: "test", PostingIDs: []string{input.Transactions[0].PostingID}}}}
	if err := s.CompleteAnalysis(run, []types.AnalysisDetection{detection}, ""); err != nil {
		t.Fatal(err)
	}
	findings, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findings) != 1 {
		t.Fatalf("findings=%+v err=%v", findings, err)
	}
	return findings[0]
}

func TestAnalysisEvidenceIsIndependentAndDeduplicated(t *testing.T) {
	s := openSQLiteStore(t)
	id := seedAnalysisEvidence(t, s)
	before, _ := s.LoadModel()
	finding := completeTestAnalysis(t, s, "v1")
	if finding.Stale || finding.Status != "active" || finding.PostingID != id {
		t.Fatalf("finding=%+v", finding)
	}
	if _, _, claimed, err := s.ClaimAnalysis("bnpl", "v1"); err != nil || claimed {
		t.Fatalf("duplicate claim=%v err=%v", claimed, err)
	}
	applyDirectives(t, s, []BankDirective{{Observe: &BankObservation{Keys: bankKeys(SourceSimpleFIN, "bank", "charge"), Facts: types.TransactionFacts{Description: "KLARNA PAY IN 4", Amount: "-25.00", Currency: "USD", PostedTime: 1785628800}}}})
	if _, _, claimed, err := s.ClaimAnalysis("bnpl", "v1"); err != nil || claimed {
		t.Fatalf("identical observation scheduled analysis: %v %v", claimed, err)
	}
	if _, err := s.SaveCheckpoint(types.Checkpoint{AccountID: "checking", ObservedAt: time.Date(2026, time.August, 2, 23, 59, 59, 0, time.UTC).Unix(), Balance: 100}); err != nil {
		t.Fatal(err)
	}
	if _, _, claimed, err := s.ClaimAnalysis("bnpl", "v1"); err != nil || claimed {
		t.Fatalf("balance scheduled analysis: %v %v", claimed, err)
	}
	if err := s.DismissAnalysisFinding(finding.ID, true, ""); err != nil {
		t.Fatal(err)
	}
	next := completeTestAnalysis(t, s, "v2")
	if next.ID != finding.ID || !next.Dismissed || next.FirstDetectedAt != finding.FirstDetectedAt {
		t.Fatalf("review lost: %+v", next)
	}
	after, _ := s.LoadModel()
	// The explicit balance observation is the only financial change.
	after.Checkpoints = before.Checkpoints
	if !reflect.DeepEqual(before, after) {
		t.Fatal("analysis changed the financial model")
	}
}

func TestAnalysisStaleCompletionRecoveryAndWithdrawal(t *testing.T) {
	s := openSQLiteStore(t)
	seedAnalysisEvidence(t, s)
	original := completeTestAnalysis(t, s, "v1")
	run, _, claimed, err := s.ClaimAnalysis("bnpl", "v2")
	if err != nil || !claimed {
		t.Fatalf("claim %v %v", claimed, err)
	}
	if _, _, other, err := s.ClaimAnalysis("bnpl", "v2"); err != nil || other {
		t.Fatalf("concurrent claim %v %v", other, err)
	}
	applyDirectives(t, s, []BankDirective{{Observe: &BankObservation{Keys: bankKeys(SourceSimpleFIN, "bank", "charge"), Facts: types.TransactionFacts{Description: "KLARNA PAY NOW", Amount: "-25", Currency: "USD"}}}})
	if err := s.CompleteAnalysis(run, nil, ""); err != nil {
		t.Fatal(err)
	}
	findings, _ := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if !findings[0].Stale || findings[0].Status != "active" {
		t.Fatal("obsolete run replaced findings")
	}
	run, _, claimed, err = s.ClaimAnalysis("bnpl", "v2")
	if err != nil || !claimed {
		t.Fatalf("claim %v %v", claimed, err)
	}
	if _, err := s.db.Exec(`UPDATE analysis_runs SET lease_until=0 WHERE id=? AND user_id=:user_id`, run.ID); err != nil {
		t.Fatal(err)
	}
	retry, _, claimed, err := s.ClaimAnalysis("bnpl", "v2")
	if err != nil || !claimed || retry.ID == run.ID {
		t.Fatalf("recovery %v %v", claimed, err)
	}
	if err := s.CompleteAnalysis(retry, nil, ""); err != nil {
		t.Fatal(err)
	}
	findings, _ = s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if findings[0].Stale || findings[0].Status != "withdrawn" {
		t.Fatalf("withdrawal=%+v", findings)
	}
	if findings[0].RunID != original.RunID || findings[0].AnalyzerVersion != "v1" {
		t.Fatal("withdrawal rewrote original detection provenance")
	}
	if err := s.CompleteAnalysis(run, []types.AnalysisDetection{{PostingID: findings[0].PostingID, Kind: "bnpl"}}, ""); err != nil {
		t.Fatal(err)
	}
	findings, _ = s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if findings[0].Status != "withdrawn" {
		t.Fatal("expired run published")
	}
}

func TestAnalysisIsolationImportAndClear(t *testing.T) {
	d := openSharedTestDatabase(t)
	a, b := privateTestPlan(t, d, "a"), privateTestPlan(t, d, "b")
	const sharedID = "01900000-0000-7000-8000-000000000099"
	for _, scoped := range []*sqliteStore{a, b} {
		seedAccount(t, scoped, "checking")
		if _, err := scoped.CreatePosting(testPostingFixture(sharedID)); err != nil {
			t.Fatal(err)
		}
		if _, err := scoped.db.Exec(`UPDATE postings SET source = 'simplefin' WHERE id = ? AND user_id = :user_id`, sharedID); err != nil {
			t.Fatal(err)
		}
		tx, err := scoped.db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if err := insertPostingSyncKey(tx, postingSyncKey{provider: SourceSimpleFIN, accountID: "bank", transactionID: "charge", postingID: sharedID}); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if err := observeBankTransaction(tx, &BankObservation{Keys: bankKeys(SourceSimpleFIN, "bank", "charge"), Facts: types.TransactionFacts{Description: "KLARNA PAY IN 4", Amount: "-25", Currency: "USD"}}); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	fa := completeTestAnalysis(t, a, "v1")
	fb := completeTestAnalysis(t, b, "v1")
	if err := a.DismissAnalysisFinding(fb.ID, true, ""); err != ErrNotFound {
		t.Fatalf("cross-user review=%v", err)
	}
	filtered, err := a.ListAnalysisFindings(types.AnalysisFindingFilter{PostingIDs: []string{"missing"}})
	if err != nil || len(filtered) != 0 {
		t.Fatalf("cross-user query=%+v %v", filtered, err)
	}
	if _, err := b.db.Exec(`UPDATE analysis_findings SET id = ? WHERE id = ? AND user_id = :user_id`, fa.ID, fb.ID); err != nil {
		t.Fatal(err)
	}
	fb.ID = fa.ID
	if err := b.DismissAnalysisFinding(fb.ID, true, ""); err != nil {
		t.Fatal(err)
	}
	owned, err := a.ListAnalysisFindings(types.AnalysisFindingFilter{PostingIDs: []string{sharedID}})
	if err != nil || len(owned) != 1 || owned[0].Dismissed {
		t.Fatalf("same IDs crossed user scope: %+v %v", owned, err)
	}
	doc, _ := a.LoadModel()
	if _, err := a.ImportModel(doc); err != nil {
		t.Fatal(err)
	}
	findings, err := a.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findings) != 1 || findings[0].ID != fa.ID {
		t.Fatalf("import lost findings: %+v %v", findings, err)
	}
	if err := a.Clear(); err != nil {
		t.Fatal(err)
	}
	findings, err = a.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findings) != 0 {
		t.Fatalf("clear=%+v %v", findings, err)
	}
	other, _ := b.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if len(other) != 1 || other[0].ID != fb.ID {
		t.Fatal("clear crossed scopes")
	}
}
