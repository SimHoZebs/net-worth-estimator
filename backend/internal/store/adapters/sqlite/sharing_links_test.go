package sqlite

// Recipient copy idempotency: repeat accepts return the same copy and the
// same provenance tuple, and accepting a bank transaction mints an
// owner-authored copy with no sync key.

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

const sharingBankTransaction = "01900000-0000-7000-8000-0000000000b1"

// Repeat accepts resolve to the same copy instead of minting duplicates:
// retries never manufacture extra rows.
func TestSharingCopyIdempotent(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, storeB := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)

	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	first, err := d.CopySharedTransaction(alice, sharingTransactionA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	second, err := d.CopySharedTransaction(alice, sharingTransactionA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Fatalf("repeat copy minted %q, want existing %q", second.ID, first.ID)
	}
	model, err := storeB.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Transactions) != 1 {
		t.Fatalf("recipient transactions = %d, want 1", len(model.Transactions))
	}
	var provenance int
	if err := d.SQL().QueryRow(`SELECT COUNT(*) FROM sharing_copies WHERE recipient_user_id = ? AND source_owner_id = ? AND source_transaction_id = ?`,
		bob, alice, sharingTransactionA).Scan(&provenance); err != nil || provenance != 1 {
		t.Fatalf("provenance rows = %d, %v, want 1", provenance, err)
	}
}

// Accepting a settled bank transaction mints an owner-authored copy with no
// bank sync key: the share never manufactures a duplicate bank transaction,
// and repeat accepts add no rows on either side.
func TestSharingCopyOfBankTransactionMintsNoDuplicate(t *testing.T) {
	d := openSharingTestDB(t)
	alice, _ := sharingUser(t, d, "alice")
	bob, storeB := sharingUser(t, d, "bob")

	const amountJSON = `{"resolver":"expression","config":{"expression":"50"},"inputs":{}}`
	for _, stmt := range []string{
		`INSERT INTO transactions (id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, void, user_id)
		 VALUES ('` + sharingBankTransaction + `', 'Bank charge', 'checking', 'null', '` + amountJSON + `', 1782950400, 1782950400, 'banksync', 0, 0, '` + alice + `')`,
		`INSERT INTO transaction_sim (transaction_id, position, enabled, execution_order, user_id) VALUES ('` + sharingBankTransaction + `', 1, 1, 1, '` + alice + `')`,
		`INSERT INTO entity_ids (id, kind, user_id) VALUES ('` + sharingBankTransaction + `', 'transaction', '` + alice + `')`,
		`INSERT INTO transaction_sync_keys (provider, bridge_account_id, bank_transaction_id, transaction_id, user_id) VALUES ('simplefin', 'bridge-prime', 'tx-bank-1', '` + sharingBankTransaction + `', '` + alice + `')`,
	} {
		if _, err := d.SQL().Exec(stmt); err != nil {
			t.Fatalf("seed bank transaction: %v", err)
		}
	}

	if _, err := d.GrantSharedTransaction(alice, sharingBankTransaction, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	copied, err := d.CopySharedTransaction(alice, sharingBankTransaction, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if copied.Source != SourceUser || copied.Pending || copied.Void {
		t.Fatalf("copy kept bank lifecycle: %+v", copied)
	}
	var keys int
	if err := d.SQL().QueryRow(`SELECT COUNT(*) FROM transaction_sync_keys WHERE transaction_id = ?`, copied.ID).Scan(&keys); err != nil || keys != 0 {
		t.Fatalf("copy sync keys = %d, %v, want 0", keys, err)
	}
	if again, err := d.CopySharedTransaction(alice, sharingBankTransaction, bob, sharingKey(t)); err != nil || again.ID != copied.ID {
		t.Fatalf("repeat bank accept = %q, %v, want existing %q", again.ID, err, copied.ID)
	}
	for name, tc := range map[string]struct {
		userID string
		want   int
	}{
		"source keeps one bank row": {alice, 1},
		"recipient keeps one copy":  {bob, 1},
	} {
		var transactions int
		if err := d.SQL().QueryRow(`SELECT COUNT(*) FROM transactions WHERE user_id = ?`, tc.userID).Scan(&transactions); err != nil || transactions != tc.want {
			t.Fatalf("%s: transactions = %d, %v, want %d", name, transactions, err, tc.want)
		}
	}
	model, err := storeB.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if model.Transactions[0].Source != SourceUser {
		t.Fatalf("stored copy source = %q, want owner-authored", model.Transactions[0].Source)
	}
}
