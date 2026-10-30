package domain

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Claim linkage: a manual posting records the actual for one scheduled rule
// occurrence. History replays the actual and skips the generated occurrence,
// so the balance takes one hit instead of two. Future occurrences are
// unaffected.

func claimTestDocument() *types.FinancialModelDocument {
	checking := "checking"
	return &types.FinancialModelDocument{
		SourcePath: "test",
		Accounts: []types.Account{
			{ID: checking, Name: "Checking", Kind: types.AccountKindCash, Enabled: true},
		},
		Checkpoints: []types.Checkpoint{
			{AccountID: checking, Balance: 10000, ObservedAt: 1764633599},
		},
		Postings: []types.Posting{
			{
				ID: "rent-feb-actual", Name: "February rent (actual)",
				SourceAccountID: &checking,
				Amount: types.PostingAmountResolution{
					Resolver: "expression",
					Config:   map[string]any{"expression": "950"},
				},
				PostedTime: 1770249600, TransactionTime: 1770249600,
				Claim: &types.PostingClaim{RuleID: "rent", OccurrenceDate: "2026-02-01"},

				Enabled: true,
			},
		},
		RecurrenceRules: []types.RecurrenceRule{
			{
				ID: "rent", Name: "Rent",
				SourceAccountID: &checking,
				Amount: types.PostingAmountResolution{
					Resolver: "expression",
					Config:   map[string]any{"expression": "1000"},
				},
				Frequency: types.FrequencyMonthly,
				StartDate: "2026-01-01",
				Priority:  1,
				Enabled:   true,
			},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
}

func claimTestSettings() *types.ProjectionRuntimeSettings {
	return &types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: "2026-03-01",
		HorizonYears:                1,
		Evaluations:                 types.EmptyEvaluationTables(),
	}
}

func historicalBalance(t *testing.T, path *types.ProjectionPath, date, accountID string) float64 {
	t.Helper()
	for _, row := range path.Rows {
		if row.Date != date || !row.IsHistorical {
			continue
		}
		for _, snapshot := range row.AccountSnapshots {
			if snapshot.AccountID == accountID {
				return snapshot.Balance
			}
		}
	}
	t.Fatalf("no historical row for %s", date)
	return 0
}

func TestClaimSuppressesGeneratedOccurrence(t *testing.T) {
	path, _, err := ProjectRawFinancialModelDocument(claimTestDocument(), claimTestSettings(), types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	// January scheduled rent (1000) plus the February actual (950).
	// The February scheduled occurrence is skipped.
	if got := historicalBalance(t, path, "2026-02-05", "checking"); got != 8050 {
		t.Fatalf("checking after actual = %v, want 8050 (one hit, not two)", got)
	}
	buckets := path.ProjectionStartPostingState.RealizedPostingAmountsByYear
	// Timestamp-only replay includes the start-day rule through the cut, so
	// January plus March anchor in history; February stays claimed.
	if buckets["rent"]["2026"] != 2000 {
		t.Fatalf("rent bucket = %v, want 2000 (January plus March)", buckets["rent"]["2026"])
	}
	if buckets["rent-feb-actual"]["2026"] != 950 {
		t.Fatalf("actual bucket = %v, want 950", buckets["rent-feb-actual"]["2026"])
	}
}

func TestUnclaimedOccurrenceReplaysNormally(t *testing.T) {
	document := claimTestDocument()
	document.Postings[0].Claim = nil
	path, _, err := ProjectRawFinancialModelDocument(document, claimTestSettings(), types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	// Both the scheduled February rent and the unlinked actual replay.
	if got := historicalBalance(t, path, "2026-02-05", "checking"); got != 7050 {
		t.Fatalf("checking without claim = %v, want 7050 (double count)", got)
	}
}

func TestClaimLeavesFutureOccurrencesAlone(t *testing.T) {
	path, _, err := ProjectRawFinancialModelDocument(claimTestDocument(), claimTestSettings(), types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatalf("project: %v", err)
	}
	// Timestamp-only history includes the start-day rule through the cut, so
	// March anchors in history rather than simulating as future.
	if got := historicalBalance(t, path, "2026-03-01", "checking"); got != 7050 {
		t.Fatalf("March history = %v, want 7050 (Jan plus Feb actual plus March)", got)
	}
	for _, event := range path.TransactionEvents {
		if event.Origin.PostingID == "rent" && event.Date == "2026-03-01" {
			t.Fatalf("March rent must not simulate twice (already in history)")
		}
	}
}

func TestClaimValidation(t *testing.T) {
	cases := []struct {
		name  string
		claim *types.PostingClaim
		code  string
	}{
		{"missing rule", &types.PostingClaim{RuleID: "ghost", OccurrenceDate: "2026-02-01"}, "posting.claim.rule.missing"},
		{"unscheduled date", &types.PostingClaim{RuleID: "rent", OccurrenceDate: "2026-02-15"}, "posting.claim.date.unscheduled"},
		{"before rule start", &types.PostingClaim{RuleID: "rent", OccurrenceDate: "2025-12-01"}, "posting.claim.date.range"},
		{"bad date format", &types.PostingClaim{RuleID: "rent", OccurrenceDate: "Feb 1"}, "posting.claim.date.format"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			document := claimTestDocument()
			document.Postings[0].Claim = testCase.claim
			found := false
			for _, issue := range ValidateFinancialModel(document) {
				if issue.Code == testCase.code {
					found = true
				}
			}
			if !found {
				t.Fatalf("expected %q, got %+v", testCase.code, ValidateFinancialModel(document))
			}
		})
	}
}

func TestDuplicateClaimRejected(t *testing.T) {
	document := claimTestDocument()
	duplicate := document.Postings[0]
	duplicate.ID = "rent-feb-actual-2"
	document.Postings = append(document.Postings, duplicate)
	found := false
	for _, issue := range ValidateFinancialModel(document) {
		if issue.Code == "posting.claim.duplicate" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected posting.claim.duplicate, got %+v", ValidateFinancialModel(document))
	}
}

func TestInvalidRuleFrequencyExpandsToNothing(t *testing.T) {
	rule := types.RecurrenceRule{
		ID: "bad", Name: "Bad", Frequency: types.RecurrenceFrequency("fortnightly"),
		StartDate: "2026-01-01", Priority: 1, Enabled: true,
	}
	if got := RuleScheduleDates(&rule, "2027-01-01"); len(got) != 0 {
		t.Fatalf("schedule dates for invalid frequency = %v, want none", got)
	}
	resolved := ResolveOccurrences([]types.RecurrenceRule{rule}, nil, "2026-01-01", "2027-01-01", true)
	if len(resolved.ByDate) != 0 {
		t.Fatalf("occurrences for invalid frequency = %v, want none", resolved.ByDate)
	}
}
