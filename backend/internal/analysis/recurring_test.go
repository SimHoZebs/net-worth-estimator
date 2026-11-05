package analysis_test

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/analysis"
	"github.com/simhozebs/net-worth-estimator/backend/internal/simplefin"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func recurringTx(id, description, amount string, stamp int64) types.AnalysisTransaction {
	return types.AnalysisTransaction{PostingID: id, AccountID: "bank", SourceProvider: "simplefin", Facts: types.TransactionFacts{Description: description, Amount: amount, Currency: "USD", PostedTime: stamp, OccurredAt: stamp, Metadata: map[string]string{}}}
}

func recurringDay(year int, month time.Month, day int) int64 {
	return time.Date(year, month, day, 12, 0, 0, 0, time.UTC).Unix()
}

func analyzeRecurring(t *testing.T, items []types.AnalysisTransaction) []types.AnalysisDetection {
	t.Helper()
	result, err := (analysis.Recurring{}).Analyze(context.Background(), types.AnalysisSnapshot{Transactions: items})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestRecurringCadences(t *testing.T) {
	cases := []struct {
		name, cadence string
		stamps        []int64
		want          int
	}{
		{"weekly", "weekly", []int64{recurringDay(2026, 1, 5), recurringDay(2026, 1, 12), recurringDay(2026, 1, 19)}, 3},
		{"biweekly", "biweekly", []int64{recurringDay(2026, 1, 5), recurringDay(2026, 1, 19), recurringDay(2026, 2, 2)}, 3},
		{"monthly", "monthly", []int64{recurringDay(2026, 1, 5), recurringDay(2026, 2, 5), recurringDay(2026, 3, 5)}, 3},
		{"quarterly", "quarterly", []int64{recurringDay(2026, 1, 10), recurringDay(2026, 4, 10), recurringDay(2026, 7, 10)}, 3},
		{"annual", "annual", []int64{recurringDay(2025, 3, 1), recurringDay(2026, 3, 1)}, 2},
		{"two biweekly is not a pattern", "", []int64{recurringDay(2026, 1, 5), recurringDay(2026, 1, 19)}, 0},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			items := make([]types.AnalysisTransaction, 0, len(test.stamps))
			for i, stamp := range test.stamps {
				items = append(items, recurringTx(string(rune('a'+i)), "NETFLIX", "-15.99", stamp))
			}
			result := analyzeRecurring(t, items)
			if len(result) != test.want {
				t.Fatalf("got %d want %d: %+v", len(result), test.want, result)
			}
			for _, item := range result {
				if item.Kind != "recurring" || item.Product != test.cadence || item.Strength != "moderate" || item.Provider != "netflix" || item.Role != "outflow" {
					t.Fatalf("detection=%+v", item)
				}
				if len(item.Evidence) != 1 || item.Evidence[0].Code != "recurring.cadence" || len(item.Evidence[0].PostingIDs) != test.want {
					t.Fatalf("evidence=%+v", item.Evidence)
				}
				if !strings.Contains(item.Evidence[0].Reason, test.cadence) || !strings.Contains(item.Evidence[0].Reason, "15.99") {
					t.Fatalf("reason=%q", item.Evidence[0].Reason)
				}
			}
		})
	}
}

func TestRecurringEvidenceShowsOccurrencesCadenceAndAmount(t *testing.T) {
	items := []types.AnalysisTransaction{
		recurringTx("a", "ACME PAYROLL", "2000.00", recurringDay(2026, 1, 2)),
		recurringTx("b", "ACME PAYROLL DEPT", "2000.00", recurringDay(2026, 1, 16)),
		recurringTx("c", "ACME PAYROLL", "2000.00", recurringDay(2026, 1, 30)),
	}
	result := analyzeRecurring(t, items)
	if len(result) != 3 {
		t.Fatalf("result=%+v", result)
	}
	for _, item := range result {
		if item.Role != "inflow" || item.Product != "biweekly" || item.Provider != "acme" {
			t.Fatalf("deposit=%+v", item)
		}
		reason := item.Evidence[0].Reason
		if !strings.Contains(reason, "3 transactions") || !strings.Contains(reason, "biweekly") || !strings.Contains(reason, "2000.00") {
			t.Fatalf("reason=%q", reason)
		}
	}
}

func TestRecurringMerchantVariantsShareOnePattern(t *testing.T) {
	stamps := []int64{recurringDay(2026, 1, 5), recurringDay(2026, 2, 5), recurringDay(2026, 3, 5)}
	items := []types.AnalysisTransaction{
		recurringTx("a", "NETFLIX.COM 866-579-7172", "-15.99", stamps[0]),
		recurringTx("b", "Netflix", "-15.99", stamps[1]),
		recurringTx("c", "NETFLIX.COM", "-16.50", stamps[2]),
	}
	result := analyzeRecurring(t, items)
	if len(result) != 3 || result[0].Evidence[0].PostingIDs[0] != "a" {
		t.Fatalf("variants=%+v", result)
	}
	distinct := []types.AnalysisTransaction{
		recurringTx("a", "NETFLIX", "-15.99", stamps[0]),
		recurringTx("b", "SPOTIFY", "-15.99", stamps[1]),
		recurringTx("c", "HULU", "-15.99", stamps[2]),
	}
	if result := analyzeRecurring(t, distinct); len(result) != 0 {
		t.Fatalf("distinct merchants=%+v", result)
	}
}

func TestRecurringToleratesSmallChangesRejectsIrregularTiming(t *testing.T) {
	// Slightly uneven monthly gaps stay one pattern.
	steady := []types.AnalysisTransaction{
		recurringTx("a", "CONED", "-80.00", recurringDay(2026, 1, 9)),
		recurringTx("b", "CONED", "-84.00", recurringDay(2026, 2, 7)),
		recurringTx("c", "CONED", "-78.00", recurringDay(2026, 3, 9)),
	}
	if result := analyzeRecurring(t, steady); len(result) != 3 {
		t.Fatalf("steady=%+v", result)
	}
	// One far-off gap is irregular timing, not a pattern.
	ragged := []types.AnalysisTransaction{
		recurringTx("a", "CONED", "-80.00", recurringDay(2026, 1, 9)),
		recurringTx("b", "CONED", "-80.00", recurringDay(2026, 2, 8)),
		recurringTx("c", "CONED", "-80.00", recurringDay(2026, 3, 10)),
		recurringTx("d", "CONED", "-80.00", recurringDay(2026, 5, 24)),
	}
	if result := analyzeRecurring(t, ragged); len(result) != 0 {
		t.Fatalf("ragged=%+v", result)
	}
	// An outlier amount leaves too few occurrences behind.
	amounts := []types.AnalysisTransaction{
		recurringTx("a", "CONED", "-25.00", recurringDay(2026, 1, 9)),
		recurringTx("b", "CONED", "-25.00", recurringDay(2026, 2, 8)),
		recurringTx("c", "CONED", "-50.00", recurringDay(2026, 3, 10)),
	}
	if result := analyzeRecurring(t, amounts); len(result) != 0 {
		t.Fatalf("amounts=%+v", result)
	}
}

func TestRecurringSkipsNonEvidence(t *testing.T) {
	stamps := []int64{recurringDay(2026, 1, 5), recurringDay(2026, 2, 5), recurringDay(2026, 3, 5)}
	base := func() []types.AnalysisTransaction {
		return []types.AnalysisTransaction{
			recurringTx("a", "NETFLIX", "-15.99", stamps[0]),
			recurringTx("b", "NETFLIX", "-15.99", stamps[1]),
			recurringTx("c", "NETFLIX", "-15.99", stamps[2]),
		}
	}
	check := func(name string, mutate func([]types.AnalysisTransaction)) {
		t.Helper()
		items := base()
		mutate(items)
		if result := analyzeRecurring(t, items); len(result) != 0 {
			t.Fatalf("%s=%+v", name, result)
		}
	}
	check("pending", func(items []types.AnalysisTransaction) { items[2].Pending = true })
	check("void", func(items []types.AnalysisTransaction) { items[2].Void = true })
	check("account", func(items []types.AnalysisTransaction) { items[2].AccountID = "other" })
	check("provider", func(items []types.AnalysisTransaction) { items[2].SourceProvider = "other" })
	check("currency", func(items []types.AnalysisTransaction) { items[2].Facts.Currency = "EUR" })
	check("direction", func(items []types.AnalysisTransaction) { items[2].Facts.Amount = "15.99" })
	check("no merchant key", func(items []types.AnalysisTransaction) {
		for i := range items {
			items[i].Facts.Description = "!!! 123"
		}
	})
	check("invalid amount", func(items []types.AnalysisTransaction) { items[2].Facts.Amount = "NaN" })
	check("zero amount", func(items []types.AnalysisTransaction) { items[2].Facts.Amount = "0" })
	check("missing time", func(items []types.AnalysisTransaction) { items[2].Facts.PostedTime, items[2].Facts.OccurredAt = 0, 0 })
}

func TestRecurringCancellationAndDeterminism(t *testing.T) {
	items := []types.AnalysisTransaction{
		recurringTx("a", "NETFLIX", "-15.99", recurringDay(2026, 1, 5)),
		recurringTx("b", "NETFLIX", "-15.99", recurringDay(2026, 2, 5)),
		recurringTx("c", "NETFLIX", "-15.99", recurringDay(2026, 3, 5)),
	}
	first := analyzeRecurring(t, items)
	second := analyzeRecurring(t, items)
	if len(first) != 3 || len(second) != 3 || first[0].Evidence[0].Reason != second[0].Evidence[0].Reason {
		t.Fatalf("nondeterministic=%+v %+v", first, second)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (analysis.Recurring{}).Analyze(ctx, types.AnalysisSnapshot{Transactions: items}); err != context.Canceled {
		t.Fatalf("cancellation=%v", err)
	}
}

func TestRecurringCoexistsWithBNPLAndLeavesModelAlone(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	database, err := sqlite.SetupDatabase(path)
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
	// Three equal fortnightly Klarna withdrawals are both Possible BNPL and a
	// biweekly recurring pattern on the same transactions.
	day := int64(1785628800)
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "bank", ConnID: "test-conn", Currency: "USD", Balance: "100", BalanceDate: day, Transactions: []simplefin.Transaction{
		{ID: "one", Description: "KLARNA", Amount: "-25", Posted: day},
		{ID: "two", Description: "KLARNA", Amount: "-25", Posted: day + 14*86400},
		{ID: "three", Description: "KLARNA", Amount: "-25", Posted: day + 28*86400},
	}}}}
	translation, err := simplefin.Translate(set, map[string]string{simplefin.AccountKey("test-conn", "bank"): "checking"}, time.Unix(day, 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{"checking": true})); err != nil {
		t.Fatal(err)
	}
	runner, err := analysis.NewRunner(database, analysis.Definitions()...)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := scoped.LoadModel()
	beforeRevision, _ := store.ModelETag(before)
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	findings, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil {
		t.Fatal(err)
	}
	byPosting := map[string]map[string]types.AnalysisFinding{}
	for _, item := range findings {
		if item.Status != "active" || item.Stale || len(item.Evidence) == 0 {
			t.Fatalf("claim without active evidence-backed standing: %+v", item)
		}
		if byPosting[item.PostingID] == nil {
			byPosting[item.PostingID] = map[string]types.AnalysisFinding{}
		}
		byPosting[item.PostingID][item.AnalysisType+"/"+item.Kind] = item
	}
	if len(byPosting) != 3 {
		t.Fatalf("patterns split across transactions: %+v", findings)
	}
	for posting, claims := range byPosting {
		bnpl, ok := claims["bnpl/bnpl"]
		if !ok || bnpl.Strength != "moderate" || len(bnpl.Evidence[0].PostingIDs) != 3 {
			t.Fatalf("bnpl=%+v", claims)
		}
		recurring, ok := claims["recurring/recurring"]
		if !ok || recurring.Product != "biweekly" || len(recurring.Evidence[0].PostingIDs) != 3 {
			t.Fatalf("recurring=%+v in %s", claims, posting)
		}
	}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	after, _ := scoped.LoadModel()
	afterRevision, _ := store.ModelETag(after)
	if beforeRevision != afterRevision || len(after.Schedules) != 0 {
		t.Fatal("analysis changed financial state")
	}
}

func TestRecurringSingleTransactionKeepsFindingCount(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.db")
	database, err := sqlite.SetupDatabase(path)
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
	set := &simplefin.AccountSet{Accounts: []simplefin.Account{{ID: "bank", ConnID: "test-conn", Currency: "USD", Balance: "100", BalanceDate: 1785628800, Transactions: []simplefin.Transaction{{ID: "charge", Description: "KLARNA PAY IN 4", Amount: "-25", Posted: 1785628800}}}}}
	translation, err := simplefin.Translate(set, map[string]string{simplefin.AccountKey("test-conn", "bank"): "checking"}, time.Unix(1785628800, 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.ApplySync(nil, simplefin.Reconcile(translation.Pending, translation.Settled, nil, map[string]bool{"checking": true})); err != nil {
		t.Fatal(err)
	}
	runner, err := analysis.NewRunner(database, analysis.Definitions()...)
	if err != nil {
		t.Fatal(err)
	}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	findings, err := scoped.ListAnalysisFindings(types.AnalysisFindingFilter{})
	if err != nil || len(findings) != 1 || findings[0].AnalysisType != "bnpl" {
		t.Fatalf("findings=%+v err=%v", findings, err)
	}
}
