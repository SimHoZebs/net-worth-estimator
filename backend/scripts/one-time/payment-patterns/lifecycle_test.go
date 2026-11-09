package paymentupgrade_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type checkingProvider struct {
	cursor   string
	received int
}

func (p *checkingProvider) Open(_ context.Context, source judgment.FeedbackSource) (judgment.Session, error) {
	page, err := source.Page(p.cursor, 200)
	if err != nil {
		return nil, err
	}
	for _, event := range page.Feedback {
		if event.Request.ID == "" || event.Request.Kind != "income" {
			return nil, fmt.Errorf("unusable feedback evidence")
		}
		p.received++
	}
	p.cursor = page.Cursor
	return p, nil
}
func (p *checkingProvider) Revision() string { return fmt.Sprint("test:", p.received) }
func (p *checkingProvider) Evaluate(_ context.Context, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
	result := make([]types.AnalysisJudgment, len(requests))
	for i, r := range requests {
		result[i] = types.AnalysisJudgment{RequestID: r.ID, Status: "ready", Decision: "supported", Strength: "strong"}
	}
	return result, nil
}

func TestUpgradeCannotPoisonFeedbackBeforeOrAfterWithdrawal(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	s, err := db.EnsureUser("owner", "issuer", "owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateAccount(types.Account{ID: "bank", Name: "Bank", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	var transactions []simplefin.Transaction
	for i, day := range []int{2, 16, 30} {
		transactions = append(transactions, simplefin.Transaction{ID: fmt.Sprint(i), Description: "ACME PAYROLL", Amount: "2000", Posted: time.Date(2026, 1, day, 12, 0, 0, 0, time.UTC).Unix()})
	}
	observed := time.Date(2026, 1, 30, 12, 0, 0, 0, time.UTC)
	translation, err := simplefin.Translate(&simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "source", ConnID: "conn", Currency: "USD", Balance: "6000", BalanceDate: observed.Unix(), Transactions: transactions}}}, map[string]string{simplefin.AccountKey("conn", "source"): "bank"}, observed)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{"bank": true})); err != nil {
		t.Fatal(err)
	}
	runner, _ := analysis.NewRunner(db, analysis.PaymentPatterns{})
	if err = runner.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	findings, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findings) != 3 {
		t.Fatalf("findings=%v err=%v", findings, err)
	}
	answer := func(f types.AnalysisFinding) types.AnalysisFeedbackInput {
		return types.AnalysisFeedbackInput{RequestID: uuid.NewString(), RunID: f.RunID, Revision: f.FeedbackRevision, Action: "reject"}
	}
	reviewedID := findings[0].ID
	originalIDs := map[string]bool{}
	for _, f := range findings {
		originalIDs[f.ID] = true
	}
	if _, err = s.ReviewAnalysisFinding(findings[0].ID, answer(findings[0])); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	// Construct the prior persisted format only inside this one-time tool test.
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = raw.Exec(`UPDATE analysis_runs SET type='income', version='income-v2';
	UPDATE analysis_findings SET analysis_type='income',detection_json=json_remove(json_set(detection_json,'$.income',json_extract(detection_json,'$.pattern')),'$.pattern');
	UPDATE analysis_feedback SET payload_json=json_set(payload_json,'$.analysisType','income');`)
	if err != nil {
		t.Fatal(err)
	}
	raw.Close()
	if output, err := exec.Command("python3", "upgrade.py", path, path+".backup").CombinedOutput(); err != nil {
		t.Fatalf("upgrade: %v %s", err, output)
	}
	db, err = sqlite.SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s, err = db.User("owner")
	if err != nil {
		t.Fatal(err)
	}
	findings, err = s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range findings {
		if f.ID == reviewedID && (f.Review == nil || f.Review.Decision != "rejected") {
			t.Fatal("upgrade lost owner answer")
		}
		if _, err = s.ReviewAnalysisFinding(f.ID, answer(f)); !errors.Is(err, store.ErrAnalysisFeedbackConflict) {
			t.Fatalf("missing evidence accepted: %v", err)
		}
	}
	// A successful run can withdraw an old reviewed finding without changing the
	// bank revision. Its saved answer survives, but cannot label absent evidence.
	run, _, claimed, err := s.ClaimAnalysis("payments", "withdrawal-test")
	if err != nil || !claimed {
		t.Fatal(err)
	}
	if err = s.CompleteAnalysis(run, nil, ""); err != nil {
		t.Fatal(err)
	}
	findings, err = s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range findings {
		if _, err = s.ReviewAnalysisFinding(f.ID, answer(f)); !errors.Is(err, store.ErrAnalysisFeedbackConflict) {
			t.Fatalf("withdrawn missing evidence accepted: %v", err)
		}
	}
	provider := &checkingProvider{}
	runner, _ = analysis.NewRunner(db, analysis.NewPaymentPatterns(provider))
	if err = runner.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	findings, err = s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if provider.received != 0 || findings[0].JudgmentInput == nil || findings[0].Judgment.Status != "ready" {
		t.Fatal("upgrade poisoned provider preparation")
	}
	if _, err = s.ReviewAnalysisFinding(findings[0].ID, answer(findings[0])); err != nil {
		t.Fatal(err)
	}
	if err = runner.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if provider.received != 1 {
		t.Fatalf("valid current feedback deliveries=%d", provider.received)
	}
	for _, f := range findings {
		if !originalIDs[f.ID] {
			t.Fatal("finding identity changed")
		}
	}
}
