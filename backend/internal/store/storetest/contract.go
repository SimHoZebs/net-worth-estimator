// Package storetest provides the conformance gate for every Store adapter.
package storetest

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const receiptTransactionID = "01900000-0000-7000-8000-000000000099"

// Run proves any Store implementation honors the persistence contract using
// only the public interface: no SQL, no file paths, no implementation types.
// A replacement backend (Turso, Postgres, CSV files, S3 blobs, a human with
// paper and mic, …) earns the Store name by calling this with its own factory:
//
//	func TestTursoConformance(t *testing.T) {
//		storetest.Run(t, openTursoTestStore)
//	}
//
// SQLite-only concerns (schema shape, raw scripts, file layout) stay in the
// sqlite adapter tests.
func Run(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	t.Run("PlannedPurchases", func(t *testing.T) { testPlannedPurchases(t, newStore) })
	t.Run("ReceiptEvidence", func(t *testing.T) { testReceiptConformance(t, newStore) })
	t.Run("AnalysisEvidence", func(t *testing.T) { testAnalysisConformance(t, newStore) })
	t.Run("InitializeModel", func(t *testing.T) {
		testInitializeModel(t, newStore)
	})
	t.Run("RoundTripsCanonicalModelMetadataAndOrder", func(t *testing.T) {
		testStoreRoundTripsCanonicalModelMetadataAndOrder(t, newStore)
	})
	t.Run("RowWritesUseStoredSyncOwnership", func(t *testing.T) {
		testRowWritesUseStoredSyncOwnership(t, newStore)
	})
	t.Run("OwnerCheckpointWinsKeyCollision", func(t *testing.T) {
		testOwnerCheckpointWinsKeyCollision(t, newStore)
	})
	t.Run("RowRoundTripsPreserveOrder", func(t *testing.T) {
		testRowRoundTripsPreserveOrder(t, newStore)
	})
	t.Run("ApplySyncCheckpointLifecycle", func(t *testing.T) {
		testApplySyncCheckpointLifecycle(t, newStore)
	})
	t.Run("ApplySyncSkipsUserCheckpoint", func(t *testing.T) {
		testApplySyncSkipsUserCheckpoint(t, newStore)
	})
	t.Run("TimestampedCheckpointsPreserveMultipleObservationsPerDay", func(t *testing.T) {
		testTimestampedCheckpointsPreserveMultipleObservationsPerDay(t, newStore)
	})
	t.Run("ApplySyncRetainsBackdatedObservation", func(t *testing.T) {
		testApplySyncRetainsBackdatedObservation(t, newStore)
	})
	t.Run("ApplySyncOwnerWinsSameInstant", func(t *testing.T) {
		testApplySyncOwnerWinsSameInstant(t, newStore)
	})
	t.Run("ApplySyncRejectsCheckpointsWithoutProviderSource", func(t *testing.T) {
		testApplySyncRejectsCheckpointsWithoutProviderSource(t, newStore)
	})
	t.Run("ApplySyncKeepsProviderCheckpointIdentity", func(t *testing.T) {
		testApplySyncKeepsProviderCheckpointIdentity(t, newStore)
	})
	t.Run("SettledBankRowRoundTrip", func(t *testing.T) {
		testSettledBankRowRoundTrip(t, newStore)
	})
	t.Run("ApplySyncRefreshesPendingSnapshot", func(t *testing.T) {
		testApplySyncRefreshesPendingSnapshot(t, newStore)
	})
	t.Run("ArtifactsRoundTripAndKeepFirstWrite", func(t *testing.T) {
	})
	t.Run("SyncStateDefaultsEmptyAndRoundTrips", func(t *testing.T) {
		testSyncStateDefaultsEmptyAndRoundTrips(t, newStore)
	})
	t.Run("SyncCredentialRoundTripAndClear", func(t *testing.T) {
		testSyncCredentialConformance(t, newStore)
	})
	t.Run("GmailCredentialRoundTripAndClear", func(t *testing.T) {
		testGmailCredentialConformance(t, newStore)
	})
	t.Run("EmailReceiptRoundTripReviewAndClear", func(t *testing.T) {
		testEmailReceiptConformance(t, newStore)
	})
	t.Run("AmountPresetsRoundTripAndReorder", func(t *testing.T) {
		testAmountPresetConformanceRoundTrip(t, newStore)
	})
}

func testSyncCredentialConformance(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	database := newStore(t)
	credential, err := database.GetSyncCredential()
	if err != nil || credential.Configured() {
		t.Fatalf("default credential = %+v, err %v", credential, err)
	}
	if _, err := database.SetSyncCards([]string{"prime_card"}); err != nil {
		t.Fatalf("set cards: %v", err)
	}
	if _, err := database.SetSyncCredential("https://user:pass@bridge.example/simplefin", "bridge.example"); err != nil {
		t.Fatalf("set credential: %v", err)
	}
	loaded, err := database.GetSyncCredential()
	if err != nil || !loaded.Configured() || loaded.BridgeHost != "bridge.example" {
		t.Fatalf("loaded = %+v, err %v", loaded, err)
	}
	if len(loaded.CardAccounts) != 1 || loaded.CardAccounts[0] != "prime_card" {
		t.Fatalf("cards after credential set = %+v", loaded.CardAccounts)
	}
	if err := database.ClearSyncCredential(); err != nil {
		t.Fatalf("clear credential: %v", err)
	}
	cleared, err := database.GetSyncCredential()
	if err != nil || cleared.Configured() {
		t.Fatalf("cleared = %+v, err %v", cleared, err)
	}
	if cards, err := database.GetSyncCards(); err != nil || len(cards) != 1 || cards[0] != "prime_card" {
		t.Fatalf("cards after disconnect = %+v, err %v, want [prime_card]", cards, err)
	}
	if err := database.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	after, err := database.GetSyncCredential()
	if err != nil || after.Configured() {
		t.Fatalf("credential after Clear = %+v, err %v", after, err)
	}
	if cards, err := database.GetSyncCards(); err != nil || len(cards) != 0 {
		t.Fatalf("cards after Clear = %+v, err %v, want forgotten", cards, err)
	}
}

func testGmailCredentialConformance(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	database := newStore(t)
	credential, err := database.GetGmailCredential()
	if err != nil || credential.Connected() {
		t.Fatalf("default gmail credential = %+v, err %v", credential, err)
	}
	if credential.LookbackDays != store.DefaultGmailLookbackDays {
		t.Fatalf("default lookback = %d, want %d", credential.LookbackDays, store.DefaultGmailLookbackDays)
	}
	if _, err := database.SetGmailLookback(30); err != nil {
		t.Fatalf("set lookback: %v", err)
	}
	connected, err := database.ConnectGmail(store.GmailCredential{
		RefreshToken: "refresh-alice", AccessToken: "access-alice",
		AccessExpiryUnix: 2_000_000_000, EmailAddress: "alice@example.com",
		Scopes: "gmail.readonly",
	})
	if err != nil || !connected.Connected() {
		t.Fatalf("connected = %+v, err %v", connected, err)
	}
	if connected.EmailAddress != "alice@example.com" || connected.ConnectedAt == "" {
		t.Fatalf("connected = %+v, want account display and connection time", connected)
	}
	if connected.LookbackDays != 30 {
		t.Fatalf("lookback after connect = %d, want kept 30", connected.LookbackDays)
	}
	if connected.PendingState != "" {
		t.Fatalf("pending state after connect = %q, want cleared", connected.PendingState)
	}
	rotated, err := database.UpdateGmailToken("access-alice-2", 2_000_003_600, "")
	if err != nil || rotated.AccessToken != "access-alice-2" || rotated.RefreshToken != "refresh-alice" {
		t.Fatalf("rotated = %+v, err %v, want new access with kept refresh", rotated, err)
	}
	if _, err := database.SetGmailScanCursor("history-9", "2026-10-26T00:00:00Z"); err != nil {
		t.Fatalf("set cursor: %v", err)
	}
	cursor, err := database.GetGmailCredential()
	if err != nil || cursor.LastHistoryID != "history-9" || cursor.LastScanAt != "2026-10-26T00:00:00Z" {
		t.Fatalf("cursor = %+v, err %v", cursor, err)
	}
	if err := database.ClearGmailCredential(); err != nil {
		t.Fatalf("clear gmail: %v", err)
	}
	cleared, err := database.GetGmailCredential()
	if err != nil || cleared.Connected() || cleared.EmailAddress != "" || cleared.LastHistoryID != "" {
		t.Fatalf("cleared = %+v, err %v, want disconnected without account or cursor", cleared, err)
	}
	if cleared.LookbackDays != 30 {
		t.Fatalf("lookback after disconnect = %d, want kept 30", cleared.LookbackDays)
	}
	if _, err := database.ConnectGmail(store.GmailCredential{RefreshToken: "refresh-alice-2"}); err != nil {
		t.Fatalf("reconnect: %v", err)
	}
	if err := database.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	after, err := database.GetGmailCredential()
	if err != nil || after.Connected() {
		t.Fatalf("gmail after Clear = %+v, err %v", after, err)
	}
}

func testEmailReceiptConformance(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	database := newStore(t)
	if scanned, err := database.IsGmailMessageScanned("msg-1"); err != nil || scanned {
		t.Fatalf("scanned = %v, err %v, want false before triage", scanned, err)
	}
	amount := int64(4250)
	confidence := 0.95
	saved, err := database.SaveEmailReceipt(store.EmailReceipt{
		GmailMessageID: "msg-1", ThreadID: "thread-1",
		FromAddress: "Example Store <receipts@example.com>", Subject: "Your order confirmation",
		MessageDate: "2026-10-20T15:04:05Z",
		Verdict:     store.EmailReceiptVerdictReceipt,
		Merchant:    "Example Store", ReceiptDate: "2026-10-20",
		AmountText: "$42.50", AmountCents: &amount, Currency: "USD", Reference: "AB-12345",
		Confidence:  &confidence,
		Diagnostics: []string{},
		Provenance:  store.ReceiptProvenanceForEmail(),
		Status:      store.EmailReceiptStatusReady,
	})
	if err != nil || saved.ID == "" {
		t.Fatalf("saved = %+v, err %v", saved, err)
	}
	if saved.Provenance.Producer == "" || saved.Provenance.Version == "" {
		t.Fatalf("saved = %+v, want source provenance", saved)
	}
	if scanned, err := database.IsGmailMessageScanned("msg-1"); err != nil || !scanned {
		t.Fatalf("scanned = %v, err %v, want true after triage", scanned, err)
	}
	// A repeat scan keeps the first extraction: no duplicate row.
	weaker := confidence - 0.4
	repeat, err := database.SaveEmailReceipt(store.EmailReceipt{
		GmailMessageID: "msg-1", Verdict: store.EmailReceiptVerdictReceipt,
		Merchant: "Other", Confidence: &weaker, Status: store.EmailReceiptStatusNeedsReview,
	})
	if err != nil || repeat.ID != saved.ID || repeat.Merchant != "Example Store" {
		t.Fatalf("repeat = %+v, err %v, want first extraction kept", repeat, err)
	}
	if _, err := database.SaveEmailReceipt(store.EmailReceipt{
		GmailMessageID: "msg-2", Verdict: store.EmailReceiptVerdictShipping,
		Status: store.EmailReceiptStatusReady,
	}); err != nil {
		t.Fatalf("shipping triage: %v", err)
	}
	reviewed, err := database.ReviewEmailReceipt(saved.ID, &store.EmailReceiptCorrection{Reference: "AB-12345-CORRECTED"})
	if err != nil || reviewed.Status != store.EmailReceiptStatusConfirmed {
		t.Fatalf("reviewed = %+v, err %v, want confirmed", reviewed, err)
	}
	if reviewed.Correction == nil || reviewed.Correction.Reference != "AB-12345-CORRECTED" {
		t.Fatalf("reviewed = %+v, want correction overlay", reviewed)
	}
	if reviewed.Reference != "AB-12345" || reviewed.Merchant != "Example Store" {
		t.Fatalf("reviewed = %+v, want original extraction preserved", reviewed)
	}
	needsReview, err := database.ListEmailReceipts(store.EmailReceiptFilter{Status: []string{store.EmailReceiptStatusConfirmed}})
	if err != nil || len(needsReview) != 1 {
		t.Fatalf("filtered = %+v, err %v, want 1 confirmed", needsReview, err)
	}
	all, err := database.ListEmailReceipts(store.EmailReceiptFilter{})
	if err != nil || len(all) != 2 {
		t.Fatalf("all = %d, err %v, want 2 triage rows", len(all), err)
	}
	if _, err := database.ReviewEmailReceipt("missing", nil); err == nil {
		t.Fatal("review of a missing receipt succeeds")
	}
	if _, err := database.GetEmailReceipt("missing"); err == nil {
		t.Fatal("read of a missing receipt succeeds")
	}
	if _, err := database.SaveEmailReceipt(store.EmailReceipt{}); err == nil {
		t.Fatal("save without a message ID succeeds")
	}
	if _, err := database.SaveEmailReceipt(store.EmailReceipt{GmailMessageID: "msg-3", Verdict: "bogus", Status: store.EmailReceiptStatusReady}); err == nil {
		t.Fatal("save with a bogus verdict succeeds")
	}
	if err := database.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	after, err := database.ListEmailReceipts(store.EmailReceiptFilter{})
	if err != nil || len(after) != 0 {
		t.Fatalf("receipts after Clear = %d, err %v, want none", len(after), err)
	}
}

func testInitializeModel(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	database := newStore(t)
	if model, err := database.LoadModel(); err != nil || model != nil {
		t.Fatalf("uninitialized model = %+v, %v", model, err)
	}
	for range 2 {
		if err := database.InitializeModel(); err != nil {
			t.Fatal(err)
		}
	}
	if exists, err := database.ModelExists(); err != nil || !exists {
		t.Fatalf("initialized presence = %v, %v", exists, err)
	}
	model, err := database.LoadModel()
	if err != nil || model == nil || len(model.Accounts) != 0 || model.SourcePath != "" {
		t.Fatalf("blank model = %+v, %v", model, err)
	}
	if _, err := database.CreateAccount(types.Account{ID: "checking", Name: "My checking", Kind: "cash", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	before, err := database.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if err := database.InitializeModel(); err != nil {
		t.Fatal(err)
	}
	after, err := database.LoadModel()
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("initialization changed existing model: %+v, %v", after, err)
	}
}

func testAmountPresetConformanceRoundTrip(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	st := newStore(t)
	created, err := st.CreateAmountPreset(testPresetFixture("conformance"))
	if err != nil {
		t.Fatalf("create preset: %v", err)
	}
	presets, err := st.ListAmountPresets()
	if err != nil {
		t.Fatalf("list presets: %v", err)
	}
	found := false
	for _, preset := range presets {
		if preset.ID == created.ID {
			found = true
			if preset.Label != "Label conformance" {
				t.Fatalf("preset label = %q", preset.Label)
			}
		}
	}
	if !found {
		t.Fatal("created preset missing from list")
	}
	created.Summary = "updated"
	updated, err := st.UpdateAmountPreset(created)
	if err != nil || updated.Summary != "updated" {
		t.Fatalf("update preset = %+v, err %v", updated, err)
	}
	if err := st.MoveAmountPreset(created.ID, ""); err != nil {
		t.Fatalf("move preset: %v", err)
	}
	if err := st.DeleteAmountPreset(created.ID); err != nil {
		t.Fatalf("delete preset: %v", err)
	}
}

func testPresetFixture(name string) types.AmountPreset {
	return types.AmountPreset{
		Name: name, Label: "Label " + name, Enabled: true,
		Amount: types.TransactionAmountResolution{
			Resolver: "expression",
			Config:   map[string]any{"expression": "10"},
			Inputs:   map[string]types.AmountInputBinding{},
		},
	}
}

func testReceiptConformance(t *testing.T, newStore func(*testing.T) store.Store) {
	s := newStore(t)
	p := seedReceiptTransaction(t, s)
	r, err := s.CreateReceipt(context.Background(), p.ID, "receipt.png", types.ReceiptImage{Bytes: []byte("pixels"), MediaType: "image/png"})
	if err != nil {
		t.Fatal(err)
	}
	list, err := s.ListReceipts(p.ID)
	if err != nil || len(list) != 1 || list[0].ID != r.ID {
		t.Fatalf("receipt list: %+v %v", list, err)
	}
	r.Draft = &types.ReceiptDetails{Merchant: "Draft"}
	r, err = s.SaveReceipt(r, r.Revision)
	if err != nil || r.Revision != 2 {
		t.Fatalf("receipt review: %+v %v", r, err)
	}
	if _, err := s.SaveReceipt(r, 1); !errors.Is(err, store.ErrReceiptConflict) {
		t.Fatalf("stale review: %v", err)
	}
	p.Name = "Updated"
	if _, err := s.UpdateTransaction(p); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetReceipt(r.ID); err != nil {
		t.Fatal("transaction update removed evidence", err)
	}
	r, err = s.ReplaceReceiptImage(context.Background(), r.ID, r.Revision, "replacement.png", types.ReceiptImage{Bytes: []byte("new pixels"), MediaType: "image/png"})
	if err != nil || r.Draft != nil || r.Status != "attached" {
		t.Fatalf("replacement: %+v %v", r, err)
	}
	if err := s.DeleteReceipt(context.Background(), r.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetReceiptImage(context.Background(), r.ID); !errors.Is(err, store.ErrReceiptNotFound) {
		t.Fatal(err)
	}
}

func seedReceiptTransaction(t *testing.T, s store.Store) types.Transaction {
	t.Helper()
	seedAccount(t, s, "checking")
	p, err := s.CreateTransaction(testTransactionFixture(receiptTransactionID))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func testRowRoundTripsPreserveOrder(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	st := newStore(t)
	for _, id := range []string{"a", "b", "c"} {
		if _, err := st.CreateAccount(types.Account{ID: id, Name: id}); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
	}
	if err := st.MoveAccount("c", "a"); err != nil {
		t.Fatalf("move: %v", err)
	}
	loaded, err := st.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	var order []string
	for _, account := range loaded.Accounts {
		order = append(order, account.ID)
	}
	if !reflect.DeepEqual(order, []string{"c", "a", "b"}) {
		t.Fatalf("order = %v, want [c a b]", order)
	}
}

func testTransactionFixture(id string) types.Transaction {
	source := "checking"
	return types.Transaction{
		ID:              id,
		Name:            "Transaction " + id,
		SourceAccountID: &source,
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      1782950400, TransactionTime: 1782950400,
		Enabled: true,
	}
}

func testStoreRoundTripsCanonicalModelMetadataAndOrder(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	st := newStore(t)
	if _, err := st.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatalf("create account: %v", err)
	}
	for _, checkpoint := range []types.Checkpoint{
		{ObservedAt: 1777593599, AccountID: "checking", Balance: 200},
		{ObservedAt: 1775519999, AccountID: "checking", Balance: 100},
	} {
		if _, err := st.SaveCheckpoint(checkpoint); err != nil {
			t.Fatalf("save checkpoint: %v", err)
		}
	}
	loaded, err := st.LoadModel()
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	if loaded == nil {
		t.Fatal("loaded model is nil")
	}
	if !reflect.DeepEqual(loaded.Checkpoints, withSourceUser([]types.Checkpoint{
		{ObservedAt: 1777593599, AccountID: "checking", Balance: 200},
		{ObservedAt: 1775519999, AccountID: "checking", Balance: 100},
	})) {
		t.Fatalf("checkpoint order changed: got %+v", loaded.Checkpoints)
	}
	if loaded.Accounts[0].MinBalance == nil || *loaded.Accounts[0].MinBalance != types.NoFloor {
		t.Fatalf("minimum balance was not normalized: %+v", loaded.Accounts[0].MinBalance)
	}
	if loaded.Accounts[0].MaxBalance == nil || *loaded.Accounts[0].MaxBalance != types.NoCeiling {
		t.Fatalf("maximum balance was not normalized: %+v", loaded.Accounts[0].MaxBalance)
	}

	empty, err := st.LoadModel()
	if err != nil || empty == nil {
		t.Fatalf("load model = %+v, err %v", empty, err)
	}
	if empty.Accounts == nil || empty.Checkpoints == nil || empty.Transactions == nil {
		t.Fatalf("empty collections were not normalized: %+v", empty)
	}

	if err := st.Clear(); err != nil {
		t.Fatalf("clear model: %v", err)
	}
	exists, err := st.ModelExists()
	if err != nil || exists {
		t.Fatalf("cleared model presence = %v, err %v", exists, err)
	}
	loaded, err = st.LoadModel()
	if err != nil || loaded != nil {
		t.Fatalf("cleared model = %+v, err %v", loaded, err)
	}
}

func seedAccount(t *testing.T, st store.Store, id string) {
	t.Helper()
	if _, err := st.CreateAccount(types.Account{ID: id, Name: id, Enabled: true}); err != nil {
		t.Fatal(err)
	}
}

func testSyncStateDefaultsEmptyAndRoundTrips(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	database := newStore(t)
	if got, err := database.GetLastSyncTime(); err != nil || got != "" {
		t.Fatalf("fresh last sync = %q, err %v, want empty", got, err)
	}
	if err := database.SetLastSyncTime("2026-10-18T14:30:00Z"); err != nil {
		t.Fatalf("record last sync: %v", err)
	}
	if got, err := database.GetLastSyncTime(); err != nil || got != "2026-10-18T14:30:00Z" {
		t.Fatalf("last sync = %q, err %v, want recorded time", got, err)
	}
	if err := database.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if got, err := database.GetLastSyncTime(); err != nil || got != "" {
		t.Fatalf("cleared last sync = %q, err %v, want empty", got, err)
	}
}

func testRowWritesUseStoredSyncOwnership(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	st := newStore(t)
	seedOwnerModel(t, st)
	seedSyncState(t, st)

	// UUIDs carry no ownership meaning. Owner writes cannot assert sync metadata.
	forged := testTransactionFixture("01900000-0000-7000-8000-000000000013")
	forged.Source, forged.Pending = store.SourceBankSync, true
	created, err := st.CreateTransaction(forged)
	if err != nil || created.Source != store.SourceUser || created.Pending {
		t.Fatalf("owner transaction metadata = %+v, err %v", created, err)
	}

	// Bank rows are owner-editable including void rows, so the owner can
	// edit, un-void, or remove them.
	stored, err := st.LoadModel()
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	var synced types.Transaction
	for _, transaction := range stored.Transactions {
		if transaction.Source == store.SourceBankSync {
			synced = transaction
		}
	}
	// Void rows are owner-editable too. Clearing void restores the row.
	voided := synced
	if _, err := st.ApplySync(nil, []store.BankDirective{{Void: synced.ID}}); err != nil {
		t.Fatalf("void sync transaction: %v", err)
	}
	reloaded, err := st.LoadModel()
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	for _, transaction := range reloaded.Transactions {
		if transaction.ID == synced.ID {
			voided = transaction
		}
	}
	voided.Name = "Edited"
	if updated, err := st.UpdateTransaction(voided); err != nil {
		t.Fatalf("update void sync transaction err = %v, want editable", err)
	} else if updated.Name != "Edited" || updated.Void != true {
		t.Fatalf("void edit lost lifecycle: %+v", updated)
	}
	restored := voided
	restored.Void = false
	restored.Enabled = true
	if cleared, err := st.UpdateTransaction(restored); err != nil || cleared.Void {
		t.Fatalf("un-void err = %v, row = %+v", err, cleared)
	}
	// Pending and settled bank rows are owner-editable (including delete).

	// A checkpoint save with a forged source flag still stores owner rows.
	correction := types.Checkpoint{ObservedAt: 1782950399, AccountID: "checking", Balance: 500, Source: store.SourceBankSync}
	saved, err := st.SaveCheckpoint(correction)
	if err != nil {
		t.Fatalf("save checkpoint: %v", err)
	}
	if saved.Source != store.SourceUser {
		t.Fatalf("checkpoint source = %q, want recomputed owner", saved.Source)
	}
	loaded, err := st.LoadModel()
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	if len(loaded.Checkpoints) != 2 {
		t.Fatalf("checkpoints = %+v, want owner + synced", loaded.Checkpoints)
	}
	for _, checkpoint := range loaded.Checkpoints {
		if checkpoint.AccountID == "checking" && checkpoint.ObservedAt == 1782950399 && checkpoint.Source != store.SourceUser {
			t.Fatalf("forged checkpoint flag persisted: %+v", checkpoint)
		}
	}
	_, sources := loadTransactionIDs(t, st)
	if sources[synced.ID] != store.SourceBankSync {
		t.Fatalf("stored sync transaction lost flag: %v", sources)
	}
	if sources[ownerTransactionID] != store.SourceUser || sources[created.ID] != store.SourceUser {
		t.Fatalf("owner transaction flags = %v", sources)
	}
}

func testOwnerCheckpointWinsKeyCollision(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	st := newStore(t)
	seedOwnerModel(t, st)
	seedSyncState(t, st)

	if _, err := st.SaveCheckpoint(types.Checkpoint{
		ObservedAt: 1785628799, AccountID: "checking", Balance: 222,
	}); err != nil {
		t.Fatalf("save correction: %v", err)
	}

	loaded, err := st.LoadModel()
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	count := 0
	for _, checkpoint := range loaded.Checkpoints {
		if checkpoint.AccountID == "checking" && checkpoint.ObservedAt == 1785628799 {
			count++
			if checkpoint.Balance != 222 || checkpoint.Source != store.SourceUser {
				t.Fatalf("collision row = %+v, want owner correction", checkpoint)
			}
		}
	}
	if count != 1 {
		t.Fatalf("collision key rows = %d, want 1", count)
	}
}

func testApplySyncCheckpointLifecycle(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	st := newStore(t)
	// An owner model first, mirroring production (seeded DB): sync rows
	// merge into the visible model instead of an empty store.
	seedOwnerModel(t, st)
	seedAccount(t, st, "prime_card")

	summary, err := st.ApplySync(
		[]store.SyncCheckpoint{{AccountID: "checking", ObservedAt: 1785974399, Balance: 100, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN}},
		nil)
	if err != nil || summary.CheckpointsInserted != 1 {
		t.Fatalf("apply = %+v, err %v", summary, err)
	}

	again, err := st.ApplySync(
		[]store.SyncCheckpoint{{AccountID: "checking", ObservedAt: 1785974399, Balance: 100, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN}},
		nil)
	if err != nil || again.CheckpointsUpdated != 1 || again.CheckpointsInserted != 0 {
		t.Fatalf("rerun = %+v, err %v", again, err)
	}

	changed, err := st.ApplySync(
		[]store.SyncCheckpoint{{AccountID: "checking", ObservedAt: 1785974399, Balance: 150, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN}},
		nil)
	if err != nil || changed.CheckpointsUpdated != 1 {
		t.Fatalf("update = %+v, err %v", changed, err)
	}
	loaded, err := st.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	_ = loaded
	checkpoint, ok := findCheckpoint(loaded, "checking", 1785974399)
	if !ok || checkpoint.Balance != 150 || checkpoint.Source != store.SourceBankSync {
		t.Fatalf("checkpoint = %+v, want balance 150 source simplefin", checkpoint)
	}
}

func testApplySyncSkipsUserCheckpoint(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	st := newStore(t)
	seedOwnerModel(t, st)
	extra, err := st.SaveCheckpoint(types.Checkpoint{
		ObservedAt: 1785974399, AccountID: "checking", Balance: 999,
	})
	if err != nil {
		t.Fatalf("save user checkpoint: %v", err)
	}
	_ = extra
	summary, err := st.ApplySync(
		[]store.SyncCheckpoint{{AccountID: "checking", ObservedAt: 1785974399, Balance: 100, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN}},
		nil)
	if err != nil || summary.CheckpointsSkipped != 1 {
		t.Fatalf("apply = %+v, err %v", summary, err)
	}
	loaded, err := st.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	checkpoint, ok := findCheckpoint(loaded, "checking", 1785974399)
	if !ok || checkpoint.Balance != 999 {
		t.Fatalf("user checkpoint overwritten: %+v", checkpoint)
	}
}

func testApplySyncRefreshesPendingSnapshot(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	st := newStore(t)
	seedOwnerModel(t, st)
	seedAccount(t, st, "prime_card")

	first, err := st.ApplySync(nil, []store.BankDirective{
		syncPendingDirective(syncPendingTransaction("a", "prime_card", "2026-08-02")),
		syncPendingDirective(syncPendingTransaction("b", "prime_card", "2026-08-02")),
	})
	if err != nil || first.PendingInserted != 2 {
		t.Fatalf("first apply = %+v, err %v", first, err)
	}
	loaded, err := st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	for _, transaction := range loaded.Transactions {
		if transaction.Source == store.SourceBankSync && transaction.Pending {
			ids[transaction.Name] = transaction.ID
		}
	}
	if len(ids) != 2 {
		t.Fatalf("pending rows = %+v", loaded.Transactions)
	}
	second, err := st.ApplySync(nil, []store.BankDirective{
		syncPendingDirective(syncPendingTransaction("b", "prime_card", "2026-08-03")),
		syncPendingDirective(syncPendingTransaction("c", "prime_card", "2026-08-03")),
		{Void: ids["Pending a"]},
	})
	if err != nil || second.PendingDeleted != 1 || second.PendingInserted != 1 || second.PendingUpdated != 1 {
		t.Fatalf("second apply = %+v, err %v", second, err)
	}
	reloaded, err := st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	got := syncedPendingIDs(reloaded)
	if len(got) != 2 {
		t.Fatalf("pending rows = %+v, want b and c", got)
	}
	for _, transaction := range reloaded.Transactions {
		if transaction.ID == ids["Pending a"] {
			// A void transition stops participation: pending/void
			// rows are stored disabled, never as execution gates.
			if !transaction.Void || transaction.Pending || transaction.Enabled {
				t.Fatalf("voided row must stay disabled: %+v", transaction)
			}
		}
	}
	for _, id := range got {
		if _, err := uuid.Parse(id); err != nil {
			t.Fatalf("pending identity is not a UUID: %v", got)
		}
	}
}

func withSourceUser(checkpoints []types.Checkpoint) []types.Checkpoint {
	out := make([]types.Checkpoint, len(checkpoints))
	for i, checkpoint := range checkpoints {
		checkpoint.Source = store.SourceUser
		out[i] = checkpoint
	}
	return out
}

func syncPendingTransaction(id, accountID, day string) store.SyncTransaction {
	stamp, err := time.ParseInLocation("2006-01-02", day, time.UTC)
	if err != nil {
		stamp = time.Unix(1785628800, 0).UTC()
	}
	return store.SyncTransaction{
		ProviderAccountID: "bridge-" + accountID,
		TransactionID:     id,
		Transaction: types.Transaction{
			Name:            "Pending " + id,
			SourceAccountID: &accountID,
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      stamp.Unix(),
			TransactionTime: stamp.Unix(),
		},
	}
}

func syncPendingDirective(item store.SyncTransaction) store.BankDirective {
	item.Source = store.SourceBankSync
	item.Pending = true
	return store.BankDirective{Upsert: &store.BankUpsert{
		Transaction: item.Transaction,
		Keys:        []store.BankKey{{Provider: store.ProviderSimpleFIN, AccountID: item.ProviderAccountID, TransactionID: item.TransactionID}},
	}}
}

// testApplySyncRejectsCheckpointsWithoutProviderSource proves the
// boundary validates provenance: blank and owner sources are rejected, no
// provider is ever defaulted, and nothing is written.
func testApplySyncRejectsCheckpointsWithoutProviderSource(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	st := newStore(t)
	seedOwnerModel(t, st)
	for name, checkpoint := range map[string]store.SyncCheckpoint{
		"blank source":     {AccountID: "checking", Balance: 100, ObservedAt: 1785974399},
		"owner source":     {AccountID: "checking", Balance: 100, Source: store.SourceUser, ObservedAt: 1785974399},
		"missing provider": {AccountID: "checking", Balance: 100, Source: store.SourceBankSync, ObservedAt: 1785974399},
	} {
		if _, err := st.ApplySync([]store.SyncCheckpoint{checkpoint}, nil); err == nil {
			t.Fatalf("%s accepted without provider provenance", name)
		}
	}
	loaded, err := st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := findCheckpoint(loaded, "checking", 1785974399); ok {
		t.Fatalf("rejected checkpoint was written: %+v", loaded.Checkpoints)
	}
}

// testApplySyncKeepsProviderCheckpointIdentity proves repeat writes
// keep provider identity: the same provider refreshes its own checkpoint,
// while a different provider never overwrites it. Owner precedence stays
// with testApplySyncOwnerWinsSameInstant.
func testApplySyncKeepsProviderCheckpointIdentity(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	st := newStore(t)
	seedOwnerModel(t, st)
	const instant = int64(1785974399)
	first, err := st.ApplySync(
		[]store.SyncCheckpoint{{AccountID: "checking", Balance: 100, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN, ObservedAt: instant}},
		nil)
	if err != nil || first.CheckpointsInserted != 1 {
		t.Fatalf("seed = %+v, err %v", first, err)
	}
	foreign, err := st.ApplySync(
		[]store.SyncCheckpoint{{AccountID: "checking", Balance: 999, Source: store.SourceBankSync, Provider: "plaid", ObservedAt: instant}},
		nil)
	if err != nil || foreign.CheckpointsSkipped != 1 {
		t.Fatalf("foreign provider overwrite = %+v, err %v", foreign, err)
	}
	loaded, err := st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	checkpoint, ok := findCheckpoint(loaded, "checking", instant)
	if !ok || checkpoint.Balance != 100 || checkpoint.Source != store.SourceBankSync {
		t.Fatalf("checkpoint identity lost: %+v", checkpoint)
	}
	refresh, err := st.ApplySync(
		[]store.SyncCheckpoint{{AccountID: "checking", Balance: 150, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN, ObservedAt: instant}},
		nil)
	if err != nil || refresh.CheckpointsUpdated != 1 {
		t.Fatalf("same-provider refresh = %+v, err %v", refresh, err)
	}
	// A non-SimpleFIN provider inserts and refreshes its own instant with
	// its own source carried through: provenance is provider-neutral.
	const other = int64(1786060799)
	seed, err := st.ApplySync(
		[]store.SyncCheckpoint{{AccountID: "checking", Balance: 200, Source: store.SourceBankSync, Provider: "plaid", ObservedAt: other}},
		nil)
	if err != nil || seed.CheckpointsInserted != 1 {
		t.Fatalf("other-provider insert = %+v, err %v", seed, err)
	}
	renew, err := st.ApplySync(
		[]store.SyncCheckpoint{{AccountID: "checking", Balance: 250, Source: store.SourceBankSync, Provider: "plaid", ObservedAt: other}},
		nil)
	if err != nil || renew.CheckpointsUpdated != 1 {
		t.Fatalf("other-provider refresh = %+v, err %v", renew, err)
	}
	loaded, err = st.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	otherCheckpoint, ok := findCheckpoint(loaded, "checking", other)
	if !ok || otherCheckpoint.Balance != 250 || otherCheckpoint.Source != store.SourceBankSync {
		t.Fatalf("other-provider checkpoint = %+v, want balance 250 source banksync", otherCheckpoint)
	}
}

const ownerTransactionID = "01900000-0000-7000-8000-000000000010"

func seedOwnerModel(t *testing.T, st store.Store) {
	t.Helper()
	model := ownerModel()
	for _, account := range model.Accounts {
		if _, err := st.CreateAccount(account); err != nil {
			t.Fatalf("seed account %s: %v", account.ID, err)
		}
	}
	for _, checkpoint := range model.Checkpoints {
		if _, err := st.SaveCheckpoint(checkpoint); err != nil {
			t.Fatalf("seed checkpoint: %v", err)
		}
	}
	for _, transaction := range model.Transactions {
		if _, err := st.CreateTransaction(transaction); err != nil {
			t.Fatalf("seed transaction %s: %v", transaction.ID, err)
		}
	}
}

func seedSyncState(t *testing.T, st store.Store) {
	t.Helper()
	if _, err := st.CreateAccount(types.Account{ID: "prime_card", Name: "Prime", Enabled: true}); err != nil {
		t.Fatalf("seed card account: %v", err)
	}
	seed := syncPendingTransaction("tx1", "prime_card", "2026-08-02")
	summary, err := st.ApplySync(
		[]store.SyncCheckpoint{{AccountID: "checking", ObservedAt: 1785628799, Balance: 111, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN}},
		[]store.BankDirective{syncPendingDirective(seed)})
	if err != nil || summary.CheckpointsInserted != 1 || summary.PendingInserted != 1 {
		t.Fatalf("seed sync state = %+v, err %v", summary, err)
	}
}

func loadTransactionIDs(t *testing.T, st store.Store) (ids []string, sources map[string]string) {
	t.Helper()
	loaded, err := st.LoadModel()
	if err != nil {
		t.Fatalf("load model: %v", err)
	}
	return transactionIDsFromModel(loaded)
}

func findCheckpoint(model *types.FinancialModel, accountID string, observedAt int64) (types.Checkpoint, bool) {
	if model == nil {
		return types.Checkpoint{}, false
	}
	for _, checkpoint := range model.Checkpoints {
		if checkpoint.AccountID == accountID && checkpoint.ObservedAt == observedAt {
			return checkpoint, true
		}
	}
	return types.Checkpoint{}, false
}

func ownerModel() *types.FinancialModel {
	checking := "checking"
	return &types.FinancialModel{
		SourcePath: "test-source",
		Accounts: []types.Account{{
			ID: "checking", Name: "Checking", Enabled: true,
		}},
		Checkpoints: []types.Checkpoint{
			{ObservedAt: 1782950399, AccountID: "checking", Balance: 500},
		},
		Evaluations: types.EmptyEvaluationTables(),
		Transactions: []types.Transaction{{
			ID: ownerTransactionID, Name: "Owner", SourceAccountID: &checking,
			Amount:     types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime: 1782950400, TransactionTime: 1782950400,
		}},
	}
}

func transactionIDsFromModel(model *types.FinancialModel) (ids []string, sources map[string]string) {
	sources = map[string]string{}
	if model == nil {
		return ids, sources
	}
	for _, transaction := range model.Transactions {
		ids = append(ids, transaction.ID)
		sources[transaction.ID] = transaction.Source
	}
	return ids, sources
}

func syncedPendingIDs(model *types.FinancialModel) []string {
	var ids []string
	if model == nil {
		return ids
	}
	for _, transaction := range model.Transactions {
		if transaction.Pending && transaction.Source != store.SourceUser {
			ids = append(ids, transaction.ID)
		}
	}
	return ids
}

func testTimestampedCheckpointsPreserveMultipleObservationsPerDay(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	st := newStore(t)
	seedOwnerModel(t, st)
	morning := types.Checkpoint{AccountID: "checking", Balance: 1000, ObservedAt: 1785882000}
	evening := types.Checkpoint{AccountID: "checking", Balance: 900, ObservedAt: 1785903600}
	if _, err := st.SaveCheckpoint(morning); err != nil {
		t.Fatalf("save morning: %v", err)
	}
	if _, err := st.SaveCheckpoint(evening); err != nil {
		t.Fatalf("save evening: %v", err)
	}
	loaded, err := st.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	var matches []types.Checkpoint
	for _, checkpoint := range loaded.Checkpoints {
		if checkpoint.AccountID == "checking" && (checkpoint.ObservedAt == 1785882000 || checkpoint.ObservedAt == 1785903600) {
			matches = append(matches, checkpoint)
		}
	}
	if len(matches) != 2 {
		t.Fatalf("same-day observations = %+v, want both preserved", matches)
	}
	byInstant := map[int64]float64{}
	for _, checkpoint := range matches {
		byInstant[checkpoint.ObservedAt] = checkpoint.Balance
	}
	if byInstant[1785882000] != 1000 || byInstant[1785903600] != 900 {
		t.Fatalf("instants not preserved: %+v", matches)
	}
	if err := st.DeleteCheckpointAt("checking", 1785882000); err != nil {
		t.Fatalf("delete one instant: %v", err)
	}
	loaded, err = st.LoadModel()
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	remaining := 0
	for _, checkpoint := range loaded.Checkpoints {
		if checkpoint.AccountID == "checking" && (checkpoint.ObservedAt == 1785882000 || checkpoint.ObservedAt == 1785903600) {
			remaining++
			if checkpoint.ObservedAt != 1785903600 {
				t.Fatalf("wrong row survived: %+v", checkpoint)
			}
		}
	}
	if remaining != 1 {
		t.Fatalf("remaining same-day rows = %d, want 1", remaining)
	}
}

func testApplySyncRetainsBackdatedObservation(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	st := newStore(t)
	seedOwnerModel(t, st)
	fresh, err := st.ApplySync(
		[]store.SyncCheckpoint{{AccountID: "checking", Balance: 1000, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN, ObservedAt: 1785903600}},
		nil)
	if err != nil || fresh.CheckpointsInserted != 1 {
		t.Fatalf("fresh apply = %+v, err %v", fresh, err)
	}
	// A late-arriving backdated observation is retained as its own
	// instant-keyed row: replay orders it chronologically and the latest
	// instant still wins, so current state never rolls back.
	late, err := st.ApplySync(
		[]store.SyncCheckpoint{{AccountID: "checking", Balance: 5, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN, ObservedAt: 1785817200}},
		nil)
	if err != nil || late.CheckpointsInserted != 1 || late.CheckpointsSkipped != 0 {
		t.Fatalf("backdated apply = %+v, err %v", late, err)
	}
	loaded, err := st.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	seen := map[int64]float64{}
	for _, checkpoint := range loaded.Checkpoints {
		if checkpoint.AccountID == "checking" {
			seen[checkpoint.ObservedAt] = checkpoint.Balance
		}
	}
	if seen[1785903600] != 1000 || seen[1785817200] != 5 {
		t.Fatalf("both instants must persist: %+v", loaded.Checkpoints)
	}
	// Input batch order does not matter: oldest-first and newest-first
	// batches converge on the same instant-keyed rows.
	repeat, err := st.ApplySync(
		[]store.SyncCheckpoint{
			{AccountID: "checking", Balance: 1000, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN, ObservedAt: 1785903600},
			{AccountID: "checking", Balance: 5, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN, ObservedAt: 1785817200},
			{AccountID: "checking", Balance: 7, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN, ObservedAt: 1785730800},
		},
		nil)
	if err != nil || repeat.CheckpointsInserted != 1 || repeat.CheckpointsUpdated != 2 {
		t.Fatalf("out-of-order batch = %+v, err %v", repeat, err)
	}
}

func testApplySyncOwnerWinsSameInstant(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	st := newStore(t)
	seedOwnerModel(t, st)
	const instant = int64(1785903600)
	if _, err := st.SaveCheckpoint(types.Checkpoint{AccountID: "checking", Balance: 999, ObservedAt: instant}); err != nil {
		t.Fatalf("save owner: %v", err)
	}
	summary, err := st.ApplySync(
		[]store.SyncCheckpoint{{AccountID: "checking", Balance: 100, Source: store.SourceBankSync, Provider: store.ProviderSimpleFIN, ObservedAt: instant}},
		nil)
	if err != nil || summary.CheckpointsSkipped != 1 {
		t.Fatalf("apply = %+v, err %v", summary, err)
	}
	loaded, err := st.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	count := 0
	for _, checkpoint := range loaded.Checkpoints {
		if checkpoint.AccountID == "checking" && checkpoint.ObservedAt == instant {
			count++
			if checkpoint.Balance != 999 || checkpoint.Source != store.SourceUser {
				t.Fatalf("same-instant row = %+v, want owner 999", checkpoint)
			}
		}
	}
	if count != 1 {
		t.Fatalf("same-instant rows = %d, want exactly the owner row", count)
	}
}

func testSettledBankRowRoundTrip(t *testing.T, newStore func(*testing.T) store.Store) {
	t.Helper()
	st := newStore(t)
	seedOwnerModel(t, st)
	settled := store.SyncTransaction{
		ProviderAccountID: "bridge-checking",
		TransactionID:     "posted-1",
		Transaction: types.Transaction{
			Name:            "Posted",
			SourceAccountID: strptr("checking"),
			Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      1785817200,
			TransactionTime: 1785817200,
			Enabled:         true,
		},
	}
	settled.Source = store.SourceBankSync
	summary, err := st.ApplySync(nil, []store.BankDirective{{
		Upsert: &store.BankUpsert{
			Transaction: settled.Transaction,
			Keys:        []store.BankKey{{Provider: store.ProviderSimpleFIN, AccountID: settled.ProviderAccountID, TransactionID: settled.TransactionID}},
		},
	}})
	if err != nil || summary.SettledInserted != 1 {
		t.Fatalf("settled apply = %+v, err %v", summary, err)
	}
	loaded, err := st.LoadModel()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	banked := false
	for _, transaction := range loaded.Transactions {
		if transaction.Source == store.SourceBankSync {
			banked = true
			if transaction.Pending || transaction.Void {
				t.Fatalf("settled bank row mislabeled: %+v", transaction)
			}
			if !transaction.Enabled {
				t.Fatalf("settled bank row must stay enabled: %+v", transaction)
			}
		}
	}
	if !banked {
		t.Fatalf("no settled bank row: %+v", loaded.Transactions)
	}
}

func strptr(value string) *string { return &value }
