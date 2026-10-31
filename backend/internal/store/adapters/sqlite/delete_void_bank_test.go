package sqlite

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

func seedVoidBankRow(t *testing.T, database store.Store, name, account, amount, key string) string {
	t.Helper()
	seed := bankSeedPosting(name, account, amount, true)
	summary := applyDirectives(t, database, []BankDirective{{
		Upsert: &BankUpsert{Posting: seed, Keys: bankKeys(SourceSimpleFIN, "bridge-"+account, key)},
	}})
	if summary.PendingInserted != 1 {
		t.Fatalf("seed pending = %+v", summary)
	}
	rows, err := database.LoadBankPostings()
	if err != nil {
		t.Fatalf("load bank postings: %v", err)
	}
	var id string
	for _, row := range rows {
		for _, bankKey := range row.Keys {
			if bankKey.TransactionID == key {
				id = row.Posting.ID
			}
		}
	}
	if id == "" {
		t.Fatalf("seeded pending row %s missing", key)
	}
	voided := applyDirectives(t, database, []BankDirective{{Void: id}})
	if voided.PendingDeleted != 1 {
		t.Fatalf("void = %+v", voided)
	}
	return id
}

func TestDeletePostingRemovesPhantomVoid(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	voidID := seedVoidBankRow(t, database, "Bistro", "prime_card", "50.00", "auth-a")
	settled := bankSeedPosting("Bistro", "prime_card", "58.00", false)
	if inserted := applyDirectives(t, database, []BankDirective{{
		Upsert: &BankUpsert{Posting: settled, Keys: bankKeys(SourceSimpleFIN, "bridge-prime", "post-a")},
	}}); inserted.SettledInserted != 1 {
		t.Fatalf("seed settled = %+v", inserted)
	}
	if err := database.DeletePosting(voidID); err != nil {
		t.Fatalf("delete void = %v", err)
	}
	after, err := database.LoadBankPostings()
	if err != nil || len(after) != 1 {
		t.Fatalf("bank rows = %+v, err %v", after, err)
	}
	if after[0].Posting.Void || !after[0].Posting.Enabled {
		t.Fatalf("survivor = %+v, want the enabled settled sibling", after[0].Posting)
	}
	if after[0].Posting.Amount.Config["expression"] != "58.00" {
		t.Fatalf("survivor amount = %+v, want the posted total", after[0].Posting.Amount)
	}
}

func TestDeletePostingStillRefusesPendingBankRows(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	seed := bankSeedPosting("Hold", "prime_card", "5.00", true)
	summary := applyDirectives(t, database, []BankDirective{{
		Upsert: &BankUpsert{Posting: seed, Keys: bankKeys(SourceSimpleFIN, "bridge-prime", "hold-a")},
	}})
	if summary.PendingInserted != 1 {
		t.Fatalf("seed pending = %+v", summary)
	}
	rows, err := database.LoadBankPostings()
	if err != nil || len(rows) != 1 {
		t.Fatalf("bank rows = %+v, err %v", rows, err)
	}
	if err := database.DeletePosting(rows[0].Posting.ID); !IsSyncOwned(err) {
		t.Fatalf("delete pending bank row err = %v, want sync-owned refusal", err)
	}
}

func TestDeletePostingAllowsSettledBankRows(t *testing.T) {
	// Settled bank rows were already owner-deletable through the store;
	// the UI keeps the delete control hidden for them because a deleted
	// settled row is re-imported by the next sync.
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	settled := bankSeedPosting("Bistro", "prime_card", "58.00", false)
	inserted := applyDirectives(t, database, []BankDirective{{
		Upsert: &BankUpsert{Posting: settled, Keys: bankKeys(SourceSimpleFIN, "bridge-prime", "post-a")},
	}})
	if inserted.SettledInserted != 1 {
		t.Fatalf("seed settled = %+v", inserted)
	}
	rows, err := database.LoadBankPostings()
	if err != nil || len(rows) != 1 {
		t.Fatalf("bank rows = %+v, err %v", rows, err)
	}
	if err := database.DeletePosting(rows[0].Posting.ID); err != nil {
		t.Fatalf("delete settled bank row = %v", err)
	}
}
