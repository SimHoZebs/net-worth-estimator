package sqlite

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func transferLinkAmount(value string) types.TransactionAmountResolution {
	return types.TransactionAmountResolution{
		Resolver: "expression",
		Config:   map[string]any{"expression": value},
		Inputs:   map[string]types.AmountInputBinding{},
	}
}

// seedTransferLinkLeg inserts one bank leg with a production route (source
// for outflows, destinations for inflows) plus its saved bank evidence, and
// returns the stored transaction ID.
func seedTransferLinkLeg(t *testing.T, s *sqliteStore, name, modelAccount, bridge, bankID, factsAmount, currency string, inflow bool, posted int64) string {
	t.Helper()
	if _, err := s.CreateAccount(types.Account{ID: modelAccount, Name: modelAccount, Enabled: true}); err != nil && !store.IsIDConflict(err) {
		t.Fatal(err)
	}
	transaction := types.Transaction{
		Name: name, Source: SourceBankSync, Amount: transferLinkAmount("500.00"),
		PostedTime: posted, TransactionTime: posted, Enabled: true,
	}
	if inflow {
		transaction.Destinations = []string{modelAccount}
	} else {
		account := modelAccount
		transaction.SourceAccountID = &account
	}
	applyDirectives(t, s, []BankDirective{
		bankUpsertDirective(transaction, ProviderSimpleFIN, bridge, bankID),
		{Observe: &BankObservation{
			Keys:  bankKeys(ProviderSimpleFIN, bridge, bankID),
			Facts: types.TransactionFacts{Description: name, Amount: factsAmount, Currency: currency, PostedTime: posted},
		}},
	})
	rows, err := s.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.Transaction.Name == name {
			return row.Transaction.ID
		}
	}
	t.Fatalf("missing leg %q in %+v", name, rows)
	return ""
}

func transferPairDetection(id, peer, role string, candidates []string) types.AnalysisDetection {
	ids := append([]string{id}, candidates...)
	return types.AnalysisDetection{TransactionID: id, Kind: "transfer", Provider: "simplefin", Product: "internal-transfer",
		Role: role, Strength: "strong",
		Evidence: []types.AnalysisEvidence{{Code: "transfer.exact-leg-match", Reason: "test pair", TransactionIDs: ids}}}
}

func completeTransferPairAnalysis(t *testing.T, s *sqliteStore, detections []types.AnalysisDetection) map[string]types.AnalysisFinding {
	t.Helper()
	run, _, claimed, err := s.ClaimAnalysis("transfer", "transfer-v2")
	if err != nil || !claimed {
		t.Fatalf("claim=%v claimed=%v err=%v", run, claimed, err)
	}
	if err := s.CompleteAnalysis(run, detections, ""); err != nil {
		t.Fatal(err)
	}
	findings, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil {
		t.Fatal(err)
	}
	byTransaction := map[string]types.AnalysisFinding{}
	for _, item := range findings {
		byTransaction[item.TransactionID] = item
	}
	return byTransaction
}

func confirmTransferPair(t *testing.T, s *sqliteStore, finding types.AnalysisFinding, peer string) types.TransferLink {
	t.Helper()
	link, err := s.ConfirmTransferPair(finding.ID, peer, "verified-owner")
	if err != nil {
		t.Fatalf("confirm=%v", err)
	}
	return link
}

func seedTransferPair(t *testing.T, s *sqliteStore, posted int64) (checking, loan string) {
	t.Helper()
	stamp := posted
	if stamp == 0 {
		stamp = time.Date(2026, time.March, 10, 12, 0, 0, 0, time.UTC).Unix()
	}
	checking = seedTransferLinkLeg(t, s, "CREDIT CARD PAYMENT", "checking", "bridge-checking", "out-1", "-500.00", "USD", false, stamp)
	loan = seedTransferLinkLeg(t, s, "PAYMENT RECEIVED", "loan", "bridge-loan", "in-1", "500.00", "USD", true, stamp)
	return checking, loan
}

func TestTransferPairHappyPathLinksAndConfirms(t *testing.T) {
	s := openSQLiteStore(t)
	checking, loan := seedTransferPair(t, s, 0)
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(checking, loan, "outflow", []string{loan}),
		transferPairDetection(loan, checking, "inflow", []string{checking}),
	})
	link := confirmTransferPair(t, s, byTransaction[checking], loan)
	wantA, wantB := sortedTransferLegs(checking, loan)
	if link.LegA != wantA || link.LegB != wantB || link.FindingID != byTransaction[checking].ID || link.Actor != "verified-owner" || link.CreatedAt <= 0 {
		t.Fatalf("link=%+v", link)
	}
	links, err := s.ListTransferLinks()
	if err != nil || len(links) != 1 || links[0] != link {
		t.Fatalf("links=%+v err=%v", links, err)
	}
	feedback, err := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(feedback) != 1 || feedback[0].FindingID != byTransaction[checking].ID || feedback[0].Review == nil || feedback[0].Review.Decision != "confirmed" || feedback[0].Actor != "verified-owner" {
		t.Fatalf("feedback=%+v err=%v", feedback, err)
	}
	after, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{TransactionIDs: []string{checking}})
	if err != nil || len(after) != 1 || after[0].Review == nil || after[0].Review.Decision != "confirmed" || after[0].Dismissed {
		t.Fatalf("finding=%+v err=%v", after, err)
	}
}

func TestTransferPairRejectsSameAccount(t *testing.T) {
	s := openSQLiteStore(t)
	stamp := time.Date(2026, time.March, 10, 12, 0, 0, 0, time.UTC).Unix()
	out := seedTransferLinkLeg(t, s, "CORRECTION OUT", "checking", "bridge-a", "a-1", "-100.00", "USD", false, stamp)
	in := seedTransferLinkLeg(t, s, "CORRECTION IN", "checking", "bridge-b", "b-1", "100.00", "USD", true, stamp)
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(out, in, "outflow", []string{in}),
		transferPairDetection(in, out, "inflow", []string{out}),
	})
	if _, err := s.ConfirmTransferPair(byTransaction[out].ID, in, "verified-owner"); !errors.Is(err, store.ErrTransferLinkInvalid) {
		t.Fatalf("same account confirmed: %v", err)
	}
}

func TestTransferPairRejectsSameSign(t *testing.T) {
	s := openSQLiteStore(t)
	stamp := time.Date(2026, time.March, 10, 12, 0, 0, 0, time.UTC).Unix()
	first := seedTransferLinkLeg(t, s, "OUT ONE", "checking", "bridge-a", "a-1", "-100.00", "USD", false, stamp)
	second := seedTransferLinkLeg(t, s, "OUT TWO", "savings", "bridge-b", "b-1", "-100.00", "USD", false, stamp)
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(first, second, "outflow", []string{second}),
		transferPairDetection(second, first, "outflow", []string{first}),
	})
	_, err := s.ConfirmTransferPair(byTransaction[first].ID, second, "verified-owner")
	if !errors.Is(err, store.ErrTransferLinkInvalid) || !strings.Contains(err.Error(), "same-sign") {
		t.Fatalf("same sign confirmed: %v", err)
	}
}

func TestTransferPairRejectsSameRouteOppositeSign(t *testing.T) {
	s := openSQLiteStore(t)
	stamp := time.Date(2026, time.March, 10, 12, 0, 0, 0, time.UTC).Unix()
	// Both legs route as model outflows on different accounts, with opposite
	// bank facts signs so the amount and sign checks pass: only the route
	// pairing rejects them, mirroring the netting predicates.
	first := seedTransferLinkLeg(t, s, "OUT ONE", "checking", "bridge-a", "a-1", "-100.00", "USD", false, stamp)
	second := seedTransferLinkLeg(t, s, "OUT TWO", "savings", "bridge-b", "b-1", "100.00", "USD", false, stamp)
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(first, second, "outflow", []string{second}),
		transferPairDetection(second, first, "outflow", []string{first}),
	})
	_, err := s.ConfirmTransferPair(byTransaction[first].ID, second, "verified-owner")
	if !errors.Is(err, store.ErrTransferLinkInvalid) || !strings.Contains(err.Error(), "external inflow") {
		t.Fatalf("same-route pair confirmed: %v", err)
	}
}

func TestTransferPairRejectsAmountMismatch(t *testing.T) {
	s := openSQLiteStore(t)
	stamp := time.Date(2026, time.March, 10, 12, 0, 0, 0, time.UTC).Unix()
	out := seedTransferLinkLeg(t, s, "PAY OUT", "checking", "bridge-a", "a-1", "-500.00", "USD", false, stamp)
	in := seedTransferLinkLeg(t, s, "PAY IN", "loan", "bridge-b", "b-1", "499.99", "USD", true, stamp)
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(out, in, "outflow", []string{in}),
		transferPairDetection(in, out, "inflow", []string{out}),
	})
	if _, err := s.ConfirmTransferPair(byTransaction[out].ID, in, "verified-owner"); !errors.Is(err, store.ErrTransferLinkInvalid) {
		t.Fatalf("mismatched amounts confirmed: %v", err)
	}
}

func TestTransferPairRejectsOutOfWindow(t *testing.T) {
	s := openSQLiteStore(t)
	early := time.Date(2026, time.March, 1, 12, 0, 0, 0, time.UTC).Unix()
	late := time.Date(2026, time.March, 9, 12, 0, 0, 0, time.UTC).Unix()
	out := seedTransferLinkLeg(t, s, "PAY OUT", "checking", "bridge-a", "a-1", "-500.00", "USD", false, early)
	in := seedTransferLinkLeg(t, s, "PAY IN", "loan", "bridge-b", "b-1", "500.00", "USD", true, late)
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(out, in, "outflow", []string{in}),
		transferPairDetection(in, out, "inflow", []string{out}),
	})
	_, err := s.ConfirmTransferPair(byTransaction[out].ID, in, "verified-owner")
	if !errors.Is(err, store.ErrTransferLinkInvalid) || !strings.Contains(err.Error(), "7 days") {
		t.Fatalf("out-of-window pair confirmed: %v", err)
	}
}

func TestTransferPairRejectsUnknownPeer(t *testing.T) {
	s := openSQLiteStore(t)
	checking, loan := seedTransferPair(t, s, 0)
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(checking, loan, "outflow", []string{loan}),
		transferPairDetection(loan, checking, "inflow", []string{checking}),
	})
	if _, err := s.ConfirmTransferPair(byTransaction[checking].ID, "01900000-0000-7000-8000-000000000099", "verified-owner"); !errors.Is(err, store.ErrTransferLinkInvalid) {
		t.Fatalf("unknown peer confirmed: %v", err)
	}
	if _, err := s.ConfirmTransferPair("missing-finding", loan, "verified-owner"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("missing finding confirmed: %v", err)
	}
}

func TestTransferPairRejectsUnsettledAndForeignLegs(t *testing.T) {
	s := openSQLiteStore(t)
	stamp := time.Date(2026, time.March, 10, 12, 0, 0, 0, time.UTC).Unix()
	seedAccount(t, s, "checking")
	seedAccount(t, s, "loan")
	pending := types.Transaction{Name: "PENDING OUT", Source: SourceBankSync, SourceAccountID: &[]string{"checking"}[0],
		Amount: transferLinkAmount("500.00"), PostedTime: stamp, TransactionTime: stamp, Enabled: false, Pending: true}
	applyDirectives(t, s, []BankDirective{
		bankUpsertDirective(pending, ProviderSimpleFIN, "bridge-checking", "pend-1"),
		{Observe: &BankObservation{Keys: bankKeys(ProviderSimpleFIN, "bridge-checking", "pend-1"),
			Facts: types.TransactionFacts{Description: "PENDING OUT", Amount: "-500.00", Currency: "USD", PostedTime: stamp}}},
	})
	loan := seedTransferLinkLeg(t, s, "PAY IN", "loan", "bridge-loan", "in-1", "500.00", "USD", true, stamp)
	rows, err := s.LoadBankTransactions()
	if err != nil {
		t.Fatal(err)
	}
	pendingID := ""
	for _, row := range rows {
		if row.Transaction.Name == "PENDING OUT" {
			pendingID = row.Transaction.ID
		}
	}
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(pendingID, loan, "outflow", []string{loan}),
		transferPairDetection(loan, pendingID, "inflow", []string{pendingID}),
	})
	if _, err := s.ConfirmTransferPair(byTransaction[pendingID].ID, loan, "verified-owner"); !errors.Is(err, store.ErrTransferLinkInvalid) {
		t.Fatalf("pending leg confirmed: %v", err)
	}
}

func TestTransferPairRejectsNonUSD(t *testing.T) {
	s := openSQLiteStore(t)
	stamp := time.Date(2026, time.March, 10, 12, 0, 0, 0, time.UTC).Unix()
	out := seedTransferLinkLeg(t, s, "PAY OUT", "checking", "bridge-a", "a-1", "-500.00", "EUR", false, stamp)
	in := seedTransferLinkLeg(t, s, "PAY IN", "loan", "bridge-b", "b-1", "500.00", "EUR", true, stamp)
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(out, in, "outflow", []string{in}),
		transferPairDetection(in, out, "inflow", []string{out}),
	})
	if _, err := s.ConfirmTransferPair(byTransaction[out].ID, in, "verified-owner"); !errors.Is(err, store.ErrTransferLinkInvalid) {
		t.Fatalf("foreign legs confirmed: %v", err)
	}
}

func TestTransferPairRejectsIneligibleFindings(t *testing.T) {
	s := openSQLiteStore(t)
	checking, loan := seedTransferPair(t, s, 0)
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(checking, loan, "outflow", []string{loan}),
		transferPairDetection(loan, checking, "inflow", []string{checking}),
	})
	if err := s.DismissAnalysisFinding(byTransaction[checking].ID, true, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConfirmTransferPair(byTransaction[checking].ID, loan, "verified-owner"); !errors.Is(err, store.ErrTransferLinkInvalid) {
		t.Fatalf("dismissed finding confirmed: %v", err)
	}
	run, _, claimed, err := s.ClaimAnalysis("bnpl", "v1")
	if err != nil || !claimed {
		t.Fatalf("claim=%v %v", claimed, err)
	}
	if err := s.CompleteAnalysis(run, []types.AnalysisDetection{
		{TransactionID: loan, Kind: "bnpl", Provider: "klarna", Strength: "strong",
			Evidence: []types.AnalysisEvidence{{Code: "bnpl.product-descriptor", TransactionIDs: []string{loan}}}},
	}, ""); err != nil {
		t.Fatal(err)
	}
	bnpl, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{TransactionIDs: []string{loan}})
	if err != nil || len(bnpl) != 2 {
		t.Fatalf("claims=%+v err=%v", bnpl, err)
	}
	for _, item := range bnpl {
		if item.Kind != "bnpl" {
			continue
		}
		if _, err := s.ConfirmTransferPair(item.ID, checking, "verified-owner"); !errors.Is(err, store.ErrTransferLinkInvalid) {
			t.Fatalf("non-transfer finding confirmed: %v", err)
		}
	}
}

func TestTransferPairRequiresCrossUserIsolation(t *testing.T) {
	d := openSharedTestDatabase(t)
	alice := privateTestPlan(t, d, "alice")
	bob := privateTestPlan(t, d, "bob")
	checking, loan := seedTransferPair(t, alice, 0)
	byTransaction := completeTransferPairAnalysis(t, alice, []types.AnalysisDetection{
		transferPairDetection(checking, loan, "outflow", []string{loan}),
		transferPairDetection(loan, checking, "inflow", []string{checking}),
	})
	if _, err := bob.ConfirmTransferPair(byTransaction[checking].ID, loan, "bob"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("cross-user finding confirmed: %v", err)
	}
	if _, err := bob.RemoveTransferLinkByLeg(checking); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("cross-user unlink confirmed: %v", err)
	}
}

func TestTransferPairReplacesLinkOnSameLeg(t *testing.T) {
	s := openSQLiteStore(t)
	stamp := time.Date(2026, time.March, 10, 12, 0, 0, 0, time.UTC).Unix()
	out := seedTransferLinkLeg(t, s, "PAY OUT", "checking", "bridge-a", "a-1", "-500.00", "USD", false, stamp)
	first := seedTransferLinkLeg(t, s, "PAY IN ONE", "loan", "bridge-b", "b-1", "500.00", "USD", true, stamp)
	second := seedTransferLinkLeg(t, s, "PAY IN TWO", "savings", "bridge-c", "c-1", "500.00", "USD", true, stamp)
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(out, first, "outflow", []string{first, second}),
		transferPairDetection(first, out, "inflow", []string{out}),
		transferPairDetection(second, out, "inflow", []string{out}),
	})
	confirmTransferPair(t, s, byTransaction[out], first)
	replaced := confirmTransferPair(t, s, byTransaction[out], second)
	wantA, wantB := sortedTransferLegs(out, second)
	if replaced.LegA != wantA || replaced.LegB != wantB {
		t.Fatalf("replaced=%+v", replaced)
	}
	links, err := s.ListTransferLinks()
	if err != nil || len(links) != 1 || links[0] != replaced {
		t.Fatalf("links=%+v err=%v", links, err)
	}
	if _, err := s.RemoveTransferLinkByLeg(first); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("replaced leg still linked: %v", err)
	}
}

func TestTransferPairRetryIsIdempotent(t *testing.T) {
	s := openSQLiteStore(t)
	checking, loan := seedTransferPair(t, s, 0)
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(checking, loan, "outflow", []string{loan}),
		transferPairDetection(loan, checking, "inflow", []string{checking}),
	})
	first := confirmTransferPair(t, s, byTransaction[checking], loan)
	second := confirmTransferPair(t, s, byTransaction[checking], loan)
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("retry changed link: %+v vs %+v", first, second)
	}
	feedback, err := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(feedback) != 1 {
		t.Fatalf("retry duplicated acceptance: %+v err=%v", feedback, err)
	}
}

func TestTransferPairUnlinkRestoresLegs(t *testing.T) {
	s := openSQLiteStore(t)
	checking, loan := seedTransferPair(t, s, 0)
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(checking, loan, "outflow", []string{loan}),
		transferPairDetection(loan, checking, "inflow", []string{checking}),
	})
	link := confirmTransferPair(t, s, byTransaction[checking], loan)
	removed, err := s.RemoveTransferLinkByLeg(loan)
	if err != nil || removed != link {
		t.Fatalf("removed=%+v err=%v", removed, err)
	}
	links, err := s.ListTransferLinks()
	if err != nil || len(links) != 0 {
		t.Fatalf("links=%+v err=%v", links, err)
	}
	if _, err := s.RemoveTransferLinkByLeg(checking); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("second unlink confirmed: %v", err)
	}
	// A finding survives unlinking, so the pair can link again.
	relinked := confirmTransferPair(t, s, byTransaction[checking], loan)
	wantA, wantB := sortedTransferLegs(checking, loan)
	if relinked.LegA != wantA || relinked.LegB != wantB || relinked.FindingID != link.FindingID {
		t.Fatalf("relinked=%+v", relinked)
	}
}

func TestTransferPairClearRemovesLinksWithModelRows(t *testing.T) {
	s := openSQLiteStore(t)
	checking, loan := seedTransferPair(t, s, 0)
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(checking, loan, "outflow", []string{loan}),
		transferPairDetection(loan, checking, "inflow", []string{checking}),
	})
	confirmTransferPair(t, s, byTransaction[checking], loan)
	if err := s.Clear(); err != nil {
		t.Fatal(err)
	}
	links, err := s.ListTransferLinks()
	if err != nil || len(links) != 0 {
		t.Fatalf("links=%+v err=%v", links, err)
	}
	findings, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findings) != 0 {
		t.Fatalf("findings=%+v err=%v", findings, err)
	}
}

func TestTransferPairCoexistsWithIndependentClaims(t *testing.T) {
	s := openSQLiteStore(t)
	checking, loan := seedTransferPair(t, s, 0)
	byTransaction := completeTransferPairAnalysis(t, s, []types.AnalysisDetection{
		transferPairDetection(checking, loan, "outflow", []string{loan}),
		transferPairDetection(loan, checking, "inflow", []string{checking}),
	})
	run, _, claimed, err := s.ClaimAnalysis("bnpl", "v1")
	if err != nil || !claimed {
		t.Fatalf("claim=%v %v", claimed, err)
	}
	if err := s.CompleteAnalysis(run, []types.AnalysisDetection{
		{TransactionID: loan, Kind: "bnpl", Provider: "klarna", Strength: "strong",
			Evidence: []types.AnalysisEvidence{{Code: "bnpl.product-descriptor", TransactionIDs: []string{loan}}}},
	}, ""); err != nil {
		t.Fatal(err)
	}
	run, _, claimed, err = s.ClaimAnalysis("recurring", "v1")
	if err != nil || !claimed {
		t.Fatalf("claim=%v %v", claimed, err)
	}
	if err := s.CompleteAnalysis(run, []types.AnalysisDetection{
		{TransactionID: loan, Kind: "recurring", Provider: "grocer", Strength: "moderate",
			Evidence: []types.AnalysisEvidence{{Code: "recurring.cadence", TransactionIDs: []string{loan}}}},
	}, ""); err != nil {
		t.Fatal(err)
	}
	confirmTransferPair(t, s, byTransaction[checking], loan)
	findings, err := s.ListAnalysisFindings(types.AnalysisFindingFilter{TransactionIDs: []string{loan}})
	if err != nil || len(findings) != 3 {
		t.Fatalf("claims=%+v err=%v", findings, err)
	}
	for _, item := range findings {
		switch {
		case item.Kind == "transfer" && item.TransactionID == checking:
			if item.Review == nil || item.Review.Decision != "confirmed" {
				t.Fatalf("transfer acceptance missing: %+v", item)
			}
		case item.Kind == "transfer":
			// The peer leg keeps its own unanswered finding: linking
			// confirms the reviewed finding only.
			if item.Review != nil {
				t.Fatalf("peer claim disturbed: %+v", item)
			}
		case item.Kind == "bnpl" || item.Kind == "recurring":
			if item.Review != nil {
				t.Fatalf("independent claim disturbed: %+v", item)
			}
		default:
			t.Fatalf("unexpected claim: %+v", item)
		}
	}
	feedback, err := s.ListAnalysisFeedback(types.AnalysisFeedbackFilter{})
	if err != nil || len(feedback) != 1 || feedback[0].FindingID != byTransaction[checking].ID {
		t.Fatalf("acceptance leaked: %+v err=%v", feedback, err)
	}
}
