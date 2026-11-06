// Versioned split persistence (SOC-04B): stored shares, immutable
// accepted history, idempotent retry, revision concurrency, per-participant
// authorization, and acceptance without cash movement.

package sqlite

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

func sharingKey(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	return id.String()
}

func grantSplitAccess(t *testing.T, d *Database, owner, transaction, audience string) {
	t.Helper()
	if _, err := d.GrantSharedTransaction(owner, transaction, store.SharingAudienceUser, audience, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
}

func splitInput(owner, transaction, initiator string, participants ...string) store.SplitInput {
	return store.SplitInput{
		SourceOwnerID:       owner,
		SourceTransactionID: transaction,
		InitiatorID:         initiator,
		Currency:            "USD",
		TotalMinor:          1000,
		ParticipantIDs:      participants,
	}
}

func createSplit(t *testing.T, d *Database, input store.SplitInput) store.Split {
	t.Helper()
	split, err := d.CreateSplit(input.InitiatorID, input, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	return split
}

func splitSum(split store.Split) int64 {
	var sum int64
	for _, allocation := range split.Allocations {
		sum += allocation.AmountMinor
	}
	return sum
}

// snapshotFinancials dumps every financial row so tests prove split
// operations never move money: acceptance changes no cash balances.
func snapshotFinancials(t *testing.T, d *Database) string {
	t.Helper()
	tables := map[string]string{
		"accounts":         "user_id, id, position, name, kind, min_balance, max_balance, color, enabled",
		"transactions":     "user_id, id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, void",
		"checkpoints":      "user_id, id, position, model_account_id, balance, source, observed_at",
		"recurrence_rules": "user_id, id, position, name, source_account_id, destinations, amount_resolution_json, frequency, start_date, end_date, annual_cap, priority, enabled",
	}
	var out strings.Builder
	for _, table := range []string{"accounts", "transactions", "checkpoints", "recurrence_rules"} {
		columns := tables[table]
		rows, err := d.db.Query(`SELECT ` + columns + ` FROM ` + table + ` ORDER BY user_id, id`)
		if err != nil {
			t.Fatal(err)
		}
		count := strings.Count(columns, ",") + 1
		for rows.Next() {
			values := make([]any, count)
			pointers := make([]any, count)
			for i := range values {
				pointers[i] = &values[i]
			}
			if err := rows.Scan(pointers...); err != nil {
				rows.Close()
				t.Fatal(err)
			}
			fmt.Fprintf(&out, "%s:%v\n", table, values)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
	}
	return out.String()
}

// Creation stores source, initiator, participants, amounts, version, and
// acceptance state. Equal shares sum exactly to the total with the integer
// remainder to the initiator.
func TestSplitCreateStoresShares(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	carol, _ := sharingUser(t, d, "carol")
	sharingTransaction(t, storeA, sharingTransactionA)
	grantSplitAccess(t, d, alice, sharingTransactionA, alice)
	grantSplitAccess(t, d, alice, sharingTransactionA, bob)
	grantSplitAccess(t, d, alice, sharingTransactionA, carol)

	split := createSplit(t, d, splitInput(alice, sharingTransactionA, alice, alice, bob, carol))
	if split.Version != 1 || split.Status != store.SplitStatusProposed {
		t.Fatalf("split = v%d %q, want v1 proposed", split.Version, split.Status)
	}
	if split.SourceOwnerID != alice || split.SourceTransactionID != sharingTransactionA || split.SourceRevision == "" {
		t.Fatalf("split source = %+v, want owner/transaction/revision", split)
	}
	if split.InitiatorID != alice || split.Currency != "USD" || split.TotalMinor != 1000 {
		t.Fatalf("split header = %+v, want initiator/currency/total", split)
	}
	if len(split.Allocations) != 3 {
		t.Fatalf("allocations = %d, want 3", len(split.Allocations))
	}
	// 1000 / 3 = 333 remainder 1 to the initiator.
	want := map[string]int64{alice: 334, bob: 333, carol: 333}
	for _, allocation := range split.Allocations {
		if allocation.AmountMinor != want[allocation.ParticipantID] {
			t.Fatalf("allocation %+v, want %v", allocation, want)
		}
		if allocation.Accepted {
			t.Fatalf("allocation %+v accepted before any accept", allocation)
		}
	}
	if sum := splitSum(split); sum != 1000 {
		t.Fatalf("shares sum = %d, want 1000", sum)
	}
	// Caller-supplied overrides replace the equal default when they name
	// every participant and sum exactly to the total.
	overridden := createSplit(t, d, store.SplitInput{
		SourceOwnerID: alice, SourceTransactionID: sharingTransactionA, InitiatorID: alice,
		Currency: "USD", TotalMinor: 1000, ParticipantIDs: []string{alice, bob},
		Overrides: map[string]int64{alice: 700, bob: 300},
	})
	if got := map[string]int64{}; true {
		for _, allocation := range overridden.Allocations {
			got[allocation.ParticipantID] = allocation.AmountMinor
		}
		if got[alice] != 700 || got[bob] != 300 {
			t.Fatalf("override allocations = %v, want alice 700 bob 300", got)
		}
	}
}

// Every participant must hold current source access at creation, and only
// the initiator may create their split. Failures stay closed.
func TestSplitCreateAuthorizesEachParticipant(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	carol, _ := sharingUser(t, d, "carol")
	sharingTransaction(t, storeA, sharingTransactionA)
	grantSplitAccess(t, d, alice, sharingTransactionA, alice)
	grantSplitAccess(t, d, alice, sharingTransactionA, bob)

	// Carol holds no access: creation fails without naming who.
	if _, err := d.CreateSplit(alice, splitInput(alice, sharingTransactionA, alice, alice, bob, carol), sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("create with unauthorized participant = %v, want not-found", err)
	}
	// Bob cannot create Alice's split.
	if _, err := d.CreateSplit(bob, splitInput(alice, sharingTransactionA, alice, alice, bob), sharingKey(t)); !errors.Is(err, store.ErrGroupForbidden) {
		t.Fatalf("non-initiator create = %v, want forbidden", err)
	}
	// Bob cannot accept a split he cannot see created... and a stranger
	// cannot read a split they hold no share of.
	split := createSplit(t, d, splitInput(alice, sharingTransactionA, alice, alice, bob))
	if _, err := d.GetSplit(carol, split.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("stranger read = %v, want not-found", err)
	}
	if _, err := d.AcceptSplit(carol, split.ID, 1, sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("stranger accept = %v, want not-found", err)
	}
	if _, err := d.ListSplitVersions(carol, split.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("stranger history read = %v, want not-found", err)
	}
	// Two users share one file with identical transaction IDs: splits stay
	// owner-scoped. Bob's own transaction (same ID, his scope) backs an
	// independent split Alice cannot see.
	bobScoped := mustStore(t, d, bob)
	sharingTransaction(t, bobScoped, sharingTransactionA)
	grantSplitAccess(t, d, bob, sharingTransactionA, bob)
	bobSplit, err := d.CreateSplit(bob, splitInput(bob, sharingTransactionA, bob, bob), sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetSplit(alice, bobSplit.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("cross-user split read = %v, want not-found", err)
	}
	for _, s := range mustListSplits(t, d, alice) {
		if s.ID == bobSplit.ID {
			t.Fatalf("cross-user split listed for alice")
		}
	}
}

// Creation rejects invalid share math without touching storage.
func TestSplitCreateRejectsInvalidInput(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)
	grantSplitAccess(t, d, alice, sharingTransactionA, alice)
	grantSplitAccess(t, d, alice, sharingTransactionA, bob)

	bad := splitInput(alice, sharingTransactionA, alice, alice, bob)
	cases := map[string]store.SplitInput{
		"bad currency":      {SourceOwnerID: alice, SourceTransactionID: sharingTransactionA, InitiatorID: alice, Currency: "XX", TotalMinor: 100, ParticipantIDs: []string{alice, bob}},
		"negative total":    {SourceOwnerID: alice, SourceTransactionID: sharingTransactionA, InitiatorID: alice, Currency: "USD", TotalMinor: -1, ParticipantIDs: []string{alice, bob}},
		"partial overrides": {SourceOwnerID: alice, SourceTransactionID: sharingTransactionA, InitiatorID: alice, Currency: "USD", TotalMinor: 100, ParticipantIDs: []string{alice, bob}, Overrides: map[string]int64{alice: 100}},
		"overriding total":  {SourceOwnerID: alice, SourceTransactionID: sharingTransactionA, InitiatorID: alice, Currency: "USD", TotalMinor: 100, ParticipantIDs: []string{alice, bob}, Overrides: map[string]int64{alice: 60, bob: 60}},
		"initiator absent":  {SourceOwnerID: alice, SourceTransactionID: sharingTransactionA, InitiatorID: alice, Currency: "USD", TotalMinor: 100, ParticipantIDs: []string{bob}},
	}
	_ = bad
	for name, input := range cases {
		if _, err := d.CreateSplit(alice, input, sharingKey(t)); !errors.Is(err, store.ErrGroupInvalid) {
			t.Fatalf("%s = %v, want invalid", name, err)
		}
	}
	if splits, err := d.ListSplits(alice); err != nil || len(splits) != 0 {
		t.Fatalf("rejected creates left splits = %v, err = %v", splits, err)
	}
}

// Acceptance is per participant; the version turns accepted only when every
// participant has accepted. Acceptance writes no financial rows.
func TestSplitAcceptanceMovesNoMoney(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)
	grantSplitAccess(t, d, alice, sharingTransactionA, alice)
	grantSplitAccess(t, d, alice, sharingTransactionA, bob)

	before := snapshotFinancials(t, d)
	split := createSplit(t, d, splitInput(alice, sharingTransactionA, alice, alice, bob))

	afterBob, err := d.AcceptSplit(bob, split.ID, 1, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if afterBob.Status != store.SplitStatusProposed {
		t.Fatalf("status after one of two accepts = %q, want proposed", afterBob.Status)
	}
	afterAlice, err := d.AcceptSplit(alice, split.ID, 1, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if afterAlice.Status != store.SplitStatusAccepted {
		t.Fatalf("status after all accepts = %q, want accepted", afterAlice.Status)
	}
	for _, allocation := range afterAlice.Allocations {
		if !allocation.Accepted || allocation.AcceptedAt == 0 {
			t.Fatalf("allocation %+v missing acceptance mark", allocation)
		}
	}
	if got, want := snapshotFinancials(t, d), before; got != want {
		t.Fatalf("financial rows changed across split lifecycle:\n%s", diffLines(want, got))
	}
	// Re-accepting an accepted version with a fresh key is a no-op that
	// still records the key without a second audit row.
	again, err := d.AcceptSplit(bob, split.ID, 1, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if again.Status != store.SplitStatusAccepted {
		t.Fatalf("re-accept status = %q, want accepted", again.Status)
	}
	events, err := d.ListSharingAudit(alice, sharingTransactionA)
	if err != nil {
		t.Fatal(err)
	}
	var accepts int
	for _, event := range events {
		if event.Action == store.SharingAuditSplitAccepted {
			accepts++
			if event.LinkID != split.ID || event.Status == "" || event.RequestID == "" || event.CreatedAt == 0 {
				t.Fatalf("accept audit = %+v, want link/status/key/time", event)
			}
		}
	}
	if accepts != 2 {
		t.Fatalf("accept audit rows = %d, want 2 (one per acceptor)", accepts)
	}
}

// Revisions append versions; accepted history stays immutable. An accepted
// share only changes through an explicit new version with reset
// acceptances, never by silent edit.
func TestSplitUpdateVersionsImmutableHistory(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)
	grantSplitAccess(t, d, alice, sharingTransactionA, alice)
	grantSplitAccess(t, d, alice, sharingTransactionA, bob)

	split := createSplit(t, d, splitInput(alice, sharingTransactionA, alice, alice, bob))
	if _, err := d.AcceptSplit(alice, split.ID, 1, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.AcceptSplit(bob, split.ID, 1, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	// Only the initiator may revise.
	updated := splitInput(alice, sharingTransactionA, alice, alice, bob)
	updated.TotalMinor = 2000
	if _, err := d.UpdateSplit(bob, split.ID, 1, updated, sharingKey(t)); !errors.Is(err, store.ErrGroupForbidden) {
		t.Fatalf("non-initiator update = %v, want forbidden", err)
	}
	// A revision cannot change the initiator either.
	hostile := updated
	hostile.InitiatorID = bob
	hostile.ParticipantIDs = []string{alice, bob}
	if _, err := d.UpdateSplit(alice, split.ID, 1, hostile, sharingKey(t)); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("initiator-changing update = %v, want invalid", err)
	}
	v2, err := d.UpdateSplit(alice, split.ID, 1, updated, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if v2.Version != 2 || v2.Status != store.SplitStatusProposed || v2.TotalMinor != 2000 {
		t.Fatalf("v2 = %+v, want version 2 proposed total 2000", v2)
	}
	for _, allocation := range v2.Allocations {
		if allocation.Accepted {
			t.Fatalf("v2 allocation %+v kept acceptance across revision", allocation)
		}
	}
	if sum := splitSum(v2); sum != 2000 {
		t.Fatalf("v2 shares sum = %d, want 2000", sum)
	}
	// Version 1 is untouched: still accepted with both acceptances.
	history, err := d.ListSplitVersions(alice, split.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 2 || history[0].Version != 1 || history[1].Version != 2 {
		t.Fatalf("history versions = %v, want [1 2]", history)
	}
	v1 := history[0]
	if v1.Status != store.SplitStatusAccepted || v1.TotalMinor != 1000 {
		t.Fatalf("v1 = %+v, want accepted total 1000", v1)
	}
	for _, allocation := range v1.Allocations {
		if !allocation.Accepted {
			t.Fatalf("v1 allocation %+v lost acceptance to revision", allocation)
		}
	}
	// Accepting the superseded version fails explicitly.
	if _, err := d.AcceptSplit(alice, split.ID, 1, sharingKey(t)); !errors.Is(err, store.ErrSharingConflict) {
		t.Fatalf("accept of superseded version = %v, want conflict", err)
	}
	latest, err := d.GetSplit(bob, split.ID)
	if err != nil {
		t.Fatal(err)
	}
	if latest.Version != 2 {
		t.Fatalf("latest version = %d, want 2", latest.Version)
	}
}

// Strangers learn nothing from mutation error codes: wrong-version and
// right-version probes both report not-found, never conflict or
// forbidden, so split existence and staleness stay unguessable.
func TestSplitStrangerProbesStayNotFound(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	stranger, _ := sharingUser(t, d, "stranger")
	sharingTransaction(t, storeA, sharingTransactionA)
	grantSplitAccess(t, d, alice, sharingTransactionA, alice)
	grantSplitAccess(t, d, alice, sharingTransactionA, bob)

	split := createSplit(t, d, splitInput(alice, sharingTransactionA, alice, alice, bob))
	updated := splitInput(alice, sharingTransactionA, alice, alice, bob)
	if _, err := d.UpdateSplit(alice, split.ID, 1, updated, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	for _, version := range []int64{1, 2, 99} {
		if _, err := d.UpdateSplit(stranger, split.ID, version, updated, sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
			t.Fatalf("stranger update v%d = %v, want not-found", version, err)
		}
		if _, err := d.AcceptSplit(stranger, split.ID, version, sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
			t.Fatalf("stranger accept v%d = %v, want not-found", version, err)
		}
	}
}

// A retry with the same key replays the recorded split and appends no
// second audit row; a key reused for another action or target conflicts.
func TestSplitCreateRetryReplays(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)
	grantSplitAccess(t, d, alice, sharingTransactionA, alice)
	grantSplitAccess(t, d, alice, sharingTransactionA, bob)

	key := sharingKey(t)
	first, err := d.CreateSplit(alice, splitInput(alice, sharingTransactionA, alice, alice, bob), key)
	if err != nil {
		t.Fatal(err)
	}
	second, err := d.CreateSplit(alice, splitInput(alice, sharingTransactionA, alice, alice, bob), key)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID || second.Version != 1 {
		t.Fatalf("replayed split = %+v, want %+v", second, first)
	}
	events, err := d.ListSharingAudit(alice, sharingTransactionA)
	if err != nil {
		t.Fatal(err)
	}
	var creates int
	for _, event := range events {
		if event.Action == store.SharingAuditSplitCreated {
			creates++
			if event.ActorUserID != alice || event.OwnerUserID != alice || event.TransactionID != sharingTransactionA ||
				event.LinkID != first.ID || event.Status != store.SplitStatusProposed || event.RequestID != key {
				t.Fatalf("create audit = %+v, want actor/action/target/link/status/key", event)
			}
		}
	}
	if creates != 1 {
		t.Fatalf("create audit rows = %d, want 1", creates)
	}
	// The same key names a different split action: conflict every time.
	// (Grant/exclusion mutations carry no request IDs in this tree, so
	// cross-operation key aliasing is untestable here; split keys still
	// never alias each other.)
	updated := splitInput(alice, sharingTransactionA, alice, alice, bob)
	if _, err := d.UpdateSplit(alice, first.ID, 1, updated, key); !errors.Is(err, store.ErrSharingConflict) {
		t.Fatalf("update with create key = %v, want conflict", err)
	}
	if _, err := d.AcceptSplit(alice, first.ID, 1, key); !errors.Is(err, store.ErrSharingConflict) {
		t.Fatalf("accept with create key = %v, want conflict", err)
	}
}

// Concurrent revisions fail explicitly: racers naming the same base version
// converge to one winner, and no storage constraint ever leaks.
func TestSplitConcurrentUpdatesConverge(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)
	grantSplitAccess(t, d, alice, sharingTransactionA, alice)
	grantSplitAccess(t, d, alice, sharingTransactionA, bob)

	split := createSplit(t, d, splitInput(alice, sharingTransactionA, alice, alice, bob))
	const racers = 16
	errs := make([]error, racers)
	var wg sync.WaitGroup
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			updated := splitInput(alice, sharingTransactionA, alice, alice, bob)
			updated.TotalMinor = int64(1000 + i + 1)
			_, errs[i] = d.UpdateSplit(alice, split.ID, 1, updated, sharingKey(t))
		}(i)
	}
	wg.Wait()
	var wins int
	for i, err := range errs {
		switch {
		case err == nil:
			wins++
		case errors.Is(err, store.ErrSharingConflict):
		default:
			t.Fatalf("racer %d = %v, want nil or conflict", i, err)
		}
		if err != nil && strings.Contains(err.Error(), "UNIQUE constraint") {
			t.Fatalf("racer %d leaked a storage constraint: %v", i, err)
		}
	}
	if wins != 1 {
		t.Fatalf("winners = %d, want exactly 1", wins)
	}
	latest, err := d.GetSplit(alice, split.ID)
	if err != nil {
		t.Fatal(err)
	}
	if latest.Version != 2 || splitSum(latest) != latest.TotalMinor {
		t.Fatalf("latest = %+v, want v2 with exact shares", latest)
	}
	history, err := d.ListSplitVersions(alice, split.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 2 {
		t.Fatalf("history versions = %d, want 2", len(history))
	}
}

// Concurrent creations with one shared key converge to a single split;
// distinct keys mint distinct splits.
func TestSplitConcurrentCreatesConverge(t *testing.T) {
	for _, shared := range []bool{false, true} {
		d := openSharingTestDB(t)
		alice, storeA := sharingUser(t, d, "alice")
		bob, _ := sharingUser(t, d, "bob")
		sharingTransaction(t, storeA, sharingTransactionA)
		grantSplitAccess(t, d, alice, sharingTransactionA, alice)
		grantSplitAccess(t, d, alice, sharingTransactionA, bob)

		const racers = 16
		key := sharingKey(t)
		ids := make([]string, racers)
		errs := make([]error, racers)
		var wg sync.WaitGroup
		for i := range ids {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				k := sharingKey(t)
				if shared {
					k = key
				}
				split, err := d.CreateSplit(alice, splitInput(alice, sharingTransactionA, alice, alice, bob), k)
				if err == nil {
					ids[i] = split.ID
				} else {
					errs[i] = err
				}
			}(i)
		}
		wg.Wait()
		for i, err := range errs {
			if err != nil {
				t.Fatalf("shared=%v create %d = %v, want convergence", shared, i, err)
			}
			if shared && ids[i] != ids[0] {
				t.Fatalf("shared=%v create %d minted %q alongside %q", shared, i, ids[i], ids[0])
			}
		}
		splits, err := d.ListSplits(alice)
		if err != nil {
			t.Fatal(err)
		}
		want := racers
		if shared {
			want = 1
		}
		if len(splits) != want {
			t.Fatalf("shared=%v splits = %d, want %d", shared, len(splits), want)
		}
		d.Close()
	}
}

// Request IDs stay required UUIDs on every split mutation.
func TestSplitRequestIDsAreUUIDs(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)
	grantSplitAccess(t, d, alice, sharingTransactionA, alice)
	grantSplitAccess(t, d, alice, sharingTransactionA, bob)

	input := splitInput(alice, sharingTransactionA, alice, alice, bob)
	if _, err := d.CreateSplit(alice, input, "not-a-uuid"); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("create with bad key = %v, want invalid", err)
	}
	split := createSplit(t, d, input)
	if _, err := d.UpdateSplit(alice, split.ID, 1, input, ""); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("update with empty key = %v, want invalid", err)
	}
	if _, err := d.AcceptSplit(alice, split.ID, 1, "UPPERCASE-KEY"); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("accept with bad key = %v, want invalid", err)
	}
}

// Scope clears drop splits touching the cleared user so import replacement
// never leaves obligations naming unrelated new rows.
func TestSplitClearDropsUserSplits(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, storeB := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)
	grantSplitAccess(t, d, alice, sharingTransactionA, alice)
	grantSplitAccess(t, d, alice, sharingTransactionA, bob)

	split := createSplit(t, d, splitInput(alice, sharingTransactionA, alice, alice, bob))
	if err := storeB.Clear(); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetSplit(alice, split.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("split after participant clear = %v, want not-found", err)
	}
}

func mustStore(t *testing.T, d *Database, userID string) store.Store {
	t.Helper()
	scoped, err := d.User(userID)
	if err != nil {
		t.Fatal(err)
	}
	return scoped
}

func mustListSplits(t *testing.T, d *Database, userID string) []store.Split {
	t.Helper()
	splits, err := d.ListSplits(userID)
	if err != nil {
		t.Fatal(err)
	}
	return splits
}

func diffLines(want, got string) string {
	var out strings.Builder
	fmt.Fprintf(&out, "--- want\n%s\n--- got\n%s", want, got)
	return out.String()
}
