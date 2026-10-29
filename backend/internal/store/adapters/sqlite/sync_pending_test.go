package sqlite

import (
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"testing"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func bankKeys(provider, account, transaction string) []BankKey {
	return []BankKey{{Provider: provider, AccountID: account, TransactionID: transaction}}
}

func bankSeedPosting(name, account, amount string, pending bool) types.Posting {
	source := &account
	return types.Posting{
		Name:            name,
		Source:          SourceSimpleFIN,
		SourceAccountID: source,
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      1785628800,
		TransactionTime: 1785628800,
		Enabled:         false,
		Pending:         pending,
	}
}

func bankUpsertDirective(posting types.Posting, provider, account, transaction string) BankDirective {
	return BankDirective{Upsert: &BankUpsert{
		Posting: posting,
		Keys:    bankKeys(provider, account, transaction),
	}}
}

func applyDirectives(t *testing.T, database store.Store, directives []BankDirective) SyncApplySummary {
	t.Helper()
	summary, err := database.ApplySyncPlan(nil, directives)
	if err != nil {
		t.Fatalf("apply = %v", err)
	}
	return summary
}

func TestBankUpsertInsertsAndUpdatesByKey(t *testing.T) {
	database := openSQLiteStore(t)
	seedModelAccount(t, database, "prime_card")
	upsert := BankDirective{Upsert: &BankUpsert{
		Posting: bankSeedPosting("Corner Store", "prime_card", "42.10", true),
		Keys:    bankKeys(SourceSimpleFIN, "bridge-prime", "pend1"),
	}}
	first := applyDirectives(t, database, []BankDirective{upsert})
	if first.PendingInserted != 1 {
		t.Fatalf("insert = %+v", first)
	}
	before, err := database.LoadDocument()
	if err != nil || len(before.Postings) != 1 {
		t.Fatalf("rows = %+v, err %v", before, err)
	}
	id := before.Postings[0].ID
	if parsed, err := uuid.Parse(id); err != nil || parsed.Version() != 7 {
		t.Fatalf("identity is not a UUIDv7: %v", id)
	}
	updated := upsert
	updated.Upsert.Posting.Name = "Corner Store updated"
	second := applyDirectives(t, database, []BankDirective{updated})
	if second.PendingUpdated != 1 || second.PendingInserted != 0 {
		t.Fatalf("update = %+v", second)
	}
	after, err := database.LoadDocument()
	if err != nil || len(after.Postings) != 1 || after.Postings[0].ID != id || after.Postings[0].Name != "Corner Store updated" {
		t.Fatalf("update changed identity or missed values: %+v", after)
	}
	// Duplicate delivery of the same key stays one row.
	third := applyDirectives(t, database, []BankDirective{upsert, upsert})
	if third.PendingUpdated != 2 {
		t.Fatalf("duplicate = %+v", third)
	}
	if got := countRows(t, database, "postings", ""); got != 1 {
		t.Fatalf("duplicate delivery created a second row: %d", got)
	}
}

func TestBankConvertRotatesKeysAndKeepsUUID(t *testing.T) {
	database := openSQLiteStore(t)
	seedModelAccount(t, database, "prime_card")
	applyDirectives(t, database, []BankDirective{{Upsert: &BankUpsert{
		Posting: bankSeedPosting("Pending", "prime_card", "10", true),
		Keys:    bankKeys(SourceSimpleFIN, "bridge-prime", "pend1"),
	}}})
	loaded, err := database.LoadDocument()
	if err != nil || len(loaded.Postings) != 1 {
		t.Fatal("seed missing")
	}
	id := loaded.Postings[0].ID
	settled := bankSeedPosting("Settled", "prime_card", "10", false)
	summary := applyDirectives(t, database, []BankDirective{{Convert: &BankConvert{
		ID:      id,
		Posting: settled,
		AddKeys: bankKeys(SourceSimpleFIN, "bridge-prime", "post1"),
	}}})
	if summary.SettledConverted != 1 {
		t.Fatalf("convert = %+v", summary)
	}
	after, err := database.LoadDocument()
	if err != nil || len(after.Postings) != 1 {
		t.Fatal("convert changed row count")
	}
	row := after.Postings[0]
	if row.ID != id || row.Name != "Settled" || row.Pending || row.Source != SourceSimpleFIN {
		t.Fatalf("converted row = %+v", row)
	}
	rows, err := database.LoadBankPostings()
	if err != nil || len(rows) != 1 || len(rows[0].Keys) != 1 || rows[0].Keys[0].TransactionID != "post1" {
		t.Fatalf("keys after rotation = %+v, %v", rows, err)
	}
}

func TestBankVoidFlipsOnceAndIgnoresMissing(t *testing.T) {
	database := openSQLiteStore(t)
	seedModelAccount(t, database, "prime_card")
	applyDirectives(t, database, []BankDirective{{Upsert: &BankUpsert{
		Posting: bankSeedPosting("Pending", "prime_card", "10", true),
		Keys:    bankKeys(SourceSimpleFIN, "bridge-prime", "pend1"),
	}}})
	loaded, err := database.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	id := loaded.Postings[0].ID
	first := applyDirectives(t, database, []BankDirective{{Void: id}})
	if first.PendingDeleted != 1 {
		t.Fatalf("void = %+v", first)
	}
	second := applyDirectives(t, database, []BankDirective{{Void: id}})
	if second.PendingDeleted != 0 {
		t.Fatalf("repeat void churned: %+v", second)
	}
	after, err := database.LoadDocument()
	if err != nil || len(after.Postings) != 1 || after.Postings[0].Pending || !after.Postings[0].Void {
		t.Fatalf("void row = %+v, %v", after, err)
	}
}

func TestBankDirectivesRejectInvalidInput(t *testing.T) {
	database := openSQLiteStore(t)
	seedModelAccount(t, database, "prime_card")
	for name, directives := range map[string][]BankDirective{
		"empty":   {{}},
		"no keys": {{Upsert: &BankUpsert{Posting: bankSeedPosting("C", "prime_card", "10", true)}}},
		"bad key": {{Upsert: &BankUpsert{Posting: bankSeedPosting("C", "prime_card", "10", true), Keys: []BankKey{{Provider: "x"}}}}},
		"user source": {{Upsert: &BankUpsert{Posting: func() types.Posting {
			p := bankSeedPosting("C", "prime_card", "10", true)
			p.Source = SourceUser
			return p
		}(), Keys: bankKeys(SourceSimpleFIN, "bridge-prime", "pend1")}}},
		"no account": {{Upsert: &BankUpsert{Posting: func() types.Posting {
			p := bankSeedPosting("C", "prime_card", "10", true)
			p.SourceAccountID = nil
			return p
		}(), Keys: bankKeys(SourceSimpleFIN, "bridge-prime", "pend1")}}},
		"convert miss": {{Convert: &BankConvert{ID: "missing", Posting: bankSeedPosting("C", "prime_card", "10", false)}}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := database.ApplySyncPlan(nil, directives); err == nil {
				t.Fatalf("%s accepted", name)
			}
		})
	}
}
