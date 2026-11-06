package simplefin

import (
	"context"
	"encoding/json"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Redacted bridge-shaped fixture: balances, one pending charge, one posted
// charge, one payment, one unmapped account.
const fixtureAccountSet = `{
  "accounts": [
    {
      "id": "bridge-checking",
      "conn_id": "conn-test",
      "name": "Checking",
      "currency": "USD",
      "balance": "1523.10",
      "balance-date": 1785628800,
      "transactions": []
    },
    {
      "id": "bridge-prime",
      "conn_id": "conn-test",
      "name": "Prime Card",
      "currency": "USD",
      "balance": "-412.55",
      "balance-date": 1785628800,
      "transactions": [
        {"id": "pend1", "posted": 0, "amount": "-42.10", "description": "Corner Store", "pending": true},
        {"id": "post1", "posted": 1785542400, "amount": "-18.00", "description": "Posted merchant"},
        {"id": "pay1", "posted": 1785542400, "amount": "400.00", "description": "Card payment"},
        {"id": "pendpos", "posted": 0, "amount": "25.00", "description": "Pending refund", "pending": true},
        {"id": "bad1", "posted": 0, "amount": "n/a", "description": "Broken", "pending": true}
      ]
    },
    {
      "id": "bridge-other",
      "conn_id": "conn-test",
      "name": "Unknown",
      "currency": "USD",
      "balance": "1.00",
      "balance-date": 1785628800,
      "transactions": [{"id": "x", "posted": 1, "amount": "-1.00", "description": "x"}]
    }
  ]
}`

func TestTranslateProducesCheckpointsAndPendingOnly(t *testing.T) {
	var set AccountSet
	if err := json.Unmarshal([]byte(fixtureAccountSet), &set); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	translation, err := Translate(&set, map[string]string{testAccountKey("bridge-checking"): "checking", testAccountKey("bridge-prime"): "prime_card"}, time.Unix(1785628800, 0).UTC())
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	if len(translation.Checkpoints) != 3 {
		t.Fatalf("checkpoints = %+v", translation.Checkpoints)
	}
	for _, checkpoint := range translation.Checkpoints {
		if checkpoint.AccountID == "checking" && checkpoint.Balance != 1523.10 {
			t.Fatalf("checking checkpoint = %+v", checkpoint)
		}
		if checkpoint.AccountID == "prime_card" && checkpoint.Balance != -412.55 {
			t.Fatalf("prime checkpoint = %+v", checkpoint)
		}
	}
	if len(translation.Pending) != 2 {
		t.Fatalf("pending = %+v, want charge and refund seeds", translation.Pending)
	}
	pending := translation.Pending[0]
	if pending.ID != "" || pending.ProviderAccountID != testAccountKey("bridge-prime") || pending.TransactionID != "pend1" || !pending.Pending {
		t.Fatalf("pending identity/state = %+v", pending)
	}
	var refund *store.SyncTransaction
	for i := range translation.Pending {
		if translation.Pending[i].TransactionID == "pendpos" {
			refund = &translation.Pending[i]
		}
	}
	if refund == nil {
		t.Fatalf("pending refund seed missing: %+v", translation.Pending)
	}
	if refund.SourceAccountID != nil || len(refund.Destinations) != 1 || refund.Destinations[0] != "prime_card" {
		t.Fatalf("pending refund direction = %+v, want inflow to prime_card", refund)
	}
	if pending.Enabled {
		t.Fatal("pending seed must be disabled")
	}
	if pending.SourceAccountID == nil || *pending.SourceAccountID != "prime_card" {
		t.Fatalf("pending source = %+v", pending.SourceAccountID)
	}
	unmapped := translation.Checkpoints[2]
	if unmapped.AccountID != "" || unmapped.BridgeID != testAccountKey("bridge-other") || unmapped.Balance != 1.00 {
		t.Fatalf("unmapped checkpoint = %+v, want bridge-keyed", unmapped)
	}
	if translation.Skipped[SkipUnmappedAccount] != 2 {
		t.Fatalf("skipped = %+v, want 2 unmapped rows", translation.Skipped)
	}
	expression, ok := pending.Amount.Config["expression"].(string)
	if !ok || pending.Amount.Resolver != "expression" {
		t.Fatalf("pending amount = %+v, want expression resolver", pending.Amount)
	}
	if value, err := strconv.ParseFloat(strings.TrimSpace(expression), 64); err != nil || value != 42.10 {
		t.Fatalf("pending amount = %+v, want 42.10", pending.Amount)
	}
	if pending.Claim != nil {
		t.Fatalf("pending shape = %+v", pending)
	}
	settled := translation.Settled[0]
	if settled.ProviderAccountID != testAccountKey("bridge-prime") || settled.TransactionID != "post1" || settled.Pending || !settled.Enabled {
		t.Fatalf("settled identity/state = %+v, want enabled settled participant", settled)
	}
	if settled.TransactionTime != settled.PostedTime {
		t.Fatalf("settled event time = %d, want posted instant %d", settled.TransactionTime, settled.PostedTime)
	}
	if settled.SourceAccountID == nil || *settled.SourceAccountID != "prime_card" {
		t.Fatalf("settled source = %+v", settled.SourceAccountID)
	}
	if len(translation.Settled) != 2 {
		t.Fatalf("settled = %+v, want posted charge and posted payment", translation.Settled)
	}
	for _, settled := range translation.Settled {
		if settled.TransactionID == "pay1" && (settled.SourceAccountID != nil || len(settled.Destinations) != 1) {
			t.Fatalf("posted payment direction = %+v, want inflow", settled)
		}
	}
	if translation.Skipped[SkipBadAmount] != 1 || len(translation.Skipped) != 2 {
		t.Fatalf("skipped = %+v, want broken amount plus unmapped account", translation.Skipped)
	}
	if translation.Skipped[SkipUnmappedAccount] != 2 {
		t.Fatalf("unmapped skipped = %+v", translation.Skipped)
	}
}

func TestTranslatePreservesExactUpstreamTransactionKeys(t *testing.T) {
	for _, key := range []string{"a/b", "a b", "a_b", "a.b"} {
		var set AccountSet
		if err := json.Unmarshal([]byte(fixtureAccountSet), &set); err != nil {
			t.Fatal(err)
		}
		for i := range set.Accounts[1].Transactions {
			if set.Accounts[1].Transactions[i].ID == "pend1" {
				set.Accounts[1].Transactions[i].ID = key
			}
		}
		translation, err := Translate(&set, map[string]string{testAccountKey("bridge-checking"): "checking", testAccountKey("bridge-prime"): "prime_card"}, time.Unix(1785628800, 0).UTC())
		if err != nil {
			t.Fatalf("translate: %+v, err %v", translation, err)
		}
		found := false
		for _, pending := range translation.Pending {
			if pending.TransactionID == key && pending.ID == "" {
				found = true
			}
		}
		if !found {
			t.Fatalf("upstream key was changed: translation %+v, err %v", translation, err)
		}
	}
}

func TestTranslatePreservesAvailableBalance(t *testing.T) {
	available := "1523.10"
	set := &AccountSet{Accounts: []Account{{
		ID: "bridge-checking", ConnID: testConnID, Name: "Checking", Currency: "USD",
		Balance: "1523.10", AvailableBalance: &available, BalanceDate: 1785628800,
	}}}
	translation, err := Translate(set, map[string]string{testAccountKey("bridge-checking"): "checking"}, time.Unix(1785628800, 0).UTC())
	if err != nil {
		t.Fatal(err)
	}
	if len(translation.Checkpoints) != 1 {
		t.Fatalf("checkpoints = %+v", translation.Checkpoints)
	}
	checkpoint := translation.Checkpoints[0]
	if checkpoint.AvailableBalance == nil || *checkpoint.AvailableBalance != 1523.10 {
		t.Fatalf("available balance = %+v, want 1523.10", checkpoint.AvailableBalance)
	}
	if checkpoint.Balance != 1523.10 {
		t.Fatalf("posted balance = %v, want 1523.10", checkpoint.Balance)
	}
}

func TestTranslateLeavesInvalidAvailableBalanceUnknown(t *testing.T) {
	for _, raw := range []string{"not-a-number", "NaN", "+Inf", "-Inf"} {
		available := raw
		set := &AccountSet{Accounts: []Account{{
			ID: "bridge-checking", ConnID: testConnID, Name: "Checking", Currency: "USD",
			Balance: "1523.10", AvailableBalance: &available, BalanceDate: 1785628800,
		}}}
		translation, err := Translate(set, map[string]string{testAccountKey("bridge-checking"): "checking"}, time.Unix(1785628800, 0).UTC())
		if err != nil {
			t.Fatal(err)
		}
		if len(translation.Checkpoints) != 1 || translation.Checkpoints[0].AvailableBalance != nil {
			t.Fatalf("%q: checkpoints = %+v, want posted balance with unknown available", raw, translation.Checkpoints)
		}
		if translation.Checkpoints[0].Balance != 1523.10 {
			t.Fatalf("%q: posted balance = %v", raw, translation.Checkpoints[0].Balance)
		}
	}
}

func TestPartialSyncDoesNotVoidExcludedPendingHold(t *testing.T) {
	database := openRunnerStore(t)
	for _, account := range []types.Account{{ID: "checking", Name: "Checking"}, {ID: "card", Name: "Card"}} {
		if _, err := database.CreateAccount(account); err != nil {
			t.Fatal(err)
		}
	}
	for _, link := range []store.AccountLink{
		{BridgeAccountID: testAccountKey("bridge-checking"), ModelAccountID: "checking", Origin: store.LinkOriginManual},
		{BridgeAccountID: testAccountKey("bridge-card"), ModelAccountID: "card", Origin: store.LinkOriginManual},
	} {
		if _, err := database.SaveAccountLink(link); err != nil {
			t.Fatal(err)
		}
	}
	pending := true
	first := &AccountSet{
		Connections: []Connection{
			{ConnID: "conn-checking", Name: "Checking Login"},
			{ConnID: "conn-card", Name: "Card Login"},
		},
		Accounts: []Account{
			{ID: "bridge-checking", ConnID: "conn-checking", Name: "Checking", Currency: "USD", Balance: "100", BalanceDate: 1785628800},
			{ID: "bridge-card", ConnID: "conn-card", Name: "Card", Currency: "USD", Balance: "-10", BalanceDate: 1785628800,
				Transactions: []Transaction{{ID: "hold", Posted: 0, Amount: "-10", Description: "Pending charge", Pending: &pending}}},
		},
	}
	runner := NewRunner(database, Config{}, nil)
	runner.now = func() time.Time { return time.Unix(1785628800, 0).UTC() }
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		return first, nil
	}
	if _, err := runner.Sync(context.Background()); err != nil {
		t.Fatal(err)
	}
	bank, err := database.LoadBankTransactions()
	if err != nil || len(bank) != 1 || !bank[0].Transaction.Pending {
		t.Fatalf("first sync hold = %+v, err %v", bank, err)
	}

	second := &AccountSet{
		Connections: first.Connections,
		ErrList:     []ProtocolError{{Code: "con.auth", Msg: "Reauthenticate Card Login", ConnID: "conn-card"}},
		Accounts:    first.Accounts,
	}
	runner.fetch = func(context.Context, time.Time, time.Time) (*AccountSet, error) {
		return second, nil
	}
	summary, err := runner.Sync(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !summary.Partial || len(summary.Errors) != 1 || summary.PendingDeleted != 0 {
		t.Fatalf("partial summary = %+v", summary)
	}
	bank, err = database.LoadBankTransactions()
	if err != nil || len(bank) != 1 || !bank[0].Transaction.Pending {
		t.Fatalf("excluded hold = %+v, err %v, want it preserved", bank, err)
	}
}

func TestTranslateSeparatesSameAccountIDAcrossConnections(t *testing.T) {
	set := &AccountSet{Accounts: []Account{
		{ID: "checking", ConnID: "CON-1", Name: "Checking A", Currency: "USD", Balance: "10", BalanceDate: 1785628800},
		{ID: "checking", ConnID: "CON-2", Name: "Checking B", Currency: "USD", Balance: "20", BalanceDate: 1785628800},
	}}
	translation, err := Translate(set, map[string]string{
		AccountKey("CON-1", "checking"): "model-a",
		AccountKey("CON-2", "checking"): "model-b",
	}, time.Unix(1785628800, 0).UTC())
	if err != nil {
		t.Fatal(err)
	}
	if len(translation.Checkpoints) != 2 {
		t.Fatalf("checkpoints = %+v", translation.Checkpoints)
	}
	byAccount := map[string]float64{}
	for _, checkpoint := range translation.Checkpoints {
		byAccount[checkpoint.AccountID] = checkpoint.Balance
	}
	if byAccount["model-a"] != 10 || byAccount["model-b"] != 20 {
		t.Fatalf("checkpoints = %+v", byAccount)
	}
}

func TestTranslateNormalizesSettledEventTimeToPosted(t *testing.T) { // A purchase authorized at 08:00 but posted at 11:00 affects the
	// reported balance at transaction: the settled event time is the post
	// instant. Pending seeds keep the purchase timestamp for matching.
	set := &AccountSet{Accounts: []Account{{
		ID: "bridge-prime", ConnID: testConnID, Name: "Prime", Currency: "USD",
		Balance: "0.00", BalanceDate: 1773100800,
		Transactions: []Transaction{
			{ID: "set1", Posted: 1773140400, Amount: "-100.00", Description: "Groceries", TransactedAt: &[]int64{1773129600}[0]},
			{ID: "pend1", Posted: 0, Amount: "-10.00", Description: "Hold", Pending: &[]bool{true}[0], TransactedAt: &[]int64{1773129600}[0]},
		},
	}}}
	translation, err := Translate(set, map[string]string{testAccountKey("bridge-prime"): "prime_card"}, time.Unix(1773140400, 0).UTC())
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	if len(translation.Settled) != 1 || len(translation.Pending) != 1 {
		t.Fatalf("translation = %+v, want 1 settled and 1 pending", translation)
	}
	settled := translation.Settled[0]
	if !settled.Enabled {
		t.Fatalf("settled bank actual must participate: %+v", settled.Transaction)
	}
	if settled.Transaction.TransactionTime != 1773140400 || settled.Transaction.PostedTime != 1773140400 {
		t.Fatalf("settled event time = %d/%d, want posted instant 1773140400", settled.Transaction.TransactionTime, settled.Transaction.PostedTime)
	}
	pending := translation.Pending[0]
	if pending.Enabled || pending.Transaction.TransactionTime != 1773129600 {
		t.Fatalf("pending seed must stay disabled on its purchase timestamp: %+v", pending.Transaction)
	}
	if pending.Transaction.PostedTime != 0 {
		t.Fatalf("pending seed must leave the missing posted date missing instead of fabricating the sync instant: %+v", pending.Transaction)
	}
}
