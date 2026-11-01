package store

import (
	"testing"
)

func settlementRecord(participant string, amount int64) Settlement {
	return Settlement{ParticipantID: participant, AmountMinor: amount}
}

func settlementSummaryState(t *testing.T, summary []ParticipantSettlement) map[string]ParticipantSettlement {
	t.Helper()
	out := make(map[string]ParticipantSettlement, len(summary))
	for _, position := range summary {
		out[position.ParticipantID] = position
	}
	return out
}

func TestSummarizeSettlementsStates(t *testing.T) {
	owed := map[string]int64{"alice": 1000, "bob": 1000, "cara": 500}
	summary, err := SummarizeSettlements(owed, []Settlement{
		settlementRecord("bob", 400),
		settlementRecord("cara", 500),
	})
	if err != nil {
		t.Fatal(err)
	}
	positions := settlementSummaryState(t, summary)
	if got := positions["alice"]; got.State != SettlementStateOutstanding || got.SettledMinor != 0 || got.OutstandingMinor != 1000 {
		t.Fatalf("alice = %+v, want outstanding with 1000 left", got)
	}
	if got := positions["bob"]; got.State != SettlementStatePartiallySettled || got.SettledMinor != 400 || got.OutstandingMinor != 600 {
		t.Fatalf("bob = %+v, want partially-settled with 600 left", got)
	}
	if got := positions["cara"]; got.State != SettlementStateSettled || got.SettledMinor != 500 || got.OutstandingMinor != 0 {
		t.Fatalf("cara = %+v, want settled with nothing left", got)
	}
	if got := SplitSettlementState(summary); got != SettlementStatePartiallySettled {
		t.Fatalf("split state = %q, want partially-settled", got)
	}
}

func TestSummarizeSettlementsCountsEachRecordOnce(t *testing.T) {
	owed := map[string]int64{"alice": 1000}
	summary, err := SummarizeSettlements(owed, []Settlement{
		settlementRecord("alice", 300),
		settlementRecord("alice", 300),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(summary) != 1 {
		t.Fatalf("summary length = %d, want 1", len(summary))
	}
	got := summary[0]
	if got.SettledMinor != 600 || got.OutstandingMinor != 400 || got.State != SettlementStatePartiallySettled {
		t.Fatalf("alice = %+v, want 600 settled with 400 left", got)
	}
}

func TestSummarizeSettlementsOverpaymentSettlesWithoutNegative(t *testing.T) {
	owed := map[string]int64{"alice": 1000}
	summary, err := SummarizeSettlements(owed, []Settlement{settlementRecord("alice", 1200)})
	if err != nil {
		t.Fatal(err)
	}
	got := summary[0]
	if got.State != SettlementStateSettled || got.OutstandingMinor != 0 || got.SettledMinor != 1200 {
		t.Fatalf("alice = %+v, want settled with zero outstanding", got)
	}
}

func TestSummarizeSettlementsKeepsUnknownParticipantHistory(t *testing.T) {
	owed := map[string]int64{"alice": 1000}
	summary, err := SummarizeSettlements(owed, []Settlement{settlementRecord("bob", 200)})
	if err != nil {
		t.Fatal(err)
	}
	positions := settlementSummaryState(t, summary)
	got, ok := positions["bob"]
	if !ok {
		t.Fatal("settlement for removed participant dropped from summary")
	}
	if got.OwedMinor != 0 || got.State != SettlementStateSettled {
		t.Fatalf("bob = %+v, want kept with zero owed", got)
	}
}

func TestSummarizeSettlementsSortsParticipants(t *testing.T) {
	owed := map[string]int64{"cara": 1, "alice": 1, "bob": 1}
	summary, err := SummarizeSettlements(owed, nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i < len(summary); i++ {
		if summary[i-1].ParticipantID >= summary[i].ParticipantID {
			t.Fatalf("summary not sorted: %+v", summary)
		}
	}
}

func TestSummarizeSettlementsRejectsNegativeOwed(t *testing.T) {
	if _, err := SummarizeSettlements(map[string]int64{"alice": -1}, nil); err == nil {
		t.Fatal("negative owed share accepted")
	}
}

func TestSplitSettlementState(t *testing.T) {
	if got := SplitSettlementState(nil); got != SettlementStateSettled {
		t.Fatalf("empty state = %q, want settled", got)
	}
	outstanding := []ParticipantSettlement{{ParticipantID: "a", OwedMinor: 5, OutstandingMinor: 5, State: SettlementStateOutstanding}}
	if got := SplitSettlementState(outstanding); got != SettlementStateOutstanding {
		t.Fatalf("untouched state = %q, want outstanding", got)
	}
	full := []ParticipantSettlement{
		{ParticipantID: "a", OwedMinor: 5, SettledMinor: 5, State: SettlementStateSettled},
		{ParticipantID: "b", OwedMinor: 5, SettledMinor: 5, State: SettlementStateSettled},
	}
	if got := SplitSettlementState(full); got != SettlementStateSettled {
		t.Fatalf("covered state = %q, want settled", got)
	}
}
