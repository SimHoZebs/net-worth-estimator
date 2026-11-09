package sqlite

import (
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func TestAnalysisPublishesDegradedFindingsAndRetries(t *testing.T) {
	s := openSQLiteStore(t)
	id := seedAnalysisEvidence(t, s)
	run, _, claimed, err := s.ClaimAnalysis("income", "v1/model:0")
	if err != nil || !claimed {
		t.Fatalf("claim=%v err=%v", claimed, err)
	}
	detection := types.AnalysisDetection{TransactionID: id, Kind: "income", Strength: "moderate"}
	if err := s.CompleteAnalysis(run, []types.AnalysisDetection{detection}, types.JudgmentUnavailable); err != nil {
		t.Fatal(err)
	}
	findings, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findings) != 1 || findings[0].Status != "active" {
		t.Fatalf("findings=%+v err=%v", findings, err)
	}
	if _, _, claimed, err := s.ClaimAnalysis("income", run.Version); err != nil || claimed {
		t.Fatalf("retry lacked backoff: %v %v", claimed, err)
	}
	if _, err := s.db.Exec("UPDATE analysis_runs SET completed_at=? WHERE id=? AND user_id=:user_id", time.Now().Unix()-31, run.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, claimed, err := s.ClaimAnalysis("income", run.Version); err != nil || !claimed {
		t.Fatalf("degraded result did not retry: %v %v", claimed, err)
	}
}
