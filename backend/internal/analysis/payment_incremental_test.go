package analysis_test

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/judgment"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

type incrCountingJudge struct {
	calls    int
	requests int
	decide   func(types.AnalysisJudgmentInput) types.AnalysisJudgment
}

func (j *incrCountingJudge) Evaluate(_ context.Context, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
	j.calls++
	j.requests += len(requests)
	out := make([]types.AnalysisJudgment, 0, len(requests))
	for _, request := range requests {
		out = append(out, j.decide(request))
	}
	return out, nil
}

func incrReadyDecision(request types.AnalysisJudgmentInput) types.AnalysisJudgment {
	return types.AnalysisJudgment{RequestID: request.ID, Status: "ready", Decision: "supported", Strength: "strong", Reason: "Test supports this pattern."}
}

func incrPendingDecision(request types.AnalysisJudgmentInput) types.AnalysisJudgment {
	return types.AnalysisJudgment{RequestID: request.ID, Status: "pending"}
}

// incrHistory is a multi-stream history with mixed cadences: biweekly payroll,
// monthly side income, monthly rent, irregular bonus income with no cadence,
// and a second monthly rent stream.
func incrHistory() []types.AnalysisTransaction {
	return []types.AnalysisTransaction{
		incomeTx("a1", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 2)),
		incomeTx("a2", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 16)),
		incomeTx("a3", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 30)),
		incomeTx("a4", "ACME PAYROLL", "2000.00", incomeDay(2026, 2, 13)),
		incomeTx("b1", "FREELANCE CLIENT", "300.00", incomeDay(2026, 1, 5)),
		incomeTx("b2", "FREELANCE CLIENT", "300.00", incomeDay(2026, 2, 5)),
		incomeTx("b3", "FREELANCE CLIENT", "300.00", incomeDay(2026, 3, 5)),
		incomeTx("c1", "BILT RENT", "-1800.00", incomeDay(2026, 1, 2)),
		incomeTx("c2", "BILT RENT", "-1800.00", incomeDay(2026, 2, 2)),
		incomeTx("c3", "BILT RENT", "-1800.00", incomeDay(2026, 3, 2)),
		incomeTx("d1", "ACME PAYROLL BONUS", "500.00", incomeDay(2026, 1, 10)),
		incomeTx("d2", "ACME PAYROLL BONUS", "500.00", incomeDay(2026, 3, 22)),
		incomeTx("g1", "Zego RENT", "-500.00", incomeDay(2026, 1, 3)),
		incomeTx("g2", "Zego RENT", "-500.00", incomeDay(2026, 2, 3)),
		incomeTx("g3", "Zego RENT", "-500.00", incomeDay(2026, 3, 3)),
	}
}

func cloneIncrHistory(items []types.AnalysisTransaction) []types.AnalysisTransaction {
	out := make([]types.AnalysisTransaction, len(items))
	copy(out, items)
	return out
}

func runIncremental(t *testing.T, judge judgment.Evaluator, input types.AnalysisSnapshot, dirty []store.AnalysisDirtyFact, cached []store.AnalysisPaymentStream, prior []types.AnalysisDetection) analysis.IncrementalPaymentOutcome {
	t.Helper()
	outcome, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, judge, nil, input, dirty, cached, prior)
	if err != nil {
		t.Fatalf("incremental: %v", err)
	}
	return outcome
}

func detectionKey(finding types.AnalysisDetection) string {
	return finding.TransactionID + "\x00" + finding.Kind
}

func assertDetectionsEqual(t *testing.T, want, got []types.AnalysisDetection) {
	t.Helper()
	if len(want) != len(got) {
		t.Fatalf("detection count %d != %d", len(want), len(got))
	}
	indexed := map[string]string{}
	for _, finding := range want {
		raw, _ := json.Marshal(finding)
		key := detectionKey(finding)
		if _, dup := indexed[key]; dup {
			t.Fatalf("duplicate full finding %q", key)
		}
		indexed[key] = string(raw)
	}
	for _, finding := range got {
		raw, _ := json.Marshal(finding)
		wantRaw, ok := indexed[detectionKey(finding)]
		if !ok {
			t.Fatalf("unexpected finding %q", detectionKey(finding))
		}
		if wantRaw != string(raw) {
			t.Fatalf("finding %q differs:\nwant %s\ngot  %s", detectionKey(finding), wantRaw, raw)
		}
	}
}

func sameIncrementalError(err, want error) bool {
	if want == nil {
		return err == nil
	}
	return errors.Is(err, want)
}

func findingsByStreamID(findings []types.AnalysisDetection) map[string][]types.AnalysisDetection {
	out := map[string][]types.AnalysisDetection{}
	for _, finding := range findings {
		out[finding.StreamID] = append(out[finding.StreamID], finding)
	}
	return out
}

func marshalStreamFindings(findings []types.AnalysisDetection) string {
	raw, _ := json.Marshal(findings)
	return string(raw)
}

// changedIncrStreams returns the stream IDs whose finding bytes differ.
func changedIncrStreams(t *testing.T, before, after []types.AnalysisDetection) []string {
	t.Helper()
	var changed []string
	bm, am := findingsByStreamID(before), findingsByStreamID(after)
	for streamID, want := range bm {
		if marshalStreamFindings(want) != marshalStreamFindings(am[streamID]) {
			changed = append(changed, streamID)
		}
	}
	for streamID := range am {
		if _, ok := bm[streamID]; !ok {
			changed = append(changed, streamID)
		}
	}
	return changed
}

func seedIncrHistory(t *testing.T) ([]store.AnalysisPaymentStream, []types.AnalysisDetection) {
	t.Helper()
	judge := &incrCountingJudge{decide: incrReadyDecision}
	outcome, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, judge, nil,
		types.AnalysisSnapshot{UserID: "u1", Revision: 1, Transactions: incrHistory()}, nil, nil, nil)
	if err != nil || !outcome.FullRebuild || len(outcome.Findings) != 15 {
		t.Fatalf("seed=%+v err=%v", outcome.Findings, err)
	}
	return outcome.UpdatedStreams, outcome.Findings
}

func TestIncrementalMatchesFullRecompute(t *testing.T) {
	for _, tc := range []struct {
		name   string
		decide func(types.AnalysisJudgmentInput) types.AnalysisJudgment
		want   error
	}{
		{"ready", incrReadyDecision, nil},
		{"pending", incrPendingDecision, judgment.ErrPending},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := types.AnalysisSnapshot{UserID: "u1", Revision: 1, Transactions: incrHistory()}
			fullJudge := &incrCountingJudge{decide: tc.decide}
			full, fullErr := (analysis.PaymentPatterns{Judge: fullJudge}).Analyze(context.Background(), input)
			if !sameIncrementalError(fullErr, tc.want) {
				t.Fatalf("full err = %v, want %v", fullErr, tc.want)
			}
			rebuildJudge := &incrCountingJudge{decide: tc.decide}
			rebuilt, rebuildErr := analysis.AnalyzeIncrementalPayments(context.Background(), nil, rebuildJudge, nil, input, nil, nil, nil)
			if !rebuilt.FullRebuild {
				t.Fatal("empty cache should take the full rebuild path")
			}
			assertDetectionsEqual(t, full, rebuilt.Findings)
			if !sameIncrementalError(rebuildErr, tc.want) {
				t.Fatalf("rebuild err = %v, want %v", rebuildErr, tc.want)
			}
			warmJudge := &incrCountingJudge{decide: tc.decide}
			warm, warmErr := analysis.AnalyzeIncrementalPayments(context.Background(), nil, warmJudge, nil, input, nil, rebuilt.UpdatedStreams, rebuilt.Findings)
			assertDetectionsEqual(t, full, warm.Findings)
			if !sameIncrementalError(warmErr, tc.want) {
				t.Fatalf("warm err = %v, want %v", warmErr, tc.want)
			}
			if tc.want == nil && (warmJudge.calls != 0 || len(warm.RecomputedStreamIDs) != 0) {
				t.Fatalf("warm ready pass should judge nothing: calls=%d recomputed=%v", warmJudge.calls, warm.RecomputedStreamIDs)
			}
		})
	}
}

func TestIncrementalChurnTouchesOnlyExpectedStreams(t *testing.T) {
	cached, prior := seedIncrHistory(t)
	fullAt := func(items []types.AnalysisTransaction) []types.AnalysisDetection {
		t.Helper()
		full, err := (analysis.PaymentPatterns{Judge: &incrCountingJudge{decide: incrReadyDecision}}).Analyze(
			context.Background(), types.AnalysisSnapshot{UserID: "u1", Revision: 2, Transactions: items})
		if err != nil {
			t.Fatalf("full: %v", err)
		}
		return full
	}
	check := func(name string, items []types.AnalysisTransaction, dirty []store.AnalysisDirtyFact) analysis.IncrementalPaymentOutcome {
		t.Helper()
		judge := &incrCountingJudge{decide: incrReadyDecision}
		outcome, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, judge, nil,
			types.AnalysisSnapshot{UserID: "u1", Revision: 2, Transactions: items}, dirty, cached, prior)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(outcome.RecomputedStreamIDs) != 1 {
			t.Fatalf("%s recomputed %v, want exactly one stream", name, outcome.RecomputedStreamIDs)
		}
		changed := changedIncrStreams(t, prior, outcome.Findings)
		if len(changed) != 1 || changed[0] != outcome.RecomputedStreamIDs[0] {
			t.Fatalf("%s changed %v, recomputed %v", name, changed, outcome.RecomputedStreamIDs)
		}
		for _, finding := range outcome.Findings {
			if finding.StreamID == changed[0] {
				continue
			}
			found := false
			for _, old := range prior {
				if detectionKey(old) == detectionKey(finding) {
					oldRaw, _ := json.Marshal(old)
					newRaw, _ := json.Marshal(finding)
					if string(oldRaw) != string(newRaw) {
						t.Fatalf("%s touched %q", name, detectionKey(finding))
					}
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("%s invented %q", name, detectionKey(finding))
			}
		}
		assertDetectionsEqual(t, fullAt(items), outcome.Findings)
		return outcome
	}
	t.Run("add", func(t *testing.T) {
		items := append(cloneIncrHistory(incrHistory()), incomeTx("a5", "ACME PAYROLL", "2000.00", incomeDay(2026, 2, 27)))
		dirty := []store.AnalysisDirtyFact{{TransactionID: "a5", Revision: 2, Kind: "added"}}
		judge := &incrCountingJudge{decide: incrReadyDecision}
		outcome, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, judge, nil,
			types.AnalysisSnapshot{UserID: "u1", Revision: 2, Transactions: items}, dirty, cached, prior)
		if err != nil {
			t.Fatal(err)
		}
		if len(outcome.RecomputedStreamIDs) != 1 || len(changedIncrStreams(t, prior, outcome.Findings)) != 1 {
			t.Fatalf("recomputed=%v", outcome.RecomputedStreamIDs)
		}
		if got := len(findingsByStreamID(outcome.Findings)[outcome.RecomputedStreamIDs[0]]); got != 5 {
			t.Fatalf("payroll findings = %d, want 5", got)
		}
		assertDetectionsEqual(t, fullAt(items), outcome.Findings)
	})
	t.Run("void", func(t *testing.T) {
		items := cloneIncrHistory(incrHistory())
		for i := range items {
			if items[i].TransactionID == "a2" {
				items[i].Void = true
			}
		}
		dirty := []store.AnalysisDirtyFact{{TransactionID: "a2", Revision: 2, Kind: "void-flipped"}}
		judge := &incrCountingJudge{decide: incrReadyDecision}
		outcome, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, judge, nil,
			types.AnalysisSnapshot{UserID: "u1", Revision: 2, Transactions: items}, dirty, cached, prior)
		if err != nil {
			t.Fatal(err)
		}
		if len(outcome.RecomputedStreamIDs) != 1 {
			t.Fatalf("recomputed=%v", outcome.RecomputedStreamIDs)
		}
		if got := len(findingsByStreamID(outcome.Findings)[outcome.RecomputedStreamIDs[0]]); got != 3 {
			t.Fatalf("payroll findings = %d, want 3", got)
		}
		if changed := changedIncrStreams(t, prior, outcome.Findings); len(changed) != 1 {
			t.Fatalf("changed=%v", changed)
		}
		assertDetectionsEqual(t, fullAt(items), outcome.Findings)
	})
	t.Run("amount", func(t *testing.T) {
		items := cloneIncrHistory(incrHistory())
		for i := range items {
			if items[i].TransactionID == "b1" {
				items[i].Facts.Amount = "310.00"
			}
		}
		dirty := []store.AnalysisDirtyFact{{TransactionID: "b1", Revision: 2, Kind: "amount-corrected"}}
		outcome := check("amount", items, dirty)
		if got := len(findingsByStreamID(outcome.Findings)[outcome.RecomputedStreamIDs[0]]); got != 3 {
			t.Fatalf("side findings = %d, want 3", got)
		}
	})
	t.Run("delete", func(t *testing.T) {
		var items []types.AnalysisTransaction
		for _, item := range incrHistory() {
			if item.TransactionID != "c1" {
				items = append(items, item)
			}
		}
		dirty := []store.AnalysisDirtyFact{{TransactionID: "c1", Revision: 2, Kind: "deleted"}}
		judge := &incrCountingJudge{decide: incrReadyDecision}
		outcome, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, judge, nil,
			types.AnalysisSnapshot{UserID: "u1", Revision: 2, Transactions: items}, dirty, cached, prior)
		if err != nil {
			t.Fatal(err)
		}
		if len(outcome.RecomputedStreamIDs) != 1 {
			t.Fatalf("recomputed=%v", outcome.RecomputedStreamIDs)
		}
		if got := len(findingsByStreamID(outcome.Findings)[outcome.RecomputedStreamIDs[0]]); got != 2 {
			t.Fatalf("rent findings = %d, want 2", got)
		}
		if changed := changedIncrStreams(t, prior, outcome.Findings); len(changed) != 1 {
			t.Fatalf("changed=%v", changed)
		}
		assertDetectionsEqual(t, fullAt(items), outcome.Findings)
	})
}

func TestIncrementalIdentityMismatchRebuildsCache(t *testing.T) {
	cached, prior := seedIncrHistory(t)
	for i := range cached {
		cached[i].IdentityVersion = 0
		cached[i].StatsJSON = `{"stale":true}`
	}
	outcome, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, &incrCountingJudge{decide: incrReadyDecision}, nil,
		types.AnalysisSnapshot{UserID: "u1", Revision: 2, Transactions: incrHistory()}, nil, cached, prior)
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.FullRebuild || len(outcome.UpdatedStreams) != len(cached) {
		t.Fatalf("rebuild=%v updated=%d", outcome.FullRebuild, len(outcome.UpdatedStreams))
	}
	for _, entry := range outcome.UpdatedStreams {
		if entry.IdentityVersion != analysis.PaymentStreamIdentityVersion {
			t.Fatalf("stale identity kept: %+v", entry)
		}
	}
	full, err := (analysis.PaymentPatterns{Judge: &incrCountingJudge{decide: incrReadyDecision}}).Analyze(
		context.Background(), types.AnalysisSnapshot{UserID: "u1", Revision: 2, Transactions: incrHistory()})
	if err != nil {
		t.Fatal(err)
	}
	assertDetectionsEqual(t, full, outcome.Findings)
}

func requestIDsByTx(findings []types.AnalysisDetection) map[string]string {
	out := map[string]string{}
	for _, finding := range findings {
		if finding.JudgmentInput == nil {
			continue
		}
		out[finding.TransactionID] = finding.JudgmentInput.ID
	}
	return out
}

func TestIncrementalJudgesChangedStreamsOnly(t *testing.T) {
	cached, prior := seedIncrHistory(t)
	judge := &incrCountingJudge{decide: incrReadyDecision}
	items := append(cloneIncrHistory(incrHistory()), incomeTx("a5", "ACME PAYROLL", "2000.00", incomeDay(2026, 2, 27)))
	outcome, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, judge, nil,
		types.AnalysisSnapshot{UserID: "u1", Revision: 2, Transactions: items},
		[]store.AnalysisDirtyFact{{TransactionID: "a5", Revision: 2, Kind: "added"}}, cached, prior)
	if err != nil {
		t.Fatal(err)
	}
	if judge.calls != 1 || judge.requests != 1 {
		t.Fatalf("provider calls=%d requests=%d, want 1 and 1", judge.calls, judge.requests)
	}
	members := map[string]bool{}
	for _, entry := range outcome.UpdatedStreams {
		for _, id := range entry.MemberTransactionIDs {
			members[id] = true
		}
	}
	before, after := requestIDsByTx(prior), requestIDsByTx(outcome.Findings)
	for tx, id := range before {
		if members[tx] {
			continue
		}
		if after[tx] != id {
			t.Fatalf("untouched %s re-judged", tx)
		}
	}
}

// applyOutcomeToCache mirrors publish cache semantics: upsert recomputed
// entries, drop vanished ones, and advance every consumed revision.
func applyOutcomeToCache(cached []store.AnalysisPaymentStream, outcome analysis.IncrementalPaymentOutcome, revision int64) []store.AnalysisPaymentStream {
	byID := map[string]store.AnalysisPaymentStream{}
	for _, entry := range cached {
		byID[entry.StreamID] = entry
	}
	for _, id := range outcome.DeletedStreamIDs {
		delete(byID, id)
	}
	for _, entry := range outcome.UpdatedStreams {
		byID[entry.StreamID] = entry
	}
	out := make([]store.AnalysisPaymentStream, 0, len(byID))
	for _, entry := range byID {
		entry.ConsumedRevision = revision
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StreamID < out[j].StreamID })
	return out
}

func incrIsMain(finding types.AnalysisDetection) bool {
	return len(finding.Evidence) > 0 && finding.Evidence[0].Code == finding.Kind+".main-inflow:annualized"
}

func rankHistory() []types.AnalysisTransaction {
	return []types.AnalysisTransaction{
		incomeTx("a1", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 2)),
		incomeTx("a2", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 16)),
		incomeTx("a3", "ACME PAYROLL", "2000.00", incomeDay(2026, 1, 30)),
		incomeTx("a4", "ACME PAYROLL", "2000.00", incomeDay(2026, 2, 13)),
		incomeTx("b1", "FREELANCE CLIENT", "300.00", incomeDay(2026, 1, 5)),
		incomeTx("b2", "FREELANCE CLIENT", "300.00", incomeDay(2026, 2, 5)),
		incomeTx("b3", "FREELANCE CLIENT", "300.00", incomeDay(2026, 3, 5)),
		incomeTx("d1", "ACME PAYROLL BONUS", "500.00", incomeDay(2026, 1, 10)),
		incomeTx("d2", "ACME PAYROLL BONUS", "500.00", incomeDay(2026, 3, 22)),
	}
}

func seedRankHistory(t *testing.T) ([]store.AnalysisPaymentStream, []types.AnalysisDetection) {
	t.Helper()
	judge := &incrCountingJudge{decide: incrReadyDecision}
	outcome, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, judge, nil,
		types.AnalysisSnapshot{UserID: "u1", Revision: 1, Transactions: rankHistory()}, nil, nil, nil)
	if err != nil || len(outcome.Findings) != 9 {
		t.Fatalf("seed=%+v err=%v", outcome.Findings, err)
	}
	mains := 0
	for _, finding := range outcome.Findings {
		if finding.Provider == "acme" && finding.Product == "biweekly" && !incrIsMain(finding) {
			t.Fatal("payroll should start as main inflow")
		}
		if incrIsMain(finding) {
			mains++
		}
	}
	if mains != 4 {
		t.Fatalf("main findings = %d, want 4", mains)
	}
	return outcome.UpdatedStreams, outcome.Findings
}

func setRankAmounts(items []types.AnalysisTransaction, amount, currency string) []types.AnalysisTransaction {
	out := cloneIncrHistory(items)
	for i := range out {
		if strings.HasPrefix(out[i].TransactionID, "b") {
			out[i].Facts.Amount = amount
			out[i].Facts.Currency = currency
		}
	}
	return out
}

func TestIncrementalRankTransitions(t *testing.T) {
	cached, prior := seedRankHistory(t)
	fullAt := func(items []types.AnalysisTransaction, revision int64) []types.AnalysisDetection {
		t.Helper()
		full, err := (analysis.PaymentPatterns{Judge: &incrCountingJudge{decide: incrReadyDecision}}).Analyze(
			context.Background(), types.AnalysisSnapshot{UserID: "u1", Revision: revision, Transactions: items})
		if err != nil {
			t.Fatalf("full: %v", err)
		}
		return full
	}
	runChurn := func(items []types.AnalysisTransaction, revision int64, dirty []store.AnalysisDirtyFact, cached []store.AnalysisPaymentStream, prior []types.AnalysisDetection) analysis.IncrementalPaymentOutcome {
		t.Helper()
		outcome, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, &incrCountingJudge{decide: incrReadyDecision}, nil,
			types.AnalysisSnapshot{UserID: "u1", Revision: revision, Transactions: items}, dirty, cached, prior)
		if err != nil {
			t.Fatal(err)
		}
		assertDetectionsEqual(t, fullAt(items, revision), outcome.Findings)
		return outcome
	}
	mainProviders := func(findings []types.AnalysisDetection) map[string]bool {
		out := map[string]bool{}
		for _, finding := range findings {
			if incrIsMain(finding) {
				out[finding.Provider] = true
			}
		}
		return out
	}
	mustCarryBonus := func(before, after []types.AnalysisDetection) {
		t.Helper()
		for streamID, want := range findingsByStreamID(before) {
			if len(want) == 0 || want[0].Product != "" || want[0].Provider != "acme" {
				continue
			}
			if marshalStreamFindings(want) != marshalStreamFindings(findingsByStreamID(after)[streamID]) {
				t.Fatal("no-cadence stream was not carried forward byte-identical")
			}
			return
		}
		t.Fatal("no-cadence stream missing")
	}
	// Promote the side stream above payroll.
	upItems := setRankAmounts(rankHistory(), "10000.00", "USD")
	var upDirty []store.AnalysisDirtyFact
	for _, id := range []string{"b1", "b2", "b3"} {
		upDirty = append(upDirty, store.AnalysisDirtyFact{TransactionID: id, Revision: 2, Kind: "amount-corrected"})
	}
	up := runChurn(upItems, 2, upDirty, cached, prior)
	if mains := mainProviders(up.Findings); len(mains) != 1 || !mains["freelance"] {
		t.Fatalf("mains=%v, want freelance only", mains)
	}
	for _, finding := range up.Findings {
		if incrIsMain(finding) && !strings.Contains(finding.Evidence[0].Reason, "main consistent inflow") {
			t.Fatalf("main sentence missing: %q", finding.Evidence[0].Reason)
		}
		if !incrIsMain(finding) && finding.Product != "" && strings.Contains(finding.Evidence[0].Reason, "main consistent inflow") {
			t.Fatalf("stale main sentence: %q", finding.Evidence[0].Reason)
		}
	}
	mustCarryBonus(prior, up.Findings)
	// Demote back by restoring the side amounts.
	var downDirty []store.AnalysisDirtyFact
	for _, id := range []string{"b1", "b2", "b3"} {
		downDirty = append(downDirty, store.AnalysisDirtyFact{TransactionID: id, Revision: 3, Kind: "amount-corrected"})
	}
	down := runChurn(rankHistory(), 3, downDirty, applyOutcomeToCache(cached, up, 2), up.Findings)
	if mains := mainProviders(down.Findings); len(mains) != 1 || !mains["acme"] {
		t.Fatalf("mains=%v, want acme only", mains)
	}
	mustCarryBonus(up.Findings, down.Findings)
	// Move the side stream to EUR: the income group turns incomparable, so
	// the mark withholds everywhere even though the EUR stream annualizes
	// higher.
	eurItems := setRankAmounts(rankHistory(), "10000.00", "EUR")
	var eurDirty []store.AnalysisDirtyFact
	for _, id := range []string{"b1", "b2", "b3"} {
		eurDirty = append(eurDirty, store.AnalysisDirtyFact{TransactionID: id, Revision: 4, Kind: "facts-changed"})
	}
	eur := runChurn(eurItems, 4, eurDirty, applyOutcomeToCache(applyOutcomeToCache(cached, up, 2), down, 3), down.Findings)
	if mains := mainProviders(eur.Findings); len(mains) != 0 {
		t.Fatalf("mains=%v, want none across currencies", mains)
	}
	if len(eur.RecomputedStreamIDs) != 2 || len(eur.DeletedStreamIDs) != 1 {
		t.Fatalf("recomputed=%v deleted=%v", eur.RecomputedStreamIDs, eur.DeletedStreamIDs)
	}
	mustCarryBonus(down.Findings, eur.Findings)
}

func transferHistory() []types.AnalysisTransaction {
	return []types.AnalysisTransaction{
		incomeTx("i1", "PAYROLL TRANSFER IN", "500.00", incomeDay(2026, 1, 5)),
		incomeTx("i2", "PAYROLL TRANSFER IN", "500.00", incomeDay(2026, 2, 5)),
		incomeTx("i3", "PAYROLL TRANSFER IN", "500.00", incomeDay(2026, 3, 5)),
	}
}

func transferOutflows() []types.AnalysisTransaction {
	out := []types.AnalysisTransaction{
		incomeTx("o1", "TRANSFER OUT", "-500.00", incomeDay(2026, 1, 6)),
		incomeTx("o2", "TRANSFER OUT", "-500.00", incomeDay(2026, 2, 6)),
		incomeTx("o3", "TRANSFER OUT", "-500.00", incomeDay(2026, 3, 6)),
	}
	for i := range out {
		out[i].AccountID = "other"
	}
	return out
}

func TestIncrementalTransferCouplingRecomputesBothSides(t *testing.T) {
	judge := &incrCountingJudge{decide: incrReadyDecision}
	seed, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, judge, nil,
		types.AnalysisSnapshot{UserID: "u1", Revision: 1, Transactions: transferHistory()}, nil, nil, nil)
	if err != nil || len(seed.Findings) != 3 || !incrIsMain(seed.Findings[0]) {
		t.Fatalf("seed=%+v err=%v", seed.Findings, err)
	}
	paired := append(cloneIncrHistory(transferHistory()), transferOutflows()...)
	var added []store.AnalysisDirtyFact
	for _, id := range []string{"o1", "o2", "o3"} {
		added = append(added, store.AnalysisDirtyFact{TransactionID: id, Revision: 2, Kind: "added"})
	}
	pairedOutcome, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, &incrCountingJudge{decide: incrReadyDecision}, nil,
		types.AnalysisSnapshot{UserID: "u1", Revision: 2, Transactions: paired}, added, seed.UpdatedStreams, seed.Findings)
	if err != nil {
		t.Fatal(err)
	}
	if len(pairedOutcome.Findings) != 0 {
		t.Fatalf("paired inflow should be transfer-excluded: %+v", pairedOutcome.Findings)
	}
	if len(pairedOutcome.RecomputedStreamIDs) != 2 {
		t.Fatalf("recomputed=%v, want both sides of the pair", pairedOutcome.RecomputedStreamIDs)
	}
	fullPaired, err := (analysis.PaymentPatterns{Judge: &incrCountingJudge{decide: incrReadyDecision}}).Analyze(
		context.Background(), types.AnalysisSnapshot{UserID: "u1", Revision: 2, Transactions: paired})
	if err != nil {
		t.Fatal(err)
	}
	assertDetectionsEqual(t, fullPaired, pairedOutcome.Findings)
	pairedCache := applyOutcomeToCache(seed.UpdatedStreams, pairedOutcome, 2)
	// Move one outflow leg onto a different inflow stream: the abandoned
	// inflow keeps no live pair, so only the cached leg still names it. Both
	// sides recompute and the freed occurrence regains a finding.
	soloPaired := []types.AnalysisTransaction{
		incomeTx("p1", "PAYROLL TRANSFER IN", "500.00", incomeDay(2026, 1, 5)),
		incomeTx("q1", "PAYROLL BONUS TRANSFER", "500.00", incomeDay(2026, 2, 5)),
		incomeTx("o1", "TRANSFER OUT", "-500.00", incomeDay(2026, 1, 6)),
		incomeTx("o2", "TRANSFER OUT", "-500.00", incomeDay(2026, 2, 6)),
	}
	for i := range soloPaired {
		if soloPaired[i].TransactionID == "o1" || soloPaired[i].TransactionID == "o2" {
			soloPaired[i].AccountID = "other"
		}
	}
	soloSeed, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, &incrCountingJudge{decide: incrReadyDecision}, nil,
		types.AnalysisSnapshot{UserID: "u1", Revision: 1, Transactions: soloPaired}, nil, nil, nil)
	if err != nil || len(soloSeed.Findings) != 0 || !soloSeed.FullRebuild {
		t.Fatalf("solo seed=%+v err=%v", soloSeed.Findings, err)
	}
	movedItems := cloneIncrHistory(soloPaired)
	for i := range movedItems {
		if movedItems[i].TransactionID == "o1" {
			movedItems[i].Facts.OccurredAt = incomeDay(2026, 2, 5)
			movedItems[i].Facts.PostedTime = incomeDay(2026, 2, 5)
		}
	}
	moved, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, &incrCountingJudge{decide: incrReadyDecision}, nil,
		types.AnalysisSnapshot{UserID: "u1", Revision: 2, Transactions: movedItems},
		[]store.AnalysisDirtyFact{{TransactionID: "o1", Revision: 2, Kind: "facts-changed"}}, soloSeed.UpdatedStreams, soloSeed.Findings)
	if err != nil {
		t.Fatal(err)
	}
	if len(moved.Findings) != 1 || moved.Findings[0].TransactionID != "p1" || moved.Findings[0].Product != "" {
		t.Fatalf("moved=%+v", moved.Findings)
	}
	if len(moved.RecomputedStreamIDs) != 3 {
		t.Fatalf("recomputed=%v, want the moved leg plus both inflow streams", moved.RecomputedStreamIDs)
	}
	fullMoved, err := (analysis.PaymentPatterns{Judge: &incrCountingJudge{decide: incrReadyDecision}}).Analyze(
		context.Background(), types.AnalysisSnapshot{UserID: "u1", Revision: 2, Transactions: movedItems})
	if err != nil {
		t.Fatal(err)
	}
	assertDetectionsEqual(t, fullMoved, moved.Findings)
	// Deleting the outflow legs restores the inflow findings through the
	// tombstone path, which has no current facts to pair with.
	var deleted []store.AnalysisDirtyFact
	for _, id := range []string{"o1", "o2", "o3"} {
		deleted = append(deleted, store.AnalysisDirtyFact{TransactionID: id, Revision: 3, Kind: "deleted"})
	}
	restored, err := analysis.AnalyzeIncrementalPayments(context.Background(), nil, &incrCountingJudge{decide: incrReadyDecision}, nil,
		types.AnalysisSnapshot{UserID: "u1", Revision: 3, Transactions: transferHistory()}, deleted, pairedCache, pairedOutcome.Findings)
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.Findings) != 3 || !incrIsMain(restored.Findings[0]) {
		t.Fatalf("restored=%+v", restored.Findings)
	}
	if len(restored.RecomputedStreamIDs) != 2 || len(restored.DeletedStreamIDs) != 1 {
		t.Fatalf("recomputed=%v deleted=%v", restored.RecomputedStreamIDs, restored.DeletedStreamIDs)
	}
	assertDetectionsEqual(t, seed.Findings, restored.Findings)
}

type incrStubSession struct {
	judge *incrCountingJudge
	rev   string
}

func (s *incrStubSession) Revision() string { return s.rev }

func (s *incrStubSession) Evaluate(ctx context.Context, requests []types.AnalysisJudgmentInput) ([]types.AnalysisJudgment, error) {
	return s.judge.Evaluate(ctx, requests)
}

type incrStubProvider struct {
	session *incrStubSession
	opens   int
}

func (p *incrStubProvider) Open(context.Context, judgment.FeedbackSource) (judgment.Session, error) {
	p.opens++
	return p.session, nil
}

func seedRunnerBank(t *testing.T, scoped store.Store) {
	t.Helper()
	transactions := []simplefin.Transaction{
		{ID: "p0", Description: "ACME PAYROLL", Amount: "2000", Posted: incomeDay(2026, 1, 2)},
		{ID: "p1", Description: "ACME PAYROLL", Amount: "2000", Posted: incomeDay(2026, 2, 2)},
		{ID: "p2", Description: "ACME PAYROLL", Amount: "2000", Posted: incomeDay(2026, 3, 2)},
	}
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "bank", ConnID: "test-conn", Currency: "USD", Balance: "6000", BalanceDate: incomeDay(2026, 3, 2), Transactions: transactions}}}
	translation, err := simplefin.Translate(set, map[string]string{simplefin.AccountKey("test-conn", "bank"): "checking"}, time.Unix(incomeDay(2026, 3, 2), 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{"checking": true})); err != nil {
		t.Fatal(err)
	}
}

func TestIncrementalRunnerEndToEnd(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	scoped, err := database.EnsureUser("owner", "issuer", "owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	seedRunnerBank(t, scoped)
	judge := &incrCountingJudge{decide: incrReadyDecision}
	provider := &incrStubProvider{session: &incrStubSession{judge: judge, rev: "r1"}}
	runner, err := analysis.NewRunner(database, analysis.NewPaymentPatterns(provider))
	if err != nil {
		t.Fatal(err)
	}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	findings, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findings) != 3 {
		t.Fatalf("findings=%+v err=%v", findings, err)
	}
	if provider.opens != 1 || judge.calls != 1 || judge.requests != 1 {
		t.Fatalf("opens=%d calls=%d requests=%d", provider.opens, judge.calls, judge.requests)
	}
	streams, err := scoped.ListAnalysisPaymentStreams()
	if err != nil || len(streams) != 1 {
		t.Fatalf("streams=%+v err=%v", streams, err)
	}
	_, revision, err := scoped.ListAnalysisRuns()
	if err != nil || streams[0].ConsumedRevision != revision {
		t.Fatalf("consumed=%d revision=%d err=%v", streams[0].ConsumedRevision, revision, err)
	}
	rows, err := scoped.LoadBankTransactions()
	if err != nil || len(rows) != 3 {
		t.Fatal(rows)
	}
	if err := scoped.DeleteTransaction(rows[2].Transaction.ID); err != nil {
		t.Fatal(err)
	}
	judge.calls, judge.requests = 0, 0
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	findings, err = scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findings) != 2 {
		t.Fatalf("after delete findings=%+v err=%v", findings, err)
	}
	active := 0
	for _, finding := range findings {
		if finding.Status == "active" {
			active++
		}
	}
	if active != 2 {
		t.Fatalf("active=%d", active)
	}
	if judge.calls != 1 || judge.requests != 1 {
		t.Fatalf("churn calls=%d requests=%d, want 1 and 1", judge.calls, judge.requests)
	}
	streams, err = scoped.ListAnalysisPaymentStreams()
	if err != nil || len(streams) != 1 {
		t.Fatalf("streams=%+v err=%v", streams, err)
	}
	if provider.opens != 2 {
		t.Fatalf("opens=%d, want 2", provider.opens)
	}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	// The idle run claims nothing, so the provider never judges again.
	// (Prepare still opens a session before the claim check.)
	if judge.calls != 1 {
		t.Fatalf("idle run should not analyze: calls=%d", judge.calls)
	}
}

type findingsCountingStore struct {
	store.Store
	findings int
}

func (s *findingsCountingStore) ListAnalysisFindings(filter types.AnalysisFindingFilter) ([]types.AnalysisFinding, error) {
	s.findings++
	return s.Store.ListAnalysisFindings(filter)
}

type findingsCountingDatabase struct {
	user store.Store
}

func (d *findingsCountingDatabase) ListAnalysisUsers() ([]string, error) {
	return []string{"owner"}, nil
}

func (d *findingsCountingDatabase) User(string) (store.Store, error) {
	return d.user, nil
}

func TestIncrementalPrepareSkipsPriorLoadOnIdleTick(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	scoped, err := database.EnsureUser("owner", "issuer", "owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	seedRunnerBank(t, scoped)
	judge := &incrCountingJudge{decide: incrReadyDecision}
	provider := &incrStubProvider{session: &incrStubSession{judge: judge, rev: "r1"}}
	counting := &findingsCountingStore{Store: scoped}
	runner, err := analysis.NewRunner(&findingsCountingDatabase{user: counting}, analysis.NewPaymentPatterns(provider))
	if err != nil {
		t.Fatal(err)
	}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	findings, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findings) != 3 {
		t.Fatalf("findings=%+v err=%v", findings, err)
	}
	counting.findings = 0
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if counting.findings != 0 {
		t.Fatalf("idle tick paginated findings %d times", counting.findings)
	}
	if judge.calls != 1 {
		t.Fatalf("idle tick judged %d times", judge.calls)
	}
	rows, err := scoped.LoadBankTransactions()
	if err != nil || len(rows) != 3 {
		t.Fatal(rows)
	}
	if err := scoped.DeleteTransaction(rows[0].Transaction.ID); err != nil {
		t.Fatal(err)
	}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if counting.findings == 0 {
		t.Fatal("changed tick skipped the prior load")
	}
}

func upgradeBankSeed() []simplefin.Transaction {
	return []simplefin.Transaction{
		{ID: "p1", Description: "ACME PAYROLL", Amount: "2000", Posted: incomeDay(2026, 1, 2)},
		{ID: "p2", Description: "ACME PAYROLL", Amount: "2000", Posted: incomeDay(2026, 2, 2)},
		{ID: "p3", Description: "ACME PAYROLL", Amount: "2000", Posted: incomeDay(2026, 3, 2)},
		{ID: "u1", Description: "PACIFIC ELECTRIC", Amount: "-120", Posted: incomeDay(2026, 1, 5)},
		{ID: "u2", Description: "PACIFIC ELECTRIC", Amount: "-120", Posted: incomeDay(2026, 2, 5)},
		{ID: "u3", Description: "PACIFIC ELECTRIC", Amount: "-120", Posted: incomeDay(2026, 3, 5)},
	}
}

func applyUpgradeBank(t *testing.T, scoped store.Store, transactions []simplefin.Transaction, observed int64) {
	t.Helper()
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "bank", ConnID: "test-conn", Currency: "USD", Balance: "6000", BalanceDate: observed, Transactions: transactions}}}
	translation, err := simplefin.Translate(set, map[string]string{simplefin.AccountKey("test-conn", "bank"): "checking"}, time.Unix(observed, 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{"checking": true})); err != nil {
		t.Fatal(err)
	}
}

func activePaymentFindings(t *testing.T, scoped store.Store) []types.AnalysisFinding {
	t.Helper()
	findings, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil {
		t.Fatal(err)
	}
	var out []types.AnalysisFinding
	for _, item := range findings {
		if item.AnalysisType == "payments" && item.Status == "active" {
			out = append(out, item)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].TransactionID != out[j].TransactionID {
			return out[i].TransactionID < out[j].TransactionID
		}
		return out[i].Kind < out[j].Kind
	})
	return out
}

func countActiveKind(findings []types.AnalysisFinding, kind string) int {
	count := 0
	for _, item := range findings {
		if item.Kind == kind {
			count++
		}
	}
	return count
}

// TestIncrementalUpgradeRebuildsNewKinds replays the registry-upgrade gap: a
// new classification ships while an idle owner's cache is stale from
// unrelated churn, so the dirty-only update would never evaluate the new kind
// on untouched streams. A recorded analyzer-version change forces one full
// rebuild; later ticks return to the incremental path with no rebuild loop.
func TestIncrementalUpgradeRebuildsNewKinds(t *testing.T) {
	database, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	scoped, err := database.EnsureUser("owner", "issuer", "owner")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	seeded := upgradeBankSeed()
	applyUpgradeBank(t, scoped, seeded, incomeDay(2026, 3, 5))
	judge := &incrCountingJudge{decide: incrReadyDecision}
	provider := &incrStubProvider{session: &incrStubSession{judge: judge, rev: "r1"}}
	runner, err := analysis.NewRunner(database, analysis.NewPaymentPatterns(provider))
	if err != nil {
		t.Fatal(err)
	}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if active := activePaymentFindings(t, scoped); countActiveKind(active, "income") != 3 || countActiveKind(active, "utility") != 3 {
		t.Fatalf("seed findings=%+v", active)
	}
	// Simulate the pre-upgrade world: the last completed run predates the new
	// registry and carries no utility findings, while the stream cache stays.
	run, _, claimed, err := scoped.ClaimAnalysis("payments", "payments-v0/simulated-pre-upgrade")
	if err != nil || !claimed {
		t.Fatalf("claim=%v claimed=%v err=%v", run, claimed, err)
	}
	if err := scoped.CompleteAnalysis(run, nil, ""); err != nil {
		t.Fatal(err)
	}
	if active := activePaymentFindings(t, scoped); len(active) != 0 {
		t.Fatalf("simulated old world kept findings: %+v", active)
	}
	// Unrelated churn touches only the payroll stream; the utility stream is
	// idle, so only a version-forced rebuild restores its findings.
	seeded = append(cloneSimplefinTransactions(seeded), simplefin.Transaction{ID: "p4", Description: "ACME PAYROLL", Amount: "2000", Posted: incomeDay(2026, 4, 2)})
	applyUpgradeBank(t, scoped, seeded, incomeDay(2026, 4, 2))
	judge.calls, judge.requests = 0, 0
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	active := activePaymentFindings(t, scoped)
	if countActiveKind(active, "income") != 4 || countActiveKind(active, "utility") != 3 {
		t.Fatalf("upgrade did not rebuild idle streams: %+v", active)
	}
	if judge.calls != 1 || judge.requests != 2 {
		t.Fatalf("upgrade did not take the rebuild path: calls=%d requests=%d", judge.calls, judge.requests)
	}
	afterUpgrade, _ := json.Marshal(active)
	// An idle tick claims nothing and judges nothing: the rebuild loop ends.
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if judge.calls != 1 {
		t.Fatalf("idle tick re-analyzed: calls=%d", judge.calls)
	}
	idle, _ := json.Marshal(activePaymentFindings(t, scoped))
	if string(idle) != string(afterUpgrade) {
		t.Fatal("idle tick rewrote findings")
	}
	// Later churn returns to the dirty-only path: only the touched payroll
	// stream re-judges while the idle utility stream carries forward.
	seeded = append(cloneSimplefinTransactions(seeded), simplefin.Transaction{ID: "p5", Description: "ACME PAYROLL", Amount: "2000", Posted: incomeDay(2026, 5, 2)})
	applyUpgradeBank(t, scoped, seeded, incomeDay(2026, 5, 2))
	judge.calls, judge.requests = 0, 0
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if judge.calls != 1 || judge.requests != 1 {
		t.Fatalf("churn did not take the incremental path: calls=%d requests=%d", judge.calls, judge.requests)
	}
	churned := activePaymentFindings(t, scoped)
	if countActiveKind(churned, "income") != 5 || countActiveKind(churned, "utility") != 3 {
		t.Fatalf("churn findings=%+v", churned)
	}
	var beforeUtility, afterUtility []types.AnalysisDetection
	for _, item := range active {
		if item.Kind == "utility" {
			beforeUtility = append(beforeUtility, item.AnalysisDetection)
		}
	}
	for _, item := range churned {
		if item.Kind == "utility" {
			afterUtility = append(afterUtility, item.AnalysisDetection)
		}
	}
	beforeRaw, _ := json.Marshal(beforeUtility)
	afterRaw, _ := json.Marshal(afterUtility)
	if string(beforeRaw) != string(afterRaw) {
		t.Fatal("utility stream was not carried forward byte-identical")
	}
}

func cloneSimplefinTransactions(items []simplefin.Transaction) []simplefin.Transaction {
	out := make([]simplefin.Transaction, len(items))
	copy(out, items)
	return out
}
