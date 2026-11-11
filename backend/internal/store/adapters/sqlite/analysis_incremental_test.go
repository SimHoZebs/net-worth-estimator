package sqlite

import (
	"path/filepath"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func dirtyByID(t *testing.T, s *sqliteStore, since int64) map[string]store.AnalysisDirtyFact {
	t.Helper()
	rows, err := s.ListAnalysisDirtyFacts(since)
	if err != nil {
		t.Fatalf("list dirty: %v", err)
	}
	out := map[string]store.AnalysisDirtyFact{}
	for _, row := range rows {
		out[row.TransactionID] = row
	}
	return out
}

func TestAnalysisDirtyTracksSyncChanges(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	if got := dirtyByID(t, s, 0); len(got) != 0 {
		t.Fatalf("fresh dirty = %v, want empty", got)
	}
	applyDirectives(t, s, []BankDirective{
		bankUpsertDirective(bankSeedTransaction("Corner Store", "checking", "42.10", false), ProviderSimpleFIN, "bridge-checking", "post1"),
		{Observe: &BankObservation{Keys: bankKeys(ProviderSimpleFIN, "bridge-checking", "post1"), Facts: types.TransactionFacts{Description: "CORNER STORE", Amount: "42.10", Currency: "USD", PostedTime: 1785628800}}},
	})
	rows, err := s.LoadBankTransactions()
	if err != nil || len(rows) != 1 {
		t.Fatalf("bank=%+v err=%v", rows, err)
	}
	id := rows[0].Transaction.ID
	dirty := dirtyByID(t, s, 0)
	if dirty[id].Kind != "added" {
		t.Fatalf("added dirty = %+v", dirty)
	}
	rev := dirty[id].Revision
	if rev <= 0 {
		t.Fatalf("added revision = %d, want positive", rev)
	}
	// Identical re-observe writes no row change, so no new dirty revision.
	applyDirectives(t, s, []BankDirective{
		{Observe: &BankObservation{Keys: bankKeys(ProviderSimpleFIN, "bridge-checking", "post1"), Facts: types.TransactionFacts{Description: "CORNER STORE", Amount: "42.10", Currency: "USD", PostedTime: 1785628800}}},
	})
	if got := dirtyByID(t, s, rev); len(got) != 0 {
		t.Fatalf("identical observe dirtied %+v", got)
	}
	// Amount correction records distinctly from other fact edits.
	applyDirectives(t, s, []BankDirective{
		{Observe: &BankObservation{Keys: bankKeys(ProviderSimpleFIN, "bridge-checking", "post1"), Facts: types.TransactionFacts{Description: "CORNER STORE", Amount: "43.00", Currency: "USD", PostedTime: 1785628800}}},
	})
	dirty = dirtyByID(t, s, rev)
	if dirty[id].Kind != "amount-corrected" {
		t.Fatalf("amount dirty = %+v", dirty)
	}
	rev = dirty[id].Revision
	// Non-amount fact edit records separately.
	applyDirectives(t, s, []BankDirective{
		{Observe: &BankObservation{Keys: bankKeys(ProviderSimpleFIN, "bridge-checking", "post1"), Facts: types.TransactionFacts{Description: "CORNER STORE RENAMED", Amount: "43.00", Currency: "USD", PostedTime: 1785628800}}},
	})
	dirty = dirtyByID(t, s, rev)
	if dirty[id].Kind != "facts-changed" {
		t.Fatalf("facts dirty = %+v", dirty)
	}
	rev = dirty[id].Revision
	// Pending flip through a settled-to-pending refresh records lifecycle.
	settled := bankSeedTransaction("Corner Store", "checking", "43.00", false)
	pending := settled
	pending.Pending = true
	pending.Enabled = false
	applyDirectives(t, s, []BankDirective{{Upsert: &BankUpsert{Transaction: pending, Keys: bankKeys(ProviderSimpleFIN, "bridge-checking", "post1")}}})
	dirty = dirtyByID(t, s, rev)
	if dirty[id].Kind != "pending-flipped" {
		t.Fatalf("pending dirty = %+v", dirty)
	}
	rev = dirty[id].Revision
	// Void flip records distinctly.
	if got := applyDirectives(t, s, []BankDirective{{Void: id}}); got.PendingDeleted != 1 {
		t.Fatalf("void = %+v", got)
	}
	dirty = dirtyByID(t, s, rev)
	if dirty[id].Kind != "void-flipped" {
		t.Fatalf("void dirty = %+v", dirty)
	}
	rev = dirty[id].Revision
	// Owner delete of the bank row survives as a tombstone.
	if err := s.DeleteTransaction(id); err != nil {
		t.Fatalf("delete = %v", err)
	}
	dirty = dirtyByID(t, s, rev)
	if dirty[id].Kind != "deleted" {
		t.Fatalf("deleted dirty = %+v", dirty)
	}
}

func TestAnalysisDirtySurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dirty.db")
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	s, err := d.EnsureUser("owner", "https://issuer.test", "restart-dirty")
	if err != nil {
		d.Close()
		t.Fatal(err)
	}
	scoped := s.(*sqliteStore)
	seedAccount(t, scoped, "checking")
	applyDirectives(t, scoped, []BankDirective{
		bankUpsertDirective(bankSeedTransaction("Corner Store", "checking", "42.10", false), ProviderSimpleFIN, "bridge-checking", "post1"),
		{Observe: &BankObservation{Keys: bankKeys(ProviderSimpleFIN, "bridge-checking", "post1"), Facts: types.TransactionFacts{Description: "CORNER STORE", Amount: "42.10", Currency: "USD"}}},
	})
	before := dirtyByID(t, scoped, 0)
	if len(before) != 1 {
		d.Close()
		t.Fatalf("dirty = %+v", before)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	reopenedDB, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { reopenedDB.Close() })
	reopened, err := reopenedDB.User("owner")
	if err != nil {
		t.Fatal(err)
	}
	after, err := reopened.ListAnalysisDirtyFacts(0)
	if err != nil || len(after) != 1 || after[0].Kind != "added" {
		t.Fatalf("reopened dirty = %+v, err %v", after, err)
	}
}

func TestAnalysisPaymentStreamCacheCRUD(t *testing.T) {
	s := openSQLiteStore(t)
	seedAccount(t, s, "checking")
	if streams, err := s.ListAnalysisPaymentStreams(); err != nil || len(streams) != 0 {
		t.Fatalf("fresh streams = %+v, err %v", streams, err)
	}
	first := store.AnalysisPaymentStream{StreamID: "stream-a", StatsJSON: `{"typical":42.1}`, MemberTransactionIDs: []string{"t1", "t2"}, ConsumedRevision: 3, IdentityVersion: 1}
	if err := s.SaveAnalysisPaymentStream(first); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetAnalysisPaymentStream("stream-a")
	if err != nil {
		t.Fatal(err)
	}
	if got.StatsJSON != first.StatsJSON || got.ConsumedRevision != 3 || got.IdentityVersion != 1 || len(got.MemberTransactionIDs) != 2 || got.MemberTransactionIDs[0] != "t1" {
		t.Fatalf("round trip = %+v", got)
	}
	updated := store.AnalysisPaymentStream{StreamID: "stream-a", StatsJSON: `{"typical":43}`, MemberTransactionIDs: []string{"t1"}, ConsumedRevision: 5, IdentityVersion: 1}
	if err := s.SaveAnalysisPaymentStream(updated); err != nil {
		t.Fatal(err)
	}
	got, err = s.GetAnalysisPaymentStream("stream-a")
	if err != nil || got.StatsJSON != `{"typical":43}` || len(got.MemberTransactionIDs) != 1 || got.ConsumedRevision != 5 {
		t.Fatalf("update = %+v, err %v", got, err)
	}
	if err := s.SaveAnalysisPaymentStream(store.AnalysisPaymentStream{StreamID: "stream-b", StatsJSON: `{}`, ConsumedRevision: 5, IdentityVersion: 1}); err != nil {
		t.Fatal(err)
	}
	listed, err := s.ListAnalysisPaymentStreams()
	if err != nil || len(listed) != 2 || listed[0].StreamID != "stream-a" || listed[1].StreamID != "stream-b" {
		t.Fatalf("list = %+v, err %v", listed, err)
	}
	if listed[1].MemberTransactionIDs == nil || len(listed[1].MemberTransactionIDs) != 0 {
		t.Fatalf("empty members = %+v", listed[1])
	}
	if err := s.DeleteAnalysisPaymentStream("stream-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetAnalysisPaymentStream("stream-a"); !store.IsNotFound(err) {
		t.Fatalf("get deleted = %v", err)
	}
	if err := s.DeleteAnalysisPaymentStream("stream-a"); err != nil {
		t.Fatalf("repeat delete = %v", err)
	}
	if err := s.SaveAnalysisPaymentStream(store.AnalysisPaymentStream{StatsJSON: `{}`}); err == nil {
		t.Fatal("empty ID accepted")
	}
	if err := s.SaveAnalysisPaymentStream(store.AnalysisPaymentStream{StreamID: "bad", StatsJSON: `{`}); err == nil {
		t.Fatal("invalid stats JSON accepted")
	}
}

func TestSetupInstallsIncrementalTablesFreshAndPreExisting(t *testing.T) {
	fresh := filepath.Join(t.TempDir(), "fresh.db")
	d, err := SetupDatabase(fresh)
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"analysis_fact_dirty", "analysis_payment_streams"} {
		var count int
		if err := d.SQL().QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil || count != 1 {
			d.Close()
			t.Fatalf("fresh %s = %d, %v", table, count, err)
		}
	}
	d.Close()
	// Simulate a pre-existing database from before the incremental tables:
	// drop the additive tables and revert one trigger to its pre-dirty body.
	db, err := SetupDatabase(fresh)
	if err != nil {
		t.Fatal(err)
	}
	for _, ddl := range []string{`DROP TABLE analysis_fact_dirty`, `DROP TABLE analysis_payment_streams`, `DROP TRIGGER analysis_facts_insert`} {
		if _, err := db.SQL().Exec(ddl); err != nil {
			db.Close()
			t.Fatal(err)
		}
	}
	if _, err := db.SQL().Exec(`CREATE TRIGGER analysis_facts_insert AFTER INSERT ON transaction_source_facts BEGIN
		INSERT INTO analysis_inputs(user_id, revision) VALUES (NEW.user_id, 1)
		ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1; END`); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	// Ordinary setup heals the additive tables and refreshes the trigger.
	healed, err := SetupDatabase(fresh)
	if err != nil {
		t.Fatal(err)
	}
	defer healed.Close()
	for _, table := range []string{"analysis_fact_dirty", "analysis_payment_streams"} {
		var count int
		if err := healed.SQL().QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("healed %s = %d, %v", table, count, err)
		}
	}
	var body string
	if err := healed.SQL().QueryRow(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'analysis_facts_insert'`).Scan(&body); err != nil || len(body) == 0 {
		t.Fatalf("trigger = %q, %v", body, err)
	}
	if len(body) > 0 && !contains(body, "analysis_fact_dirty") {
		t.Fatalf("healed trigger lacks dirty maintenance: %s", body)
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (func() bool {
		for i := 0; i+len(needle) <= len(haystack); i++ {
			if haystack[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}
