package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func seedCardKindEvidence(t *testing.T, s *sqliteStore) string {
	t.Helper()
	if _, err := s.CreateAccount(types.Account{ID: "checking", Name: "checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveAccountLink(store.AccountLink{BridgeAccountID: "bridge-card", ModelAccountID: "checking", BridgeName: "Chase Sapphire", Institution: "Chase", Origin: store.LinkOriginAuto}); err != nil {
		t.Fatal(err)
	}
	keys := bankKeys(ProviderSimpleFIN, "bridge-card", "charge")
	facts := types.TransactionFacts{Description: "CARD PURCHASE", Amount: "-25.00", Currency: "USD", PostedTime: 1785628800, Metadata: map[string]string{"account_type": "credit_card"}}
	applyDirectives(t, s, []BankDirective{
		bankUpsertDirective(bankSeedTransaction("CARD PURCHASE", "checking", "25", false), ProviderSimpleFIN, "bridge-card", "charge"),
		{Observe: &BankObservation{Keys: keys, Facts: facts}},
	})
	available := 500.0
	summary, err := s.ApplySync([]store.SyncCheckpoint{{
		AccountID: "checking", Balance: -120, AvailableBalance: &available,
		Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN, ObservedAt: 1785628801,
	}}, nil)
	if err != nil || summary.CheckpointsInserted != 1 {
		t.Fatalf("checkpoint summary=%+v err=%v", summary, err)
	}
	rows, err := s.LoadBankTransactions()
	if err != nil || len(rows) != 1 {
		t.Fatalf("bank=%+v err=%v", rows, err)
	}
	return rows[0].Transaction.ID
}

func TestCardKindSnapshotFindingsAndLifecycle(t *testing.T) {
	s := openSQLiteStore(t)
	transactionID := seedCardKindEvidence(t, s)

	run, input, claimed, err := s.ClaimAnalysis("card-kind", "card-kind-v1")
	if err != nil || !claimed || len(input.Transactions) != 1 || len(input.Accounts) != 1 {
		t.Fatalf("claim=%v input=%+v err=%v", claimed, input, err)
	}
	account := input.Accounts[0]
	if account.AccountID != "bridge-card" || account.LinkedID != "checking" || account.Name != "Chase Sapphire" || account.Institution != "Chase" || account.Kind != "cash" {
		t.Fatalf("account evidence=%+v", account)
	}
	if account.ExtraType != "credit_card" || !account.DebtLike {
		t.Fatalf("signals=%+v", account)
	}
	detection := types.AnalysisDetection{TransactionID: transactionID, AccountID: "checking", Kind: "card-kind", Strength: "strong", Evidence: []types.AnalysisEvidence{{Code: "card-kind.bridge-type"}}}
	if err := s.CompleteAnalysis(run, []types.AnalysisDetection{detection}, ""); err != nil {
		t.Fatal(err)
	}
	finding := onlyFinding(t, s)
	if finding.AccountID != "checking" || finding.AnalysisType != "card-kind" || finding.Stale || finding.Status != "active" {
		t.Fatalf("finding=%+v", finding)
	}
	linked, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{AccountIDs: []string{"checking"}})
	if err != nil || len(linked) != 1 || linked[0].ID != finding.ID {
		t.Fatalf("account filter=%+v err=%v", linked, err)
	}
	unrelated, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{AccountIDs: []string{"other"}})
	if err != nil || len(unrelated) != 0 {
		t.Fatalf("unrelated account filter=%+v err=%v", unrelated, err)
	}

	// Dismissal survives a recheck that carries the same evidence.
	if err := s.DismissAnalysisFinding(finding.ID, true, "verified-owner"); err != nil {
		t.Fatal(err)
	}
	recheck, _, claimed, err := s.ClaimAnalysis("card-kind", "card-kind-v2")
	if err != nil || !claimed {
		t.Fatalf("recheck claim=%v err=%v", claimed, err)
	}
	if err := s.CompleteAnalysis(recheck, []types.AnalysisDetection{detection}, ""); err != nil {
		t.Fatal(err)
	}
	afterRecheck := onlyFinding(t, s)
	if afterRecheck.ID != finding.ID || !afterRecheck.Dismissed || afterRecheck.FirstDetectedAt != finding.FirstDetectedAt {
		t.Fatalf("dismissal lost: %+v", afterRecheck)
	}

	// A changed fact supersedes the run. The finding goes stale while staying
	// active until a run at the new revision publishes an empty result.
	staleRun, _, claimed, err := s.ClaimAnalysis("card-kind", "card-kind-v3")
	if err != nil || !claimed {
		t.Fatalf("stale claim=%v err=%v", claimed, err)
	}
	applyDirectives(t, s, []BankDirective{{Observe: &BankObservation{Keys: bankKeys(ProviderSimpleFIN, "bridge-card", "charge"), Facts: types.TransactionFacts{Description: "CARD PURCHASE UPDATED", Amount: "-25.00", Currency: "USD", PostedTime: 1785628800, Metadata: map[string]string{"account_type": "credit_card"}}}}})
	if err := s.CompleteAnalysis(staleRun, nil, ""); err != nil {
		t.Fatal(err)
	}
	stale := onlyFinding(t, s)
	if !stale.Stale || stale.Status != "active" || !stale.Dismissed {
		t.Fatalf("stale finding=%+v", stale)
	}
	withdrawRun, _, claimed, err := s.ClaimAnalysis("card-kind", "card-kind-v3")
	if err != nil || !claimed {
		t.Fatalf("withdraw claim=%v err=%v", claimed, err)
	}
	if _, err := s.db.Exec(`UPDATE analysis_runs SET lease_until=0 WHERE id=? AND user_id=:user_id`, withdrawRun.ID); err != nil {
		t.Fatal(err)
	}
	retry, _, claimed, err := s.ClaimAnalysis("card-kind", "card-kind-v3")
	if err != nil || !claimed || retry.ID == withdrawRun.ID {
		t.Fatalf("lease recovery=%v err=%v", claimed, err)
	}
	if err := s.CompleteAnalysis(retry, nil, ""); err != nil {
		t.Fatal(err)
	}
	withdrawn := onlyFinding(t, s)
	if withdrawn.Stale || withdrawn.Status != "withdrawn" || !withdrawn.Dismissed || withdrawn.RunID != afterRecheck.RunID || withdrawn.AnalyzerVersion != afterRecheck.AnalyzerVersion {
		t.Fatalf("withdrawal=%+v", withdrawn)
	}

	// Reject through the existing feedback write on a fresh active finding.
	freshRun, _, claimed, err := s.ClaimAnalysis("card-kind", "card-kind-v4")
	if err != nil || !claimed {
		t.Fatalf("fresh claim=%v err=%v", claimed, err)
	}
	if err := s.CompleteAnalysis(freshRun, []types.AnalysisDetection{detection}, ""); err != nil {
		t.Fatal(err)
	}
	active := onlyFinding(t, s)
	if active.Status != "active" {
		t.Fatalf("fresh finding=%+v", active)
	}
	reviewInput := feedbackInput(t, active, "reject")
	reviewed, err := s.ReviewAnalysisFinding(active.ID, reviewInput)
	if err != nil || !reviewed.Dismissed || reviewed.Review.Decision != "rejected" {
		t.Fatalf("reject=%+v err=%v", reviewed, err)
	}
	if !onlyFinding(t, s).Dismissed {
		t.Fatal("reject did not dismiss the finding")
	}
}
