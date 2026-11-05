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
		Source:          SourceBankSync,
		SourceAccountID: source,
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      1785628800,
		TransactionTime: 1785628800,
		Enabled:         !pending,
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
	summary, err := database.ApplySync(nil, directives)
	if err != nil {
		t.Fatalf("apply = %v", err)
	}
	return summary
}

func TestClaimedPendingSurvivesBankRefresh(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	upsert := bankUpsertDirective(bankSeedPosting("Corner Store", "prime_card", "42.10", true), ProviderSimpleFIN, "bridge-prime", "pend1")
	if first := applyDirectives(t, database, []BankDirective{upsert}); first.PendingInserted != 1 {
		t.Fatalf("seed = %+v", first)
	}
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Postings) != 1 {
		t.Fatalf("rows = %+v, err %v", loaded, err)
	}
	id := loaded.Postings[0].ID
	if _, err := database.CreateSchedule(testRuleFixture("rent")); err != nil {
		t.Fatalf("rule = %v", err)
	}
	if _, err := database.SetPostingClaims([]types.PostingClaimUpdate{{
		PostingID: id,
		Claim:     types.PostingClaim{ScheduleID: "rent", OccurrenceDate: "2026-08-02"},
	}}); err != nil {
		t.Fatalf("claim = %v", err)
	}
	// The bank still shows the authorization as pending: the refresh must
	// not demote the claimed occurrence back to a disabled seed.
	if second := applyDirectives(t, database, []BankDirective{upsert}); second.PendingUpdated != 1 {
		t.Fatalf("refresh = %+v", second)
	}
	after, err := database.LoadModel()
	if err != nil || len(after.Postings) != 1 {
		t.Fatalf("rows = %+v, err %v", after, err)
	}
	row := after.Postings[0]
	if row.ID != id {
		t.Fatalf("refresh changed identity: %s", row.ID)
	}
	if row.Pending || !row.Enabled {
		t.Fatalf("claimed row demoted by refresh: %+v", row)
	}
	if row.Claim == nil || row.Claim.ScheduleID != "rent" {
		t.Fatalf("claim lost on refresh: %+v", row)
	}
}

func TestConvertPreservesOccurrenceClaim(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	applyDirectives(t, database, []BankDirective{bankUpsertDirective(
		bankSeedPosting("Corner Store", "prime_card", "42.10", true), ProviderSimpleFIN, "bridge-prime", "pend1")})
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Postings) != 1 {
		t.Fatalf("rows = %+v, err %v", loaded, err)
	}
	id := loaded.Postings[0].ID
	if _, err := database.CreateSchedule(testRuleFixture("rent")); err != nil {
		t.Fatalf("rule = %v", err)
	}
	if _, err := database.SetPostingClaims([]types.PostingClaimUpdate{{
		PostingID: id,
		Claim:     types.PostingClaim{ScheduleID: "rent", OccurrenceDate: "2026-08-02"},
	}}); err != nil {
		t.Fatalf("claim = %v", err)
	}
	settled := bankSeedPosting("Corner Store", "prime_card", "42.10", false)
	summary := applyDirectives(t, database, []BankDirective{{Convert: &BankConvert{
		ID:      id,
		Posting: settled,
		AddKeys: bankKeys(ProviderSimpleFIN, "bridge-prime", "post1"),
	}}})
	if summary.SettledConverted != 1 {
		t.Fatalf("convert = %+v", summary)
	}
	after, err := database.LoadModel()
	if err != nil || len(after.Postings) != 1 {
		t.Fatalf("rows = %+v, err %v", after, err)
	}
	row := after.Postings[0]
	if row.ID != id || row.Pending || !row.Enabled {
		t.Fatalf("converted row = %+v", row)
	}
	if row.Claim == nil || row.Claim.ScheduleID != "rent" {
		t.Fatalf("claim lost on convert: %+v", row)
	}
	bank, err := database.LoadBankPostings()
	if err != nil || len(bank) != 1 || len(bank[0].Keys) != 1 || bank[0].Keys[0].TransactionID != "post1" {
		t.Fatalf("keys after rotation = %+v, %v", bank, err)
	}
}

func TestClaimPendingPromotesPostedTime(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	// Pending seeds carry no posted time; the bank only stamps the
	// authorization instant.
	seed := bankSeedPosting("Bistro", "prime_card", "50.00", true)
	seed.PostedTime = 0
	applyDirectives(t, database, []BankDirective{bankUpsertDirective(seed, ProviderSimpleFIN, "bridge-prime", "pend1")})
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Postings) != 1 {
		t.Fatalf("rows = %+v, err %v", loaded, err)
	}
	if _, err := database.CreateSchedule(testRuleFixture("dining")); err != nil {
		t.Fatalf("rule = %v", err)
	}
	claimed := loaded.Postings[0]
	claimed.Claim = &types.PostingClaim{ScheduleID: "dining", OccurrenceDate: "2026-08-02"}
	updated, err := database.UpdatePosting(claimed)
	if err != nil {
		t.Fatalf("claim = %v", err)
	}
	if updated.Pending || !updated.Enabled {
		t.Fatalf("claimed row = %+v", updated)
	}
	// The promotion takes the bank's transaction instant so the recorded
	// occurrence carries a positive posted time.
	if updated.PostedTime != updated.TransactionTime || updated.PostedTime <= 0 {
		t.Fatalf("posted time not promoted: %+v", updated)
	}
	if updated.Claim == nil || updated.Claim.ScheduleID != "dining" {
		t.Fatalf("claim lost: %+v", updated)
	}
}

func TestBankUpsertInsertsAndUpdatesByKey(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	upsert := BankDirective{Upsert: &BankUpsert{
		Posting: bankSeedPosting("Corner Store", "prime_card", "42.10", true),
		Keys:    bankKeys(ProviderSimpleFIN, "bridge-prime", "pend1"),
	}}
	first := applyDirectives(t, database, []BankDirective{upsert})
	if first.PendingInserted != 1 {
		t.Fatalf("insert = %+v", first)
	}
	before, err := database.LoadModel()
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
	after, err := database.LoadModel()
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
	seedAccount(t, database, "prime_card")
	applyDirectives(t, database, []BankDirective{{Upsert: &BankUpsert{
		Posting: bankSeedPosting("Pending", "prime_card", "10", true),
		Keys:    bankKeys(ProviderSimpleFIN, "bridge-prime", "pend1"),
	}}})
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Postings) != 1 {
		t.Fatal("seed missing")
	}
	id := loaded.Postings[0].ID
	settled := bankSeedPosting("Settled", "prime_card", "10", false)
	summary := applyDirectives(t, database, []BankDirective{{Convert: &BankConvert{
		ID:      id,
		Posting: settled,
		AddKeys: bankKeys(ProviderSimpleFIN, "bridge-prime", "post1"),
	}}})
	if summary.SettledConverted != 1 {
		t.Fatalf("convert = %+v", summary)
	}
	after, err := database.LoadModel()
	if err != nil || len(after.Postings) != 1 {
		t.Fatal("convert changed row count")
	}
	row := after.Postings[0]
	if row.ID != id || row.Name != "Settled" || row.Pending || row.Source != SourceBankSync || !row.Enabled {
		t.Fatalf("converted row = %+v", row)
	}
	rows, err := database.LoadBankPostings()
	if err != nil || len(rows) != 1 || len(rows[0].Keys) != 1 || rows[0].Keys[0].TransactionID != "post1" {
		t.Fatalf("keys after rotation = %+v, %v", rows, err)
	}
}

func TestBankVoidFlipsOnceAndIgnoresMissing(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	posting := bankSeedPosting("Pending", "prime_card", "10", true)
	posting.Enabled = true
	applyDirectives(t, database, []BankDirective{{Upsert: &BankUpsert{
		Posting: posting,
		Keys:    bankKeys(ProviderSimpleFIN, "bridge-prime", "pend1"),
	}}})
	loaded, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if !loaded.Postings[0].Enabled {
		t.Fatal("void transition must start with an enabled posting")
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
	after, err := database.LoadModel()
	if err != nil || len(after.Postings) != 1 || after.Postings[0].Pending || !after.Postings[0].Void || after.Postings[0].Enabled {
		t.Fatalf("void row = %+v, %v", after, err)
	}
}

func TestDeletePostingSuppressesBankKeysAcrossSyncs(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	upsert := bankUpsertDirective(bankSeedPosting("Corner Store", "prime_card", "42.10", false), ProviderSimpleFIN, "bridge-prime", "post1")
	if first := applyDirectives(t, database, []BankDirective{upsert}); first.SettledInserted != 1 {
		t.Fatalf("seed = %+v", first)
	}
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Postings) != 1 {
		t.Fatalf("rows = %+v, err %v", loaded, err)
	}
	// Removing a bank row records its bank ids: the next feed carries the
	// same charge, and apply skips it instead of resurrecting the row.
	if err := database.DeletePosting(loaded.Postings[0].ID); err != nil {
		t.Fatalf("delete = %v", err)
	}
	if got := countRows(t, database, "suppressed_sync_keys", ""); got != 1 {
		t.Fatalf("suppressions = %d, want the removed key", got)
	}
	second := applyDirectives(t, database, []BankDirective{upsert})
	if second != (SyncApplySummary{}) {
		t.Fatalf("resupply counted: %+v", second)
	}
	if got := countRows(t, database, "postings", ""); got != 0 {
		t.Fatalf("resupply resurrected %d rows", got)
	}
	// Suppression is per key: an unrelated charge still imports.
	other := bankUpsertDirective(bankSeedPosting("Bistro", "prime_card", "58.00", false), ProviderSimpleFIN, "bridge-prime", "post2")
	if third := applyDirectives(t, database, []BankDirective{other}); third.SettledInserted != 1 {
		t.Fatalf("unrelated = %+v", third)
	}
}

func TestDeleteOwnerPostingSuppressesNothing(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	created, err := database.CreatePosting(types.Posting{
		Name:            "Manual",
		SourceAccountID: &[]string{"prime_card"}[0],
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      1785628800,
		TransactionTime: 1785628800,
		Enabled:         true,
	})
	if err != nil {
		t.Fatalf("create = %v", err)
	}
	if err := database.DeletePosting(created.ID); err != nil {
		t.Fatalf("delete = %v", err)
	}
	if got := countRows(t, database, "suppressed_sync_keys", ""); got != 0 {
		t.Fatalf("owner delete suppressed %d keys", got)
	}
}

func TestDeleteVoidSuppressesNothingAndSameKeyStillImports(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	upsert := bankUpsertDirective(bankSeedPosting("Corner Store", "prime_card", "42.10", true), ProviderSimpleFIN, "bridge-prime", "pend1")
	applyDirectives(t, database, []BankDirective{upsert})
	loaded, err := database.LoadModel()
	if err != nil || len(loaded.Postings) != 1 {
		t.Fatalf("rows = %+v, err %v", loaded, err)
	}
	id := loaded.Postings[0].ID
	if first := applyDirectives(t, database, []BankDirective{{Void: id}}); first.PendingDeleted != 1 {
		t.Fatalf("void = %+v", first)
	}
	// Removing a void hold records nothing: its keys already left the
	// feed, and the auth key stays usable for same-key settlement.
	if err := database.DeletePosting(id); err != nil {
		t.Fatalf("delete = %v", err)
	}
	if got := countRows(t, database, "suppressed_sync_keys", ""); got != 0 {
		t.Fatalf("void delete suppressed %d keys", got)
	}
	if second := applyDirectives(t, database, []BankDirective{upsert}); second.PendingInserted != 1 {
		t.Fatalf("re-authorized hold skipped: %+v", second)
	}
}

func TestBankConvertSkipsRemovedRow(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	// A conversion racing a removal lands nowhere: the removal stands,
	// and the sync stays green.
	summary, err := database.ApplySync(nil, []BankDirective{{
		Convert: &BankConvert{ID: "missing", Posting: bankSeedPosting("C", "prime_card", "10", false)},
	}})
	if err != nil {
		t.Fatalf("convert of removed row errored: %v", err)
	}
	if summary != (SyncApplySummary{}) {
		t.Fatalf("convert of removed row counted: %+v", summary)
	}
}

func TestBankDirectivesRejectInvalidInput(t *testing.T) {
	database := openSQLiteStore(t)
	seedAccount(t, database, "prime_card")
	for name, directives := range map[string][]BankDirective{
		"empty":   {{}},
		"no keys": {{Upsert: &BankUpsert{Posting: bankSeedPosting("C", "prime_card", "10", true)}}},
		"bad key": {{Upsert: &BankUpsert{Posting: bankSeedPosting("C", "prime_card", "10", true), Keys: []BankKey{{Provider: "x"}}}}},
		"user source": {{Upsert: &BankUpsert{Posting: func() types.Posting {
			p := bankSeedPosting("C", "prime_card", "10", true)
			p.Source = SourceUser
			return p
		}(), Keys: bankKeys(ProviderSimpleFIN, "bridge-prime", "pend1")}}},
		"no account": {{Upsert: &BankUpsert{Posting: func() types.Posting {
			p := bankSeedPosting("C", "prime_card", "10", true)
			p.SourceAccountID = nil
			return p
		}(), Keys: bankKeys(ProviderSimpleFIN, "bridge-prime", "pend1")}}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := database.ApplySync(nil, directives); err == nil {
				t.Fatalf("%s accepted", name)
			}
		})
	}
}
