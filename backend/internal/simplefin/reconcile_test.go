package simplefin

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func reconcilePosting(name, account, amount string, pending bool, txTime int64) store.SyncPosting {
	source := account
	return store.SyncPosting{
		ProviderAccountID: "bridge-" + account,
		TransactionID:     name,
		Posting: types.Posting{
			Name:            name,
			SourceAccountID: &source,
			Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      txTime,
			TransactionTime: txTime,
			Enabled:         false,
			Pending:         pending,
		},
	}
}

func reconcileBankRow(id, name, account, amount string, pending, void bool, keys ...store.BankKey) store.BankRow {
	source := account
	return store.BankRow{
		Posting: types.Posting{
			ID:              id,
			Name:            name,
			Source:          store.SourceSimpleFIN,
			SourceAccountID: &source,
			Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      1785628800,
			TransactionTime: 1785628800,
			Enabled:         false,
			Pending:         pending,
			Void:            void,
		},
		Keys: keys,
	}
}

func pendingKey(account, transaction string) store.BankKey {
	return store.BankKey{Provider: store.SourceSimpleFIN, AccountID: "bridge-" + account, TransactionID: transaction}
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

func TestReconcileUpsertsPendingByKey(t *testing.T) {
	pending := []store.SyncPosting{reconcilePosting("Corner Store", "prime_card", "42.10", true, 1785628800)}
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

func TestReconcileConvertsVanishedPendingOnUniqueMatch(t *testing.T) {
	bank := []store.BankRow{reconcileBankRow("uuid-pending", "Corner Store", "prime_card", "42.10", true, false,
		pendingKey("prime_card", "old-auth"))}
	settled := []store.SyncPosting{reconcilePosting("Corner Store", "prime_card", "42.10", false, 1785715200)}
	directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 0 || converts != 1 || len(voids) != 0 {
		t.Fatalf("directives = %+v", directives)
	}
	convert := directives[0].Convert
	if convert.ID != "uuid-pending" {
		t.Fatalf("convert targets %+v, want the vanished row", convert)
	}
	if len(convert.AddKeys) != 1 || convert.AddKeys[0] != pendingKey("prime_card", "Corner Store") {
		t.Fatalf("convert adds %+v", convert.AddKeys)
	}
	if convert.Posting.Pending || convert.Posting.Void {
		t.Fatalf("convert values still pending: %+v", convert.Posting)
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
	candidates := []store.SyncPosting{
		reconcilePosting("Corner Store", "prime_card", "42.10", false, 1785715200),
		reconcilePosting("Corner Store (2)", "prime_card", "42.10", false, 1785801600),
	}
	directives = Reconcile(nil, candidates, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 2 || converts != 0 || len(voids) != 1 {
		t.Fatalf("ambiguous = %+v", directives)
	}
}

func TestReconcileSkipsRecordedCandidatesAndDefersToPresentPending(t *testing.T) {
	bank := []store.BankRow{reconcileBankRow("uuid-pending", "Corner Store", "prime_card", "42.10", true, false,
		pendingKey("prime_card", "old-auth"))}
	// Same charge still pending and now posted under the same bank key: the
	// posted candidate defers to the pending row instead of duplicating it.
	stillPending := reconcilePosting("Corner Store", "prime_card", "42.10", true, 1785628800)
	stillPending.TransactionID = "old-auth"
	pending := []store.SyncPosting{stillPending}
	settled := []store.SyncPosting{reconcilePosting("Corner Store", "prime_card", "42.10", false, 1785715200)}
	directives := Reconcile(pending, settled, bank, map[string]bool{"prime_card": true})
	upserts, converts, voids := directivesByAction(directives)
	if upserts != 1 || converts != 0 || len(voids) != 0 {
		t.Fatalf("deferred = %+v", directives)
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

func TestReconcileIgnoresUncoveredAccounts(t *testing.T) {
	bank := []store.BankRow{reconcileBankRow("uuid-other", "Corner Store", "other_card", "42.10", true, false,
		pendingKey("other_card", "old-auth"))}
	settled := []store.SyncPosting{reconcilePosting("Corner Store", "other_card", "42.10", false, 1785715200)}
	directives := Reconcile(nil, settled, bank, map[string]bool{"prime_card": true})
	if len(directives) != 0 {
		t.Fatalf("uncovered account produced directives: %+v", directives)
	}
}
