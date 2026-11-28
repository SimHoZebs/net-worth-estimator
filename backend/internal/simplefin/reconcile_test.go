package simplefin

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func reconcileTransaction(name, account, amount string, pending bool, txTime int64) store.SyncTransaction {
	source := account
	posted := txTime
	if pending {
		posted = 0
	}
	return store.SyncTransaction{
		ProviderAccountID: "bridge-" + account,
		TransactionID:     name,
		Transaction: types.Transaction{
			Name:            name,
			SourceAccountID: &source,
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      posted,
			TransactionTime: txTime,
			Enabled:         !pending,
			Pending:         pending,
		},
	}
}

func reconcileBankRow(id, name, account, amount string, pending, void bool, keys ...store.BankKey) store.BankRow {
	source := account
	posted := int64(1785628800)
	if pending || void {
		posted = 0
	}
	return store.BankRow{
		Transaction: types.Transaction{
			ID:              id,
			Name:            name,
			Source:          store.SourceBankSync,
			SourceAccountID: &source,
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      posted,
			TransactionTime: 1785628800,
			Enabled:         !pending && !void,
			Pending:         pending,
			Void:            void,
		},
		Keys: keys,
	}
}

func pendingKey(account, transaction string) store.BankKey {
	return store.BankKey{Provider: store.ProviderSimpleFIN, AccountID: "bridge-" + account, TransactionID: transaction}
}

func directivesByAction(directives []store.BankDirective) (upserts, converts int, voids []string) {
	for _, directive := range directives {
		switch {
		case directive.Upsert != nil:
			upserts++
		case directive.Convert != nil:
			converts++
		case directive.Void != "":
			voids = append(voids, directive.Void)
		}
	}
	return upserts, converts, voids
}

func TestTransactionAmountCentsUsesNumericAmountParser(t *testing.T) {
	for _, tc := range []struct {
		name     string
		raw      string
		resolver string
		inputs   map[string]types.AmountInputBinding
		want     int64
		ok       bool
	}{
		{name: "padded decimal", raw: " 42.10 ", resolver: "expression", want: 4210, ok: true},
		{name: "exponent", raw: "1e3", resolver: "expression", want: 100000, ok: true},
		{name: "leading dot", raw: "+.5", resolver: "expression", want: 50, ok: true},
		{name: "zero remains numeric", raw: "0", resolver: "expression", want: 0, ok: true},
		{name: "negative remains numeric", raw: "-1.5e3", resolver: "expression", want: -150000, ok: true},
		{name: "nonfinite", raw: "Inf", resolver: "expression"},
		{name: "calculated", raw: "1 + 2", resolver: "expression"},
		{name: "wrong resolver", raw: "1", resolver: "literal"},
		{name: "inputs remain caller-owned", raw: "1", resolver: "expression", inputs: map[string]types.AmountInputBinding{"rate": {Source: "literal", Value: 1.0}}, want: 100, ok: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			transaction := types.Transaction{Amount: types.TransactionAmountResolution{Resolver: tc.resolver, Config: map[string]any{"expression": tc.raw}, Inputs: tc.inputs}}
			got, ok := transactionAmountCents(transaction)
			if ok != tc.ok || (ok && got != tc.want) {
				t.Fatalf("cents = (%d, %v), want (%d, %v)", got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestReconcileUpsertsPendingByKey(t *testing.T) {
	pending := []store.SyncTransaction{reconcileTransaction("Corner Store", "prime_card", "42.10", true, 1785628800)}
	directives := Reconcile(pending, nil, nil, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 1 || converts != 0 || len(voids) != 0 {
		t.Fatalf("directives = %+v", directives)
	}
	upsert := directives[0].Upsert
	if len(upsert.Keys) != 1 || upsert.Keys[0] != pendingKey("prime_card", "Corner Store") {
		t.Fatalf("upsert keys = %+v", upsert.Keys)
	}
}

func TestReconcileConvertsVanishedPendingToSettled(t *testing.T) {
	bank := []store.BankRow{reconcileBankRow("uuid-pending", "Corner Store", "prime_card", "42.10", true, false,
		pendingKey("prime_card", "old-auth"))}
	settled := []store.SyncTransaction{reconcileTransaction("Corner Store", "prime_card", "42.10", false, 1785715200)}
	directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 0 || converts != 1 || len(voids) != 0 {
		t.Fatalf("directives = %+v, want one convert and no void", directives)
	}
	convert := directives[0].Convert
	if convert.ID != "uuid-pending" {
		t.Fatalf("convert id = %s, want the hold's id", convert.ID)
	}
	if len(convert.AddKeys) != 1 || convert.AddKeys[0] != pendingKey("prime_card", "Corner Store") {
		t.Fatalf("convert keys = %+v, want the posted key", convert.AddKeys)
	}
}

func TestReconcileVoidsWithoutMatchAndHoldsAmbiguous(t *testing.T) {
	bank := []store.BankRow{reconcileBankRow("uuid-pending", "Corner Store", "prime_card", "42.10", true, false,
		pendingKey("prime_card", "old-auth"))}
	// No candidates: void.
	directives := Reconcile(nil, nil, bank, map[string]bool{"prime_card": true})
	_, converts, voids := directivesByAction(directives)
	if converts != 0 || len(voids) != 1 || voids[0] != "uuid-pending" {
		t.Fatalf("no-match = %+v", directives)
	}
	// Two matching candidates: void the pending row, insert both as new.
	candidates := []store.SyncTransaction{
		reconcileTransaction("Corner Store", "prime_card", "42.10", false, 1785715200),
		reconcileTransaction("Corner Store (2)", "prime_card", "42.10", false, 1785801600),
	}
	directives = Reconcile(nil, candidates, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 2 || converts != 0 || len(voids) != 1 {
		t.Fatalf("ambiguous = %+v", directives)
	}
}

func TestReconcileSkipsRecordedCandidatesAndInsertsBesideLivePending(t *testing.T) {
	bank := []store.BankRow{reconcileBankRow("uuid-pending", "Corner Store", "prime_card", "42.10", true, false,
		pendingKey("prime_card", "old-auth"))}
	// Same charge still pending and now posted under a new bank key: the
	// pending seed refreshes and the posted charge inserts beside it. The
	// hold voids once it vanishes from the feed.
	stillPending := reconcileTransaction("Corner Store", "prime_card", "42.10", true, 1785628800)
	stillPending.TransactionID = "old-auth"
	pending := []store.SyncTransaction{stillPending}
	settled := []store.SyncTransaction{reconcileTransaction("Corner Store", "prime_card", "42.10", false, 1785715200)}
	directives := Reconcile(pending, settled, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 2 || converts != 0 || len(voids) != 0 {
		t.Fatalf("alongside live hold = %+v", directives)
	}
	// A recorded posted key never reprocesses, even if still in the feed.
	recorded := reconcileBankRow("uuid-settled", "Corner Store", "prime_card", "42.10", false, false,
		pendingKey("prime_card", "Corner Store"))
	directives = Reconcile(nil, settled, append(bank, recorded), map[string]bool{"prime_card": true})
	upserts, converts, voids = directivesByAction(directives)
	// The vanished pending row converts via the candidate... except the
	// candidate key is recorded, so it must be skipped: void instead.
	if upserts != 0 || converts != 0 || len(voids) != 1 {
		t.Fatalf("recorded = %+v", directives)
	}
}

func TestReconcileConvertsSameKeyPendingToSettled(t *testing.T) {
	bank := []store.BankRow{reconcileBankRow("uuid-pending", "Corner Store", "prime_card", "42.10", true, false,
		pendingKey("prime_card", "old-auth"))}
	sameKey := reconcileTransaction("Corner Store", "prime_card", "42.10", false, 1785715200)
	sameKey.TransactionID = "old-auth"
	sameKey.ProviderAccountID = "bridge-prime_card"
	directives := Reconcile(nil, []store.SyncTransaction{sameKey}, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 1 || converts != 0 || len(voids) != 0 {
		t.Fatalf("same-key settle = %+v, want one upsert and no void", directives)
	}
}

func TestReconcileConvertsVanishedProvisionalClaimedOccurrence(t *testing.T) {
	// A claimed hold already cleared pending and carries an explicit provisional
	// posted instant. A posted charge under a new id joins that hold instead of
	// inserting beside it.
	row := reconcileBankRow("uuid-claimed", "Corner Store", "prime_card", "42.10", false, false,
		pendingKey("prime_card", "old-auth"))
	row.Transaction.Enabled = true
	row.Transaction.PostedTimeProvisional = true
	row.Transaction.Claim = &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-02-01"}
	bank := []store.BankRow{row}
	settled := []store.SyncTransaction{reconcileTransaction("Corner Store", "prime_card", "42.10", false, 1785715200)}
	directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 0 || converts != 1 || len(voids) != 0 {
		t.Fatalf("claimed settle = %+v, want one convert", directives)
	}
	if directives[0].Convert.ID != "uuid-claimed" {
		t.Fatalf("convert id = %s, want the claimed row's id", directives[0].Convert.ID)
	}
}

func TestReconcileHoldsOneCandidateMatchingTwoHolds(t *testing.T) {
	// One posted charge matching two vanished holds is ambiguous: void
	// both and insert, for the owner to resolve by hand.
	bank := []store.BankRow{
		reconcileBankRow("uuid-first", "Corner Store", "prime_card", "42.10", true, false,
			pendingKey("prime_card", "old-first")),
		reconcileBankRow("uuid-second", "Corner Store", "prime_card", "42.10", true, false,
			pendingKey("prime_card", "old-second")),
	}
	settled := []store.SyncTransaction{reconcileTransaction("Corner Store", "prime_card", "42.10", false, 1785715200)}
	directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 1 || converts != 0 || len(voids) != 2 {
		t.Fatalf("two holds one charge = %+v, want void plus insert", directives)
	}
}

func TestReconcileIgnoresLiveClaimedRowAsConvertTarget(t *testing.T) {
	// A claimed row whose key is still in the feed stays live: the posted
	// charge under a new key inserts beside it instead of converting it.
	row := reconcileBankRow("uuid-claimed", "Corner Store", "prime_card", "42.10", false, false,
		pendingKey("prime_card", "old-auth"))
	row.Transaction.Enabled = true
	row.Transaction.PostedTimeProvisional = true
	row.Transaction.Claim = &types.TransactionClaim{ScheduleID: "rent", OccurrenceDate: "2026-02-01"}
	stillPending := reconcileTransaction("Corner Store", "prime_card", "42.10", true, 1785628800)
	stillPending.TransactionID = "old-auth"
	pending := []store.SyncTransaction{stillPending}
	settled := []store.SyncTransaction{reconcileTransaction("Corner Store", "prime_card", "42.10", false, 1785715200)}
	directives := Reconcile(pending, settled, []store.BankRow{row}, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 2 || converts != 0 || len(voids) != 0 {
		t.Fatalf("live claimed = %+v, want refresh plus insert", directives)
	}
}

func TestReconcileIgnoresUncoveredAccounts(t *testing.T) {
	bank := []store.BankRow{reconcileBankRow("uuid-other", "Corner Store", "other_card", "42.10", true, false,
		pendingKey("other_card", "old-auth"))}
	settled := []store.SyncTransaction{reconcileTransaction("Corner Store", "other_card", "42.10", false, 1785715200)}
	directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
	if len(directives) != 0 {
		t.Fatalf("uncovered account produced directives: %+v", directives)
	}
}

func TestReconcileConvertsTipAdjustedAuth(t *testing.T) {
	// A restaurant auth posts higher with the tip: the hold takes the
	// posted values under its own id.
	bank := []store.BankRow{reconcileBankRow("uuid-pending", "Bistro", "prime_card", "50.00", true, false,
		pendingKey("prime_card", "old-auth"))}
	settled := []store.SyncTransaction{reconcileTransaction("Bistro", "prime_card", "58.00", false, 1785715200)}
	directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 0 || converts != 1 || len(voids) != 0 {
		t.Fatalf("tip-adjusted = %+v, want one convert", directives)
	}
}

func TestReconcileConvertsAuthBelowFinal(t *testing.T) {
	// An Instacart estimate posts lower than authorized: the hold takes
	// the final values under its own id.
	bank := []store.BankRow{reconcileBankRow("uuid-pending", "Instacart", "prime_card", "100.00", true, false,
		pendingKey("prime_card", "old-auth"))}
	settled := []store.SyncTransaction{reconcileTransaction("Instacart", "prime_card", "92.00", false, 1785715200)}
	directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 0 || converts != 1 || len(voids) != 0 {
		t.Fatalf("below-auth final = %+v, want one convert", directives)
	}
}

func TestReconcileConvertsRenamedAuthDescriptor(t *testing.T) {
	// A rideshare authorization describes the hold; the posted charge
	// carries a different product descriptor. The shared merchant still
	// settles the hold in place.
	bank := []store.BankRow{reconcileBankRow("uuid-pending", "LYFT *TEMP AUTH HOLD", "prime_card", "74.94", true, false,
		pendingKey("prime_card", "old-auth"))}
	settled := []store.SyncTransaction{reconcileTransaction("LYFT *STANDARD 10-30", "prime_card", "81.22", false, 1785715200)}
	directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 0 || converts != 1 || len(voids) != 0 {
		t.Fatalf("renamed auth = %+v, want one convert", directives)
	}
}

func TestReconcileRejectsDifferentMerchantBranches(t *testing.T) {
	// The same first token is not enough when the branch token differs.
	bank := []store.BankRow{reconcileBankRow("uuid-pending", "BISTRO UPTOWN", "prime_card", "50.00", true, false,
		pendingKey("prime_card", "old-auth"))}
	settled := []store.SyncTransaction{reconcileTransaction("BISTRO DOWNTOWN", "prime_card", "58.00", false, 1785715200)}
	directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 1 || converts != 0 || len(voids) != 1 {
		t.Fatalf("different branches = %+v, want void plus insert", directives)
	}
}

func TestReconcileRejectsBeyondTolerance(t *testing.T) {
	// +60% is not a tip: the auth voids and the posted charge inserts
	// as its own row, exactly like an unmatched charge.
	bank := []store.BankRow{reconcileBankRow("uuid-pending", "Bistro", "prime_card", "50.00", true, false,
		pendingKey("prime_card", "old-auth"))}
	settled := []store.SyncTransaction{reconcileTransaction("Bistro", "prime_card", "80.00", false, 1785715200)}
	directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 1 || converts != 0 || len(voids) != 1 {
		t.Fatalf("beyond-tolerance = %+v, want void plus insert", directives)
	}
}

func TestReconcileSettledDedupKeepsDifferentStoreNumbers(t *testing.T) {
	// The hold-to-posted merchant key ignores store numbers. Settled-to-
	// settled dedup must not: two exact-amount charges at different
	// stores are distinct.
	bank := []store.BankRow{reconcileBankRow("uuid-settled", "CORNER STORE 1234", "prime_card", "10.00", false, false,
		pendingKey("prime_card", "old-post"))}
	second := []store.SyncTransaction{reconcileTransaction("CORNER STORE 5678", "prime_card", "10.00", false, 1785715200)}
	directives := Reconcile(nil, second, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 1 || converts != 0 || len(voids) != 0 {
		t.Fatalf("different stores = %+v, want one insert", directives)
	}
}

func TestReconcileHoldsAmbiguousTipMatches(t *testing.T) {
	// Two near-amount candidates: no conversion, both insert, auth voids.
	bank := []store.BankRow{reconcileBankRow("uuid-pending", "Bistro", "prime_card", "50.00", true, false,
		pendingKey("prime_card", "old-auth"))}
	candidates := []store.SyncTransaction{
		reconcileTransaction("Bistro", "prime_card", "55.00", false, 1785715200),
		reconcileTransaction("Bistro", "prime_card", "56.00", false, 1785801600),
	}
	directives := Reconcile(nil, candidates, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 2 || converts != 0 || len(voids) != 1 {
		t.Fatalf("ambiguous tip matches = %+v, want void plus two inserts", directives)
	}
}

func TestReconcileNeverConvertsZeroAmountAuth(t *testing.T) {
	// Card-check auths carry no amount to adjust: they vanish even when
	// a zero or tiny charge posts nearby.
	for _, amount := range []string{"0.00", "2.00"} {
		bank := []store.BankRow{reconcileBankRow("uuid-pending", "Bistro", "prime_card", "0.00", true, false,
			pendingKey("prime_card", "old-auth"))}
		settled := []store.SyncTransaction{reconcileTransaction("Bistro", "prime_card", amount, false, 1785715200)}
		directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
		upserts, converts, voids := directivesByAction(directives)
		if upserts != 1 || converts != 0 || len(voids) != 1 {
			t.Fatalf("zero auth vs %s = %+v, want void plus insert", amount, directives)
		}
	}
}

func reconcileInflowTransaction(name, account, amount string, txTime int64) store.SyncTransaction {
	return store.SyncTransaction{
		ProviderAccountID: "bridge-" + account,
		TransactionID:     name,
		Transaction: types.Transaction{
			Name:            name,
			Destinations:    []string{account},
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      txTime,
			TransactionTime: txTime,
			Enabled:         true,
		},
	}
}

func TestReconcileRejectsDirectionMismatch(t *testing.T) {
	// An outflow auth never joins an inflow transaction, even at the exact
	// amount and merchant.
	bank := []store.BankRow{reconcileBankRow("uuid-pending", "Refund Desk", "prime_card", "42.10", true, false,
		pendingKey("prime_card", "old-auth"))}
	settled := []store.SyncTransaction{reconcileInflowTransaction("Refund Desk", "prime_card", "42.10", 1785715200)}
	directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 1 || converts != 0 || len(voids) != 1 {
		t.Fatalf("direction mismatch = %+v, want void plus insert", directives)
	}
}

func TestReconcileSettledDedupStaysExact(t *testing.T) {
	// A near-amount repeat at the same merchant is a genuine second
	// charge and must insert; only an exact repeat is already imported.
	bank := []store.BankRow{reconcileBankRow("uuid-settled", "Bistro", "prime_card", "50.00", false, false,
		pendingKey("prime_card", "old-post"))}
	near := []store.SyncTransaction{reconcileTransaction("Bistro", "prime_card", "52.00", false, 1785715200)}
	directives := Reconcile(nil, near, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 1 || converts != 0 || len(voids) != 0 {
		t.Fatalf("near repeat = %+v, want one insert", directives)
	}
	exact := []store.SyncTransaction{reconcileTransaction("Bistro", "prime_card", "50.00", false, 1785715200)}
	directives = Reconcile(nil, exact, bank, map[string]bool{"prime_card": true})
	if len(directives) != 0 {
		t.Fatalf("exact repeat = %+v, want suppression", directives)
	}
}

func TestReconcilePreservesStoredOccurredTimeOnLifecycleUpdates(t *testing.T) {
	const occurred = int64(1773129600)
	const posted = int64(1773140400)
	covered := map[string]bool{"prime_card": true}

	t.Run("pending refresh", func(t *testing.T) {
		stored := reconcileBankRow("uuid-pending", "Corner Store", "prime_card", "42.10", true, false, pendingKey("prime_card", "auth"))
		stored.Transaction.TransactionTime = occurred
		stored.Transaction.PostedTime = 0
		incoming := reconcileTransaction("Corner Store", "prime_card", "42.10", true, posted)
		incoming.TransactionID = "auth"
		incoming.Transaction.PostedTime = 0
		directives := Reconcile([]store.SyncTransaction{incoming}, nil, []store.BankRow{stored}, covered)
		upserts, _, _ := directivesByAction(directives)
		if upserts != 1 {
			t.Fatalf("directives = %+v, want one pending upsert", directives)
		}
		got := directives[0].Upsert.Transaction
		if got.TransactionTime != occurred || got.PostedTime != 0 {
			t.Fatalf("pending refresh occurred/posted = %d/%d, want %d/0", got.TransactionTime, got.PostedTime, occurred)
		}
	})

	for _, state := range []string{"pending", "void", "awaiting claimed posting"} {
		t.Run("same-key "+state, func(t *testing.T) {
			stored := reconcileBankRow("uuid-pending", "Corner Store", "prime_card", "42.10", state == "pending", state == "void", pendingKey("prime_card", "auth"))
			stored.Transaction.TransactionTime = occurred
			stored.Transaction.PostedTime = 0
			if state == "awaiting claimed posting" {
				stored.Transaction.Enabled = true
				stored.Transaction.PostedTime = occurred
				stored.Transaction.PostedTimeProvisional = true
				stored.Transaction.Claim = &types.TransactionClaim{ScheduleID: "corner", OccurrenceDate: "2026-08-01"}
			}
			incoming := reconcileTransaction("Corner Store", "prime_card", "42.10", false, posted)
			incoming.TransactionID = "auth"
			directives := Reconcile(nil, []store.SyncTransaction{incoming}, []store.BankRow{stored}, covered)
			upserts, converts, voids := directivesByAction(directives)
			if upserts != 1 || converts != 0 || len(voids) != 0 {
				t.Fatalf("directives = %+v, want one same-key upsert", directives)
			}
			got := directives[0].Upsert.Transaction
			if got.TransactionTime != occurred || got.PostedTime != posted {
				t.Fatalf("settlement occurred/posted = %d/%d, want %d/%d", got.TransactionTime, got.PostedTime, occurred, posted)
			}
		})
	}

	t.Run("unique-key conversion", func(t *testing.T) {
		stored := reconcileBankRow("uuid-pending", "Corner Store", "prime_card", "42.10", true, false, pendingKey("prime_card", "auth"))
		stored.Transaction.TransactionTime = occurred
		stored.Transaction.PostedTime = 0
		incoming := reconcileTransaction("Corner Store", "prime_card", "42.10", false, posted)
		directives := Reconcile(nil, []store.SyncTransaction{incoming}, []store.BankRow{stored}, covered)
		upserts, converts, voids := directivesByAction(directives)
		if upserts != 0 || converts != 1 || len(voids) != 0 {
			t.Fatalf("directives = %+v, want one conversion", directives)
		}
		got := directives[0].Convert.Transaction
		if got.TransactionTime != occurred || got.PostedTime != posted {
			t.Fatalf("conversion occurred/posted = %d/%d, want %d/%d", got.TransactionTime, got.PostedTime, occurred, posted)
		}
	})

	t.Run("new insert keeps candidate date", func(t *testing.T) {
		incoming := reconcileTransaction("Corner Store", "prime_card", "42.10", false, posted)
		directives := Reconcile(nil, []store.SyncTransaction{incoming}, nil, covered)
		upserts, converts, voids := directivesByAction(directives)
		if upserts != 1 || converts != 0 || len(voids) != 0 {
			t.Fatalf("directives = %+v, want one insert", directives)
		}
		if got := directives[0].Upsert.Transaction; got.TransactionTime != posted || got.PostedTime != posted {
			t.Fatalf("insert occurred/posted = %d/%d, want candidate %d/%d", got.TransactionTime, got.PostedTime, posted, posted)
		}
	})

	t.Run("stored nonpositive date does not replace candidate", func(t *testing.T) {
		stored := reconcileBankRow("uuid-pending", "Corner Store", "prime_card", "42.10", true, false, pendingKey("prime_card", "auth"))
		stored.Transaction.TransactionTime = 0
		incoming := reconcileTransaction("Corner Store", "prime_card", "42.10", true, posted)
		incoming.TransactionID = "auth"
		directives := Reconcile([]store.SyncTransaction{incoming}, nil, []store.BankRow{stored}, covered)
		if got := directives[0].Upsert.Transaction; got.TransactionTime != posted {
			t.Fatalf("pending occurred = %d, want candidate %d", got.TransactionTime, posted)
		}
	})
}

func TestReconcileSameKeyClaimedSettlementIsOneTime(t *testing.T) {
	const occurred = int64(1773129600)
	const posted = int64(1773140400)
	tests := []struct {
		name           string
		claimed        bool
		provisional    bool
		storedPosted   int64
		incomingPost   int64
		incomingAmount string
		wantUpserts    int
		wantPosted     int64
	}{
		{name: "awaiting real posting", claimed: true, provisional: true, storedPosted: occurred, incomingPost: posted, incomingAmount: "42.10", wantUpserts: 1, wantPosted: posted},
		{name: "same instant final amount", claimed: true, provisional: true, storedPosted: occurred, incomingPost: occurred, incomingAmount: "45.00", wantUpserts: 1, wantPosted: occurred},
		{name: "real posting already landed", claimed: true, storedPosted: posted, incomingPost: posted, incomingAmount: "42.10"},
		{name: "owner edited posted date", claimed: true, storedPosted: posted + 3600, incomingPost: posted, incomingAmount: "42.10"},
		{name: "owner edited posted date equals occurred", claimed: true, storedPosted: occurred, incomingPost: posted, incomingAmount: "42.10"},
		{name: "missing incoming posted date", claimed: true, provisional: true, storedPosted: occurred, incomingAmount: "42.10"},
		{name: "unclaimed row remains settled", storedPosted: occurred, incomingPost: posted, incomingAmount: "42.10"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			stored := reconcileBankRow("uuid-claimed", "Corner Store", "prime_card", "42.10", false, false, pendingKey("prime_card", "auth"))
			stored.Transaction.TransactionTime = occurred
			stored.Transaction.PostedTime = test.storedPosted
			stored.Transaction.PostedTimeProvisional = test.provisional
			if test.claimed {
				stored.Transaction.Claim = &types.TransactionClaim{ScheduleID: "corner", OccurrenceDate: "2026-08-01"}
			}
			candidateTime := test.incomingPost
			if candidateTime <= 0 {
				candidateTime = occurred
			}
			incoming := reconcileTransaction("Corner Store", "prime_card", test.incomingAmount, false, candidateTime)
			incoming.TransactionID = "auth"
			incoming.Transaction.PostedTime = test.incomingPost
			directives := Reconcile(nil, []store.SyncTransaction{incoming}, []store.BankRow{stored}, map[string]bool{"prime_card": true})
			upserts, converts, voids := directivesByAction(directives)
			if upserts != test.wantUpserts || converts != 0 || len(voids) != 0 {
				t.Fatalf("directives = %+v, want %d upserts", directives, test.wantUpserts)
			}
			if test.wantUpserts == 1 {
				got := directives[0].Upsert.Transaction
				if got.TransactionTime != occurred || got.PostedTime != test.wantPosted {
					t.Fatalf("real posting occurred/posted = %d/%d, want %d/%d", got.TransactionTime, got.PostedTime, occurred, test.wantPosted)
				}
				if expression, _ := got.Amount.Config["expression"].(string); expression != test.incomingAmount {
					t.Fatalf("real posting amount = %q, want final amount %q", expression, test.incomingAmount)
				}
			}
		})
	}
}

func TestReconcileSuggestsButDoesNotConvertLodging(t *testing.T) {
	// Lodging uses a longer window but never auto-converts: the hold voids
	// and the posted charge inserts for the owner to resolve.
	bank := []store.BankRow{reconcileBankRow("uuid-pending", "MARRIOTT HOTEL", "prime_card", "300.00", true, false,
		pendingKey("prime_card", "old-auth"))}
	bank[0].Transaction.TransactionTime -= 9 * 86400
	settled := []store.SyncTransaction{reconcileTransaction("MARRIOTT HOTEL", "prime_card", "320.00", false, 1785715200)}
	directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 1 || converts != 0 || len(voids) != 1 {
		t.Fatalf("lodging = %+v, want void plus insert", directives)
	}
}
