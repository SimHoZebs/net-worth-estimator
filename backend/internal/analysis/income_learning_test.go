package analysis_test

import (
	"context"
	"fmt"
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

type deliveredFeedback struct {
	Owner string
	judgment.FeedbackPage
}
type sharedJudgmentProvider struct {
	revision     int
	cursors      map[string]string
	batches      []deliveredFeedback
	unavailable  bool
	failFeedback bool
}

func (s *sharedJudgmentProvider) Open(_ context.Context, source judgment.FeedbackSource) (judgment.Session, error) {
	if s.unavailable {
		return nil, fmt.Errorf("offline")
	}
	owner := source.Owner()
	page, err := source.Page(s.cursors[owner], 200)
	if err != nil {
		return nil, err
	}
	if page.Cursor != s.cursors[owner] {
		if s.failFeedback {
			return nil, fmt.Errorf("storage unavailable")
		}
		s.batches = append(s.batches, deliveredFeedback{owner, page})
		s.cursors[owner] = page.Cursor
		if len(page.Feedback) > 0 {
			s.revision++
		}
	}
	return fixedJudgmentSession{revision: fmt.Sprintf("provider:%d", s.revision)}, nil
}

type fixedJudgmentSession struct{ revision string }

func (s fixedJudgmentSession) Revision() string { return s.revision }
func (fixedJudgmentSession) Evaluate(_ context.Context, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
	var decisions []types.AnalysisJudgment
	for _, request := range requests {
		decisions = append(decisions, types.AnalysisJudgment{RequestID: request.ID, Status: "ready", Decision: "supported", Strength: "strong", Reason: "Evidence supports income."})
	}
	return decisions, nil
}

func seedIncomeUser(t *testing.T, db *sqlite.Database, owner string) store.Store {
	t.Helper()
	scoped, err := db.EnsureUser(owner, "issuer", owner)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	var transactions []simplefin.Transaction
	for i, day := range []int{2, 16, 30} {
		transactions = append(transactions, simplefin.Transaction{ID: fmt.Sprint(i), Description: "ACME PAYROLL", Amount: "2000", Posted: incomeDay(2026, 1, day)})
	}
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "bank", ConnID: "conn", Currency: "USD", Balance: "6000", BalanceDate: incomeDay(2026, 1, 30), Transactions: transactions}}}
	translation, err := simplefin.Translate(set, map[string]string{simplefin.AccountKey("conn", "bank"): "checking"}, time.Unix(incomeDay(2026, 1, 30), 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{"checking": true})); err != nil {
		t.Fatal(err)
	}
	return scoped
}

func incomeFindings(t *testing.T, scoped store.Store) []types.AnalysisFinding {
	t.Helper()
	findings, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findings) != 3 {
		t.Fatalf("findings=%+v err=%v", findings, err)
	}
	return findings
}

func TestIncomeSharedLearningRescoresAllOwnersWithoutBankChanges(t *testing.T) {
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	alice, bob := seedIncomeUser(t, db, "alice"), seedIncomeUser(t, db, "bob")
	scorer := &sharedJudgmentProvider{cursors: map[string]string{}}
	runner, err := analysis.NewRunner(db, analysis.NewPaymentPatterns(scorer))
	if err != nil {
		t.Fatal(err)
	}
	run := func() {
		t.Helper()
		if err := runner.RunOnce(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	run()
	a, b := incomeFindings(t, alice)[0], incomeFindings(t, bob)[0]
	input := types.AnalysisFeedbackInput{RequestID: uuid.NewString(), RunID: a.RunID, Revision: a.FeedbackRevision, Action: "confirm", Actor: "raw-identity-subject"}
	event, err := alice.ReviewAnalysisFinding(a.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	// An HTTP retry reuses the same immutable event; the worker owns delivery.
	if _, err := alice.ReviewAnalysisFinding(a.ID, input); err != nil {
		t.Fatal(err)
	}
	scorer.failFeedback = true
	run()
	if scorer.cursors["alice"] != "" {
		t.Fatal("failed delivery advanced cursor")
	}
	scorer.failFeedback = false
	run()
	if len(scorer.batches) != 1 || len(scorer.batches[0].Feedback) != 1 {
		t.Fatalf("batches=%+v", scorer.batches)
	}
	batch := scorer.batches[0]
	if batch.Owner != "alice" || batch.Feedback[0].EventID != event.ID || batch.Feedback[0].RunID != a.RunID || batch.Feedback[0].Request.ID != a.JudgmentInput.ID {
		t.Fatalf("lost provenance: %+v", batch)
	}
	nextA, nextB := incomeFindings(t, alice)[0], incomeFindings(t, bob)[0]
	if nextA.RunID == a.RunID || nextB.RunID == b.RunID || nextA.InputRevision != a.InputRevision || nextB.InputRevision != b.InputRevision {
		t.Fatal("model revision did not independently rescore all owners")
	}
	if nextA.Review == nil || nextA.Review.Decision != "confirmed" || nextB.Review != nil {
		t.Fatal("shared learning changed a user's review")
	}
	run()
	if len(scorer.batches) != 1 {
		t.Fatal("retrained delivered feedback")
	}
	// Bob also contributes to the exact same model revision.
	b = incomeFindings(t, bob)[0]
	if _, err := bob.ReviewAnalysisFinding(b.ID, types.AnalysisFeedbackInput{RequestID: uuid.NewString(), RunID: b.RunID, Revision: b.FeedbackRevision, Action: "reject"}); err != nil {
		t.Fatal(err)
	}
	run()
	run() // Alice is visited before Bob, so sees Bob's new revision next pass.
	if scorer.revision != 2 || len(scorer.batches) != 2 {
		t.Fatalf("revision=%d batches=%+v", scorer.revision, scorer.batches)
	}
	if incomeFindings(t, alice)[0].AnalyzerVersion != incomeFindings(t, bob)[0].AnalyzerVersion {
		t.Fatal("owners do not share a model")
	}
}

func TestIncomeProviderRecoveryRescoresUnchangedSnapshot(t *testing.T) {
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	scoped := seedIncomeUser(t, db, "owner")
	scorer := &sharedJudgmentProvider{cursors: map[string]string{}, unavailable: true}
	runner, _ := analysis.NewRunner(db, analysis.NewPaymentPatterns(scorer))
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	before := incomeFindings(t, scoped)[0]
	scorer.unavailable = false
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	after := incomeFindings(t, scoped)[0]
	if before.RunID == after.RunID || before.InputRevision != after.InputRevision {
		t.Fatal("provider recovery did not rescore unchanged evidence")
	}
}

func TestIncomePurposeRetainsReviewedAnswerWhenRepetitionIsNoLongerEstablished(t *testing.T) {
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	scoped := seedIncomeUser(t, db, "owner")
	runner, err := analysis.NewRunner(db, analysis.PaymentPatterns{})
	if err != nil {
		t.Fatal(err)
	}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	findings := incomeFindings(t, scoped)
	first := findings[0]
	if _, err := scoped.ReviewAnalysisFinding(first.ID, types.AnalysisFeedbackInput{RequestID: uuid.NewString(), RunID: first.RunID, Revision: first.FeedbackRevision, Action: "confirm"}); err != nil {
		t.Fatal(err)
	}
	bankRows, err := scoped.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	var keys []store.BankKey
	for _, row := range bankRows {
		if row.Transaction.ID == findings[2].TransactionID {
			keys = row.Keys
		}
	}
	if len(keys) == 0 {
		t.Fatal("missing bank identity")
	}
	changed := types.TransactionFacts{Description: "ACME PAYROLL", Amount: "17", Currency: "USD", OccurredAt: incomeDay(2026, 1, 30)}
	if _, err := scoped.ApplySync(nil, []store.BankDirective{{Observe: &store.BankObservation{Keys: keys, Facts: changed}}}); err != nil {
		t.Fatal(err)
	}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, finding := range incomeFindings(t, scoped) {
		if finding.Status != "active" || finding.Stale || finding.Product != "" || finding.Pattern.AnnualizedEstimate != "" {
			t.Fatalf("purpose incorrectly depends on repetition=%+v", finding)
		}
		if finding.ID == first.ID && (finding.Review == nil || finding.Review.Decision != "confirmed") {
			t.Fatal("withdrawal lost the explicit answer")
		}
	}
}
