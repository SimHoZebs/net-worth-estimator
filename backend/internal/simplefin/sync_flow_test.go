package simplefin

import (
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// flowPosting builds adapter-shaped sync postings: bank source with explicit
// lifecycle flags, exactly as the mapper emits them.
func flowPosting(id, name, account, amount string, pending bool, day string) store.SyncPosting {
	stamp, err := time.ParseInLocation("2006-01-02", day, time.UTC)
	if err != nil {
		stamp = time.Unix(1785628800, 0).UTC()
	}
	return store.SyncPosting{
		ProviderAccountID: "bridge-" + account,
		TransactionID:     id,
		Posting: types.Posting{
			Name:            name,
			Source:          store.SourceSimpleFIN,
			SourceAccountID: &account,
			Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      stamp.Unix(),
			TransactionTime: stamp.Unix(),
			Enabled:         false,
			Pending:         pending,
		},
	}
}

func applyFlow(t *testing.T, database store.Store, pending, settled []store.SyncPosting) store.SyncApplySummary {
	t.Helper()
	bank, err := database.LoadBankPostings()
	if err != nil {
		t.Fatal(err)
	}
	covered := map[string]bool{"checking": true, "prime_card": true}
	summary, err := database.ApplySyncPlan(nil, Reconcile(pending, settled, bank, covered))
	if err != nil {
		t.Fatalf("apply = %v", err)
	}
	return summary
}

func bankRowIDs(t *testing.T, database store.Store) map[string]types.Posting {
	t.Helper()
	rows, err := database.LoadBankPostings()
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]types.Posting{}
	for _, row := range rows {
		out[row.Posting.ID] = row.Posting
	}
	return out
}

func TestSyncFlowPendingSettlesThroughConversion(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	first := applyFlow(t, database,
		[]store.SyncPosting{flowPosting("pend-a", "Corner Store", "prime_card", "42.10", true, "2026-08-02")}, nil)
	if first.PendingInserted != 1 {
		t.Fatalf("seed = %+v", first)
	}
	rows := bankRowIDs(t, database)
	if len(rows) != 1 {
		t.Fatalf("pending rows = %v", rows)
	}
	var pendingID string
	for id := range rows {
		pendingID = id
	}
	second := applyFlow(t, database, nil,
		[]store.SyncPosting{flowPosting("post-a", "Corner Store", "prime_card", "42.10", false, "2026-08-03")})
	if second.SettledConverted != 1 || second.PendingDeleted != 0 {
		t.Fatalf("convert = %+v", second)
	}
	after := bankRowIDs(t, database)
	row, ok := after[pendingID]
	if !ok || row.Pending || row.Void || row.Source != store.SourceSimpleFIN {
		t.Fatalf("converted row = %+v, present %v", row, ok)
	}
	// The settled charge stays in later feeds without duplicating.
	third := applyFlow(t, database, nil,
		[]store.SyncPosting{flowPosting("post-a", "Corner Store", "prime_card", "42.10", false, "2026-08-03")})
	if third.SettledConverted != 0 || third.SettledInserted != 0 || third.PendingDeleted != 0 {
		t.Fatalf("repeat = %+v", third)
	}
	if len(bankRowIDs(t, database)) != 1 {
		t.Fatal("repeat feed duplicated the settled row")
	}
}

func TestSyncFlowVanishedPendingVoidsAndHeals(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	applyFlow(t, database,
		[]store.SyncPosting{flowPosting("pend-a", "Corner Store", "prime_card", "42.10", true, "2026-08-02")}, nil)
	voided := applyFlow(t, database, nil, nil)
	if voided.PendingDeleted != 1 {
		t.Fatalf("void = %+v", voided)
	}
	rows := bankRowIDs(t, database)
	if len(rows) != 1 {
		t.Fatalf("void deleted the row: %+v", rows)
	}
	for _, row := range rows {
		if row.Pending || !row.Void {
			t.Fatalf("void state = %+v", row)
		}
	}
	healed := applyFlow(t, database,
		[]store.SyncPosting{flowPosting("pend-a", "Corner Store", "prime_card", "42.10", true, "2026-08-04")}, nil)
	if healed.PendingUpdated != 1 || healed.PendingInserted != 0 {
		t.Fatalf("heal = %+v", healed)
	}
	if len(bankRowIDs(t, database)) != 1 {
		t.Fatal("heal duplicated the row")
	}
}

func TestSyncFlowAmbiguousSettleVoidsAndInsertsBoth(t *testing.T) {
	database := openRunnerStore(t)
	seedRunnerAccounts(t, database)
	applyFlow(t, database,
		[]store.SyncPosting{flowPosting("pend-a", "Corner Store", "prime_card", "42.10", true, "2026-08-02")}, nil)
	summary := applyFlow(t, database, nil, []store.SyncPosting{
		flowPosting("post-a", "Corner Store", "prime_card", "42.10", false, "2026-08-03"),
		flowPosting("post-b", "Corner Store late", "prime_card", "42.10", false, "2026-08-04"),
	})
	if summary.SettledConverted != 0 || summary.SettledInserted != 2 || summary.PendingDeleted != 1 {
		t.Fatalf("ambiguous = %+v", summary)
	}
	if len(bankRowIDs(t, database)) != 3 {
		t.Fatal("ambiguous settle lost a real charge")
	}
}
