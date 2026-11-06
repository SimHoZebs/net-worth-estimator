package sqlite

import (
	"errors"
	"path/filepath"
	"reflect"
	"sync"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const settlementIssuer = "https://issuer.test"

const settlementSplitA = "01900000-0000-7000-8000-00000000a001"
const settlementSplitB = "01900000-0000-7000-8000-00000000a002"
const settlementPayment = "01900000-0000-7000-8000-00000000b001"

func openSettlementTestDB(t *testing.T) *Database {
	t.Helper()
	d, err := SetupDatabase(filepath.Join(t.TempDir(), "settlements.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func settlementUser(t *testing.T, d *Database, subject string) string {
	t.Helper()
	id, err := d.EnsureGroupUser(settlementIssuer, subject)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func settlementPaymentTransaction(t *testing.T, d *Database, subject, id string) string {
	t.Helper()
	owner := settlementUser(t, d, subject)
	scoped, err := d.EnsureUser(owner, settlementIssuer, subject)
	if err != nil {
		t.Fatal(err)
	}
	account := "checking"
	if _, err := scoped.CreateAccount(types.Account{ID: account, Name: "Checking", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateTransaction(types.Transaction{
		ID: id, Name: "Real payment", SourceAccountID: &account,
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      1785817200,
		TransactionTime: 1785817200,
		Enabled:         true,
	}); err != nil {
		t.Fatal(err)
	}
	return owner
}

// Recording then listing exposes the append-only history in record
// order with every field round-tripped.
func TestSettlementRecordAndHistory(t *testing.T) {
	d := openSettlementTestDB(t)
	alice := settlementUser(t, d, "alice")
	bob := settlementUser(t, d, "bob")

	first, err := d.RecordSettlement(alice, store.SettlementInput{
		SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 400,
	}, "01900000-0000-7000-8000-00000000c001")
	if err != nil {
		t.Fatal(err)
	}
	if first.SplitID != settlementSplitA || first.ParticipantID != bob || first.AmountMinor != 400 {
		t.Fatalf("recorded = %+v, want split/participant/amount", first)
	}
	if first.ActorID != alice || first.ID == "" || first.CreatedAt == 0 {
		t.Fatalf("recorded = %+v, want actor, id, and time", first)
	}
	if first.Linked() {
		t.Fatalf("unlinked record reports a link: %+v", first)
	}

	second, err := d.RecordSettlement(bob, store.SettlementInput{
		SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 600,
	}, "01900000-0000-7000-8000-00000000c002")
	if err != nil {
		t.Fatal(err)
	}

	history, err := d.ListSettlements(alice, settlementSplitA)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 2 || history[0].ID != first.ID || history[1].ID != second.ID {
		t.Fatalf("history = %+v, want two records in order", history)
	}

	other, err := d.ListSettlements(alice, settlementSplitB)
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 0 {
		t.Fatalf("other split history = %+v, want empty", other)
	}
}

// A retry with the same key replays the recorded settlement without
// appending a second row.
func TestSettlementIdempotentReplay(t *testing.T) {
	d := openSettlementTestDB(t)
	alice := settlementUser(t, d, "alice")
	bob := settlementUser(t, d, "bob")
	input := store.SettlementInput{SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 250}
	key := "01900000-0000-7000-8000-00000000c003"

	first, err := d.RecordSettlement(alice, input, key)
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := d.RecordSettlement(alice, input, key)
	if err != nil {
		t.Fatal(err)
	}
	if replayed != first {
		t.Fatalf("replay = %+v, want %+v", replayed, first)
	}
	history, err := d.ListSettlements(alice, settlementSplitA)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 {
		t.Fatalf("history length = %d, want 1", len(history))
	}
}

// The same key naming a different settlement conflicts instead of
// replaying, and keys are per-actor so two recorders never collide.
func TestSettlementRequestKeyConflict(t *testing.T) {
	d := openSettlementTestDB(t)
	alice := settlementUser(t, d, "alice")
	bob := settlementUser(t, d, "bob")
	key := "01900000-0000-7000-8000-00000000c004"

	if _, err := d.RecordSettlement(alice, store.SettlementInput{
		SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 100,
	}, key); err != nil {
		t.Fatal(err)
	}
	if _, err := d.RecordSettlement(alice, store.SettlementInput{
		SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 200,
	}, key); !errors.Is(err, store.ErrSettlementConflict) {
		t.Fatalf("reused key = %v, want settlement conflict", err)
	}
	if _, err := d.RecordSettlement(bob, store.SettlementInput{
		SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 100,
	}, key); err != nil {
		t.Fatalf("other actor same key: %v", err)
	}
}

// One real payment backs at most one settlement: relinking the same
// payment, even for another split or participant, fails instead of
// double-counting the money.
func TestSettlementLinkedPaymentCountedOnce(t *testing.T) {
	d := openSettlementTestDB(t)
	alice := settlementUser(t, d, "alice")
	bob := settlementUser(t, d, "bob")
	payer := settlementPaymentTransaction(t, d, "payer", settlementPayment)

	linked := store.SettlementInput{
		SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 500,
		LinkedOwnerID: payer, LinkedTransactionID: settlementPayment,
	}
	recorded, err := d.RecordSettlement(alice, linked, "01900000-0000-7000-8000-00000000c005")
	if err != nil {
		t.Fatal(err)
	}
	if !recorded.Linked() || recorded.LinkedOwnerID != payer || recorded.LinkedTransactionID != settlementPayment {
		t.Fatalf("recorded = %+v, want the payment link", recorded)
	}

	for _, tc := range []struct {
		name  string
		input store.SettlementInput
	}{
		{"same share", linked},
		{"other participant", store.SettlementInput{
			SplitID: settlementSplitA, ParticipantID: alice, AmountMinor: 500,
			LinkedOwnerID: payer, LinkedTransactionID: settlementPayment,
		}},
		{"other split", store.SettlementInput{
			SplitID: settlementSplitB, ParticipantID: bob, AmountMinor: 500,
			LinkedOwnerID: payer, LinkedTransactionID: settlementPayment,
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := d.RecordSettlement(alice, tc.input, "01900000-0000-7000-8000-00000000c006"); !errors.Is(err, store.ErrSettlementConflict) {
				t.Fatalf("relinked payment = %v, want settlement conflict", err)
			}
		})
	}
}

// Recording a settlement writes only settlement rows: the linked real
// payment, the payer's other transactions, accounts, and checkpoints are
// byte-identical before and after.
func TestSettlementMovesNoMoney(t *testing.T) {
	d := openSettlementTestDB(t)
	alice := settlementUser(t, d, "alice")
	bob := settlementUser(t, d, "bob")
	payer := settlementPaymentTransaction(t, d, "payer", settlementPayment)

	scoped, err := d.User(payer)
	if err != nil {
		t.Fatal(err)
	}
	before, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}

	if _, err := d.RecordSettlement(alice, store.SettlementInput{
		SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 500,
		LinkedOwnerID: payer, LinkedTransactionID: settlementPayment,
	}, "01900000-0000-7000-8000-00000000c007"); err != nil {
		t.Fatal(err)
	}
	if _, err := d.RecordSettlement(bob, store.SettlementInput{
		SplitID: settlementSplitA, ParticipantID: alice, AmountMinor: 100,
	}, "01900000-0000-7000-8000-00000000c008"); err != nil {
		t.Fatal(err)
	}

	after, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Accounts) != len(before.Accounts) ||
		len(after.Transactions) != len(before.Transactions) ||
		len(after.Checkpoints) != len(before.Checkpoints) {
		t.Fatalf("model changed: before %+v after %+v", before, after)
	}
	for i, transaction := range after.Transactions {
		if !reflect.DeepEqual(transaction, before.Transactions[i]) {
			t.Fatalf("transaction %d changed: %+v", i, transaction)
		}
	}
}

// Outstanding, partially-settled, and settled states derive from owed
// shares plus the recorded history.
func TestSettlementStatesFromHistory(t *testing.T) {
	d := openSettlementTestDB(t)
	alice := settlementUser(t, d, "alice")
	bob := settlementUser(t, d, "bob")
	cara := settlementUser(t, d, "cara")

	record := func(actor, participant string, amount int64, key string) {
		t.Helper()
		if _, err := d.RecordSettlement(actor, store.SettlementInput{
			SplitID: settlementSplitA, ParticipantID: participant, AmountMinor: amount,
		}, key); err != nil {
			t.Fatal(err)
		}
	}
	record(alice, bob, 400, "01900000-0000-7000-8000-00000000c009")
	record(bob, cara, 500, "01900000-0000-7000-8000-00000000c010")

	history, err := d.ListSettlements(alice, settlementSplitA)
	if err != nil {
		t.Fatal(err)
	}
	summary, err := store.SummarizeSettlements(map[string]int64{
		alice: 1000, bob: 1000, cara: 500,
	}, history)
	if err != nil {
		t.Fatal(err)
	}
	states := map[string]string{}
	for _, position := range summary {
		states[position.ParticipantID] = position.State
	}
	if states[alice] != store.SettlementStateOutstanding ||
		states[bob] != store.SettlementStatePartiallySettled ||
		states[cara] != store.SettlementStateSettled {
		t.Fatalf("states = %v, want outstanding/partially-settled/settled", states)
	}
	if got := store.SplitSettlementState(summary); got != store.SettlementStatePartiallySettled {
		t.Fatalf("split state = %q, want partially-settled", got)
	}
}

func TestSettlementRejectsBadInput(t *testing.T) {
	d := openSettlementTestDB(t)
	alice := settlementUser(t, d, "alice")
	bob := settlementUser(t, d, "bob")
	key := "01900000-0000-7000-8000-00000000c011"

	for _, tc := range []struct {
		name  string
		actor string
		input store.SettlementInput
		key   string
	}{
		{"bad actor", "nobody", store.SettlementInput{SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 1}, key},
		{"bad key", alice, store.SettlementInput{SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 1}, "nope"},
		{"bad split", alice, store.SettlementInput{SplitID: "split-1", ParticipantID: bob, AmountMinor: 1}, key},
		{"bad participant", alice, store.SettlementInput{SplitID: settlementSplitA, ParticipantID: "nobody", AmountMinor: 1}, key},
		{"zero amount", alice, store.SettlementInput{SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 0}, key},
		{"negative amount", alice, store.SettlementInput{SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: -5}, key},
		{"half link", alice, store.SettlementInput{SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 1, LinkedOwnerID: alice}, key},
		{"bad link transaction", alice, store.SettlementInput{SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 1, LinkedOwnerID: alice, LinkedTransactionID: "pay-1"}, key},
		{"ghost link transaction", alice, store.SettlementInput{SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 1, LinkedOwnerID: alice, LinkedTransactionID: settlementPayment}, key},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := d.RecordSettlement(tc.actor, tc.input, tc.key); err == nil {
				t.Fatal("bad settlement accepted")
			}
		})
	}

	if _, err := d.RecordSettlement("nobody", store.SettlementInput{
		SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 1,
	}, key); err == nil {
		t.Fatal("unknown actor accepted")
	}
	if _, err := d.ListSettlements("nobody", settlementSplitA); err == nil {
		t.Fatal("unknown requester accepted")
	}
	if _, err := d.ListSettlements(alice, "split-1"); err == nil {
		t.Fatal("malformed split accepted")
	}
}

// Settlement history survives deletion of the linked payment: the
// record keeps its link rather than being rewritten or erased.
func TestSettlementHistorySurvivesLinkedPaymentDelete(t *testing.T) {
	d := openSettlementTestDB(t)
	alice := settlementUser(t, d, "alice")
	bob := settlementUser(t, d, "bob")
	payer := settlementPaymentTransaction(t, d, "payer", settlementPayment)

	recorded, err := d.RecordSettlement(alice, store.SettlementInput{
		SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 500,
		LinkedOwnerID: payer, LinkedTransactionID: settlementPayment,
	}, "01900000-0000-7000-8000-00000000c013")
	if err != nil {
		t.Fatal(err)
	}
	scoped, err := d.User(payer)
	if err != nil {
		t.Fatal(err)
	}
	if err := scoped.DeleteTransaction(settlementPayment); err != nil {
		t.Fatal(err)
	}
	history, err := d.ListSettlements(alice, settlementSplitA)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 || history[0] != recorded {
		t.Fatalf("history = %+v, want the unchanged linked record", history)
	}
}

// Concurrent retries with one key converge to one record: every caller
// sees the winner's settlement and the history holds exactly one row,
// so a retry storm never double-counts.
func TestSettlementConcurrentRetryStorm(t *testing.T) {
	d := openSettlementTestDB(t)
	alice := settlementUser(t, d, "alice")
	bob := settlementUser(t, d, "bob")
	input := store.SettlementInput{SplitID: settlementSplitA, ParticipantID: bob, AmountMinor: 700}
	key := "01900000-0000-7000-8000-00000000c012"

	const racers = 16
	ids := make([]string, racers)
	errs := make([]error, racers)
	var wg sync.WaitGroup
	for i := range ids {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			recorded, err := d.RecordSettlement(alice, input, key)
			if err == nil {
				ids[i] = recorded.ID
			}
			errs[i] = err
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("racer %d: %v", i, err)
		}
		if ids[i] != ids[0] {
			t.Fatalf("racer %d saw %q, want %q", i, ids[i], ids[0])
		}
	}
	history, err := d.ListSettlements(alice, settlementSplitA)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 || history[0].ID != ids[0] {
		t.Fatalf("history = %+v, want exactly the converged record", history)
	}
}
