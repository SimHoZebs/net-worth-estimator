package domain

import (
	"slices"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func chronologyStamp(t *testing.T, value string) int64 {
	t.Helper()
	instant, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatal(err)
	}
	return instant.Unix()
}

func TestTransactionInstantAndDayUseAuthoredChronology(t *testing.T) {
	cases := []struct {
		name        string
		source      string
		pending     bool
		occurred    int64
		posted      int64
		wantInstant int64
		wantDay     string
	}{
		{name: "settled bank uses posted", source: "banksync", occurred: 8, posted: 11, wantInstant: 11, wantDay: "1970-01-01"},
		{name: "pending bank uses occurred", source: "banksync", pending: true, occurred: 8, posted: 0, wantInstant: 8, wantDay: "1970-01-01"},
		{name: "posted-only bank uses posted", source: "simplefin", occurred: 0, posted: 11, wantInstant: 11, wantDay: "1970-01-01"},
		{name: "owner uses occurred", source: "user", occurred: 8, posted: 11, wantInstant: 8, wantDay: "1970-01-01"},
		{name: "empty source is owner", occurred: 8, posted: 11, wantInstant: 8, wantDay: "1970-01-01"},
		{name: "owner falls back to posted", source: "user", occurred: 0, posted: 11, wantInstant: 11, wantDay: "1970-01-01"},
		{name: "empty source falls back to posted", occurred: 0, posted: 11, wantInstant: 11, wantDay: "1970-01-01"},
		{name: "missing bank times stay empty", source: "banksync", wantInstant: 0, wantDay: ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			transaction := types.Transaction{
				Source:          testCase.source,
				Pending:         testCase.pending,
				TransactionTime: testCase.occurred,
				PostedTime:      testCase.posted,
			}
			if got := TransactionInstant(&transaction); got != testCase.wantInstant {
				t.Fatalf("TransactionInstant = %d, want %d", got, testCase.wantInstant)
			}
			if got := transactionDay(&transaction); got != testCase.wantDay {
				t.Fatalf("transactionDay = %q, want %q", got, testCase.wantDay)
			}
		})
	}
}

func TestBankTransactionAppliesAtPostedInstant(t *testing.T) {
	account := "checking"
	occurred := chronologyStamp(t, "2026-01-05T08:00:00Z")
	posted := chronologyStamp(t, "2026-01-05T11:00:00Z")
	checkpoint := chronologyStamp(t, "2026-01-05T09:00:00Z")
	model := &types.FinancialModel{
		Accounts:    []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{{AccountID: account, Balance: 1000, Source: "banksync", ObservedAt: checkpoint}},
		Transactions: []types.Transaction{{
			ID:              "bank-charge",
			Name:            "Bank charge",
			SourceAccountID: &account,
			Amount:          expenseAmount("100"),
			TransactionTime: occurred,
			PostedTime:      posted,
			Enabled:         true,
			Source:          "banksync",
		}},
		Evaluations: types.EmptyEvaluationTables(),
	}
	cases := []struct {
		name        string
		cut         int64
		wantBalance float64
	}{
		{name: "checkpoint before posting", cut: checkpoint, wantBalance: 1000},
		{name: "immediately before posted", cut: posted - 1, wantBalance: 1000},
		{name: "exactly at posted", cut: posted, wantBalance: 900},
		{name: "immediately after posted", cut: posted + 1, wantBalance: 900},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			applied, err := applyChronologicalHistoryAt(model, "2026-01-05", testCase.cut)
			if err != nil {
				t.Fatal(err)
			}
			if got := applied.state.Balances[account]; got != testCase.wantBalance {
				t.Fatalf("balance = %v, want %v", got, testCase.wantBalance)
			}
			if len(applied.snapshots) != 1 {
				t.Fatalf("checkpoint snapshots = %+v, want one snapshot", applied.snapshots)
			}
		})
	}
}

func TestEnabledPendingBankRowWithoutPostedTimeUsesTransactionTime(t *testing.T) {
	account := "checking"
	occurred := chronologyStamp(t, "2026-01-05T08:00:00Z")
	model := &types.FinancialModel{
		Accounts:    []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{{AccountID: account, Balance: 1000, Source: "user", ObservedAt: chronologyStamp(t, "2026-01-05T07:00:00Z")}},
		Transactions: []types.Transaction{{
			ID:              "enabled-hold",
			Name:            "Enabled hold",
			SourceAccountID: &account,
			Amount:          expenseAmount("100"),
			TransactionTime: occurred,
			PostedTime:      0,
			Enabled:         true,
			Pending:         true,
			Source:          "banksync",
		}},
		Evaluations: types.EmptyEvaluationTables(),
	}
	for _, testCase := range []struct {
		name        string
		cut         int64
		wantBalance float64
	}{
		{name: "before transaction time", cut: occurred - 1, wantBalance: 1000},
		{name: "at transaction time", cut: occurred, wantBalance: 900},
		{name: "after transaction time", cut: occurred + 1, wantBalance: 900},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			applied, err := applyChronologicalHistoryAt(model, "2026-01-05", testCase.cut)
			if err != nil {
				t.Fatal(err)
			}
			if got := applied.state.Balances[account]; got != testCase.wantBalance {
				t.Fatalf("balance = %v, want %v for an enabled pending bank row", got, testCase.wantBalance)
			}
		})
	}
}

func TestBankPostedDayDrivesOccurrenceGroupingAndFlowGraph(t *testing.T) {
	account := "checking"
	transaction := types.Transaction{
		ID:              "overnight-charge",
		Name:            "Overnight charge",
		SourceAccountID: &account,
		Amount:          expenseAmount("100"),
		TransactionTime: chronologyStamp(t, "2026-01-05T23:50:00Z"),
		PostedTime:      chronologyStamp(t, "2026-01-06T00:10:00Z"),
		Enabled:         true,
		Source:          "banksync",
	}
	model := &types.FinancialModel{
		Accounts:     []types.Account{cashAccount(account)},
		Transactions: []types.Transaction{transaction},
		Evaluations:  types.EmptyEvaluationTables(),
	}
	t.Run("occurrence grouping", func(t *testing.T) {
		resolved := ResolveOccurrences(nil, model.Transactions, "2026-01-06", "2026-01-06", true)
		if len(resolved.ByDate["2026-01-05"]) != 0 {
			t.Fatalf("bank movement grouped on occurred day: %+v", resolved.ByDate)
		}
		if len(resolved.ByDate["2026-01-06"]) != 1 {
			t.Fatalf("bank movement not grouped on posted day: %+v", resolved.ByDate)
		}
	})
	t.Run("flow graph", func(t *testing.T) {
		graph, err := BuildFlowGraph(model, nil, nil, "2026-01-06", "2026-01-06")
		if err != nil {
			t.Fatal(err)
		}
		if len(graph.Edges) != 1 || len(graph.Edges[0].Sources) != 1 {
			t.Fatalf("posted-day flow = %+v, want one sourced edge", graph.Edges)
		}
		source := graph.Edges[0].Sources[0]
		if source.TransactionID != transaction.ID || source.Date != "2026-01-06" {
			t.Fatalf("flow source = %+v, want bank movement on posted day", source)
		}
	})
}

func TestHistoryAndProjectionSharePostedOrdering(t *testing.T) {
	account := "checking"
	model := &types.FinancialModel{
		Accounts: []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{
			{AccountID: account, Balance: 50, Source: "banksync", ObservedAt: chronologyStamp(t, "2026-01-01T09:00:00Z")},
			{AccountID: account, Balance: 150, Source: "banksync", ObservedAt: chronologyStamp(t, "2026-01-02T13:00:00Z")},
		},
		Transactions: []types.Transaction{
			{
				ID:              "bank-charge",
				Name:            "Bank charge",
				SourceAccountID: &account,
				Amount:          expenseAmount("150"),
				TransactionTime: chronologyStamp(t, "2026-01-01T08:00:00Z"),
				PostedTime:      chronologyStamp(t, "2026-01-02T15:00:00Z"),
				Enabled:         true,
				Source:          "banksync",
			},
			{
				ID:              "owner-inflow",
				Name:            "Owner inflow",
				Destinations:    []string{account},
				Amount:          expenseAmount("100"),
				TransactionTime: chronologyStamp(t, "2026-01-02T12:00:00Z"),
				PostedTime:      chronologyStamp(t, "2026-01-03T12:00:00Z"),
				Enabled:         true,
				Source:          "user",
			},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	t.Run("history", func(t *testing.T) {
		applied, err := applyChronologicalHistory(model, "2026-01-02")
		if err != nil {
			t.Fatal(err)
		}
		if got := applied.state.Balances[account]; got != 0 {
			t.Fatalf("history balance = %v, want 0 after owner inflow then posted charge", got)
		}
		foundPostedDay := false
		for _, snapshot := range applied.snapshots {
			if snapshot.Date == "2026-01-02" {
				foundPostedDay = true
				break
			}
		}
		if !foundPostedDay {
			t.Fatalf("posted-day snapshot = %+v, want the posted day anchored", applied.snapshots)
		}
	})
	t.Run("projection", func(t *testing.T) {
		cut := chronologyStamp(t, "2026-01-02T09:00:00Z")
		prepared, err := PrepareSimulationRequest(model, &types.ProjectionRuntimeSettings{
			FallbackProjectionStartDate: "2026-01-02",
			HorizonYears:                1,
			AsOfInstant:                 &cut,
		}, types.EmptyModelOverrides(), nil)
		if err != nil {
			t.Fatal(err)
		}
		if got := prepared.Request.InitialState.Balances[account]; got != 50 {
			t.Fatalf("projection baseline = %v, want 50", got)
		}
		run, err := Simulate(prepared.Request)
		if err != nil {
			t.Fatal(err)
		}
		if got := run.FinalState.Balances[account]; got != 0 {
			t.Fatalf("projection balance = %v, want 0", got)
		}
		order := make([]string, 0, len(run.TransactionAttempts))
		for _, event := range run.TransactionAttempts {
			order = append(order, event.Origin.TransactionID)
		}
		if !slices.Equal(order, []string{"owner-inflow", "bank-charge"}) {
			t.Fatalf("projection order = %v, want owner inflow before bank charge", order)
		}
		if got := run.TransactionAttempts[1].RealizedAmount; got != 150 {
			t.Fatalf("posted charge realized = %v, want 150 funded by the earlier owner inflow", got)
		}
	})
}

func TestOwnerTransactionsApplyAtTransactionInstant(t *testing.T) {
	account := "checking"
	model := &types.FinancialModel{
		Accounts:    []types.Account{cashAccount(account)},
		Checkpoints: []types.Checkpoint{{AccountID: account, Balance: 1000, Source: "user", ObservedAt: chronologyStamp(t, "2026-01-01T09:00:00Z")}},
		Transactions: []types.Transaction{
			{
				ID:              "owner-outflow",
				Name:            "Owner outflow",
				SourceAccountID: &account,
				Amount:          expenseAmount("100"),
				TransactionTime: chronologyStamp(t, "2026-01-01T12:00:00Z"),
				PostedTime:      chronologyStamp(t, "2026-01-05T15:00:00Z"),
				Enabled:         true,
				Source:          "user",
			},
			{
				ID:              "owner-inflow",
				Name:            "Owner inflow",
				Destinations:    []string{account},
				Amount:          expenseAmount("50"),
				TransactionTime: chronologyStamp(t, "2026-01-02T12:00:00Z"),
				PostedTime:      chronologyStamp(t, "2026-01-06T15:00:00Z"),
				Enabled:         true,
			},
		},
		Evaluations: types.EmptyEvaluationTables(),
	}
	cases := []struct {
		name        string
		cut         int64
		wantBalance float64
	}{
		{name: "before first transaction time", cut: chronologyStamp(t, "2026-01-01T11:59:59Z"), wantBalance: 1000},
		{name: "at first transaction time", cut: chronologyStamp(t, "2026-01-01T12:00:00Z"), wantBalance: 900},
		{name: "before second transaction time", cut: chronologyStamp(t, "2026-01-02T11:59:59Z"), wantBalance: 900},
		{name: "at second transaction time", cut: chronologyStamp(t, "2026-01-02T12:00:00Z"), wantBalance: 950},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			applied, err := applyChronologicalHistoryAt(model, "2026-01-02", testCase.cut)
			if err != nil {
				t.Fatal(err)
			}
			if got := applied.state.Balances[account]; got != testCase.wantBalance {
				t.Fatalf("balance = %v, want %v at owner transaction time", got, testCase.wantBalance)
			}
		})
	}
}

func TestMatchAutoClaimUsesOccurredDayAcrossMidnight(t *testing.T) {
	account := "checking"
	end := "2026-01-03"
	schedules := []types.Schedule{{
		ID:              "daily-coffee",
		Name:            "Coffee",
		SourceAccountID: &account,
		Amount:          autoClaimTestAmount("5"),
		Recurrence:      dailyTestRecurrence(),
		StartDate:       "2026-01-01",
		EndDate:         &end,
		Enabled:         true,
	}}
	transaction := autoClaimTestTransaction("bank-coffee", "Coffee", "2026-01-01", "5", &account)
	transaction.Source = "banksync"
	transaction.TransactionTime = chronologyStamp(t, "2026-01-01T23:50:00Z")
	transaction.PostedTime = chronologyStamp(t, "2026-01-02T00:10:00Z")
	match := MatchAutoClaim(transaction, schedules, map[string]map[string]bool{}, nil)
	if match == nil || match.ScheduleID != "daily-coffee" || match.OccurrenceDate != "2026-01-01" {
		t.Fatalf("claim = %+v, want the occurred-day occurrence on 2026-01-01", match)
	}
}

func TestClaimedOccurrenceCrossingCycleBoundaryPostsInNewCycle(t *testing.T) {
	card := "card"
	end := "2026-09-14"
	model := &types.FinancialModel{
		Accounts:    []types.Account{{ID: card, Name: "Card", Kind: types.AccountKindDebt, Enabled: true, Display: types.PassthroughDisplay(card, "Card")}},
		Checkpoints: []types.Checkpoint{{AccountID: card, Balance: -1000, Source: "banksync", ObservedAt: chronologyStamp(t, "2026-09-10T09:00:00Z")}},
		Schedules: []types.Schedule{{
			ID:              "card-purchase",
			Name:            "Card purchase",
			SourceAccountID: &card,
			Amount:          expenseAmount("100"),
			Recurrence:      monthlyTestRecurrence(),
			StartDate:       "2026-08-14",
			EndDate:         &end,
			Enabled:         true,
		}},
		Transactions: []types.Transaction{{
			ID:              "claimed-charge",
			Name:            "Card purchase",
			SourceAccountID: &card,
			Amount:          expenseAmount("80"),
			TransactionTime: chronologyStamp(t, "2026-09-14T23:50:00Z"),
			PostedTime:      chronologyStamp(t, "2026-09-16T09:00:00Z"),
			Claim:           &types.TransactionClaim{ScheduleID: "card-purchase", OccurrenceDate: "2026-09-14"},
			Enabled:         true,
			Source:          "banksync",
		}},
		Evaluations: types.EmptyEvaluationTables(),
	}
	applied, err := applyChronologicalHistory(model, "2026-09-17")
	if err != nil {
		t.Fatal(err)
	}
	if got := applied.state.Balances[card]; got != -1080 {
		t.Fatalf("history balance = %v, want one claimed charge applied on its posted day", got)
	}
	prepared, err := PrepareSimulationRequest(model, &types.ProjectionRuntimeSettings{
		FallbackProjectionStartDate: "2026-09-17",
		HorizonYears:                1,
	}, types.EmptyModelOverrides(), nil)
	if err != nil {
		t.Fatal(err)
	}
	run, err := Simulate(prepared.Request)
	if err != nil {
		t.Fatal(err)
	}
	if len(run.TransactionAttempts) != 0 {
		t.Fatalf("claimed scheduled occurrence or posted actual ran again: %+v", run.TransactionAttempts)
	}
	path := BuildProjectionPath(prepared, &run)
	result := EvaluateCycleFulfillment(path, types.CycleFulfillmentConfig{AccountIDs: []string{card}, StatementDay: 15, Budget: 100})
	if result.CycleStart != "2026-09-15" || result.CycleEnd != "2026-10-14" {
		t.Fatalf("cycle = %s/%s, want posted cycle", result.CycleStart, result.CycleEnd)
	}
	if result.RecordedSpend != 80 || result.ScheduledSpend != 0 || result.Spent != 80 {
		t.Fatalf("cycle spend = recorded %v scheduled %v total %v, want 80 in the posted cycle", result.RecordedSpend, result.ScheduledSpend, result.Spent)
	}
}

func TestCompareDatedTransactionOccurrencesKeepsRawTieBreakers(t *testing.T) {
	occurrence := func(source string, occurred, posted, executionOrder int64, index int) DatedTransactionOccurrence {
		return DatedTransactionOccurrence{
			Transaction: &types.Transaction{
				Source:          source,
				TransactionTime: occurred,
				PostedTime:      posted,
				ExecutionOrder:  executionOrder,
			},
			Index: index,
		}
	}
	cases := []struct {
		name string
		a    DatedTransactionOccurrence
		b    DatedTransactionOccurrence
	}{
		{
			name: "effective instant precedes raw occurred time",
			a:    occurrence("user", 12, 12, 0, 0),
			b:    occurrence("banksync", 8, 15, 0, 1),
		},
		{
			name: "raw transaction time breaks equal effective instant",
			a:    occurrence("banksync", 8, 12, 9, 1),
			b:    occurrence("user", 12, 12, 1, 0),
		},
		{
			name: "raw posted time breaks equal raw transaction time",
			a:    occurrence("banksync", 10, 10, 9, 1),
			b:    occurrence("user", 10, 20, 1, 0),
		},
		{
			name: "execution order breaks equal raw times",
			a:    occurrence("user", 10, 10, 1, 1),
			b:    occurrence("banksync", 10, 10, 2, 0),
		},
		{
			name: "index breaks equal execution order",
			a:    occurrence("user", 10, 10, 1, 1),
			b:    occurrence("banksync", 10, 10, 1, 2),
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := compareDatedTransactionOccurrences(testCase.a, testCase.b); got >= 0 {
				t.Fatalf("comparison = %d, want first occurrence before second", got)
			}
		})
	}
}
