package simplefin

import (
	"encoding/json"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
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
      "name": "Checking",
      "currency": "USD",
      "balance": "1523.10",
      "balance-date": 1785628800,
      "transactions": []
    },
    {
      "id": "bridge-prime",
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
      "name": "Unknown",
      "currency": "USD",
      "balance": "1.00",
      "balance-date": 1785628800,
      "transactions": [{"id": "x", "posted": 1, "amount": "-1.00", "description": "x"}]
    }
  ]
}`

func fixtureCards() map[string]struct{} {
	return map[string]struct{}{"prime_card": {}}
}

func TestMapProducesCheckpointsAndPendingOnly(t *testing.T) {
	var set AccountSet
	if err := json.Unmarshal([]byte(fixtureAccountSet), &set); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	plan, err := Map(&set, map[string]string{"bridge-checking": "checking", "bridge-prime": "prime_card"}, time.Unix(1785628800, 0).UTC())
	if err != nil {
		t.Fatalf("map: %v", err)
	}
	if len(plan.Checkpoints) != 3 {
		t.Fatalf("checkpoints = %+v", plan.Checkpoints)
	}
	for _, checkpoint := range plan.Checkpoints {
		if checkpoint.AccountID == "checking" && checkpoint.Balance != 1523.10 {
			t.Fatalf("checking checkpoint = %+v", checkpoint)
		}
		if checkpoint.AccountID == "prime_card" && checkpoint.Balance != -412.55 {
			t.Fatalf("prime checkpoint = %+v", checkpoint)
		}
	}
	if len(plan.Pending) != 2 {
		t.Fatalf("pending = %+v, want charge and refund seeds", plan.Pending)
	}
	pending := plan.Pending[0]
	if pending.ID != "" || pending.ProviderAccountID != "bridge-prime" || pending.TransactionID != "pend1" || !pending.Pending {
		t.Fatalf("pending identity/state = %+v", pending)
	}
	var refund *store.SyncPosting
	for i := range plan.Pending {
		if plan.Pending[i].TransactionID == "pendpos" {
			refund = &plan.Pending[i]
		}
	}
	if refund == nil {
		t.Fatalf("pending refund seed missing: %+v", plan.Pending)
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
	if len(plan.Provisions) != 1 || plan.Provisions[0].BridgeID != "bridge-other" || plan.Provisions[0].Kind != "cash" {
		t.Fatalf("provisions = %+v, want bridge-other cash", plan.Provisions)
	}
	unmapped := plan.Checkpoints[2]
	if unmapped.AccountID != "" || unmapped.BridgeID != "bridge-other" || unmapped.Balance != 1.00 {
		t.Fatalf("unmapped checkpoint = %+v, want bridge-keyed", unmapped)
	}
	if plan.Skipped[SkipUnmappedAccount] != 2 {
		t.Fatalf("skipped = %+v, want 2 unmapped rows", plan.Skipped)
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
	settled := plan.Settled[0]
	if settled.ProviderAccountID != "bridge-prime" || settled.TransactionID != "post1" || settled.Pending || settled.Enabled {
		t.Fatalf("settled identity/state = %+v", settled)
	}
	if settled.SourceAccountID == nil || *settled.SourceAccountID != "prime_card" {
		t.Fatalf("settled source = %+v", settled.SourceAccountID)
	}
	if len(plan.Settled) != 2 {
		t.Fatalf("settled = %+v, want posted charge and posted payment", plan.Settled)
	}
	for _, settled := range plan.Settled {
		if settled.TransactionID == "pay1" && (settled.SourceAccountID != nil || len(settled.Destinations) != 1) {
			t.Fatalf("posted payment direction = %+v, want inflow", settled)
		}
	}
	if plan.Skipped[SkipBadAmount] != 1 || len(plan.Skipped) != 2 {
		t.Fatalf("skipped = %+v, want broken amount plus unmapped account", plan.Skipped)
	}
	if plan.Skipped[SkipUnmappedAccount] != 2 {
		t.Fatalf("unmapped skipped = %+v", plan.Skipped)
	}
}

func TestMapPreservesExactUpstreamTransactionKeys(t *testing.T) {
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
		plan, err := Map(&set, map[string]string{"bridge-checking": "checking", "bridge-prime": "prime_card"}, time.Unix(1785628800, 0).UTC())
		if err != nil {
			t.Fatalf("map: %+v, err %v", plan, err)
		}
		found := false
		for _, pending := range plan.Pending {
			if pending.TransactionID == key && pending.ID == "" {
				found = true
			}
		}
		if !found {
			t.Fatalf("upstream key was changed: plan %+v, err %v", plan, err)
		}
	}
}
