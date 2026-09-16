package simplefin

import (
	"encoding/json"
	"testing"
	"time"
)

// Redacted bridge-shaped fixture: balances, one pending charge, one posted
// charge, one payment, one unmapped account.
const fixtureAccountSet = `{
  "accounts": [
    {
      "id": "sfin-checking",
      "name": "Checking",
      "currency": "USD",
      "balance": "1523.10",
      "balance-date": 1785628800,
      "transactions": []
    },
    {
      "id": "sfin-prime",
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
      "id": "sfin-other",
      "name": "Unknown",
      "currency": "USD",
      "balance": "1.00",
      "balance-date": 1785628800,
      "transactions": [{"id": "x", "posted": 1, "amount": "-1.00", "description": "x"}]
    }
  ]
}`

func fixtureConfig() Config {
	return Config{
		AccountMap:   map[string]string{"sfin-checking": "checking", "sfin-prime": "prime_card"},
		CardAccounts: map[string]struct{}{"prime_card": {}},
	}
}

func TestParseAccountMap(t *testing.T) {
	mapping, err := ParseAccountMap("a=b, c=d")
	if err != nil || mapping["a"] != "b" || mapping["c"] != "d" {
		t.Fatalf("parse = %v, %v", mapping, err)
	}
	if _, err := ParseAccountMap("no-equals"); err == nil {
		t.Fatal("expected error for bare entry")
	}
	if _, err := ParseAccountMap("a="); err == nil {
		t.Fatal("expected error for empty value")
	}
	if mapping, err := ParseAccountMap(""); err != nil || len(mapping) != 0 {
		t.Fatalf("empty parse = %v, %v", mapping, err)
	}
}

func TestMapProducesCheckpointsAndPendingOnly(t *testing.T) {
	var set AccountSet
	if err := json.Unmarshal([]byte(fixtureAccountSet), &set); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	plan, err := Map(&set, fixtureConfig(), time.Unix(1785628800, 0).UTC())
	if err != nil {
		t.Fatalf("map: %v", err)
	}
	if len(plan.Checkpoints) != 2 {
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
	if len(plan.Pending) != 1 {
		t.Fatalf("pending = %+v", plan.Pending)
	}
	pending := plan.Pending[0]
	if pending.ID != "sfin-pending-prime_card-pend1" {
		t.Fatalf("pending id = %q", pending.ID)
	}
	if pending.StartDate != "2026-08-02" {
		t.Fatalf("pending start date = %q, want injected now", pending.StartDate)
	}
	if pending.Enabled {
		t.Fatal("pending seed must be disabled")
	}
	if pending.SourceAccountID == nil || *pending.SourceAccountID != "prime_card" {
		t.Fatalf("pending source = %+v", pending.SourceAccountID)
	}
	expression, ok := pending.Amount.Config["expression"].(string)
	if !ok || expression != "42.10" || pending.Amount.Resolver != "expression" {
		t.Fatalf("pending amount = %+v", pending.Amount)
	}
	if pending.Frequency != "once" || pending.Priority != PendingPriority {
		t.Fatalf("pending shape = %+v", pending)
	}
	if plan.Skipped[SkipPosted] != 2 || plan.Skipped[SkipNonCharge] != 1 || plan.Skipped[SkipBadAmount] != 1 {
		t.Fatalf("skipped = %+v", plan.Skipped)
	}
	if plan.Skipped[SkipUnmappedAccount] != 2 {
		t.Fatalf("unmapped skipped = %+v", plan.Skipped)
	}
}

func TestPendingPostingIDSanitizes(t *testing.T) {
	id := PendingPostingID("prime_card", "a/b c.d")
	if id != "sfin-pending-prime_card-a_b_c_d" {
		t.Fatalf("id = %q", id)
	}
}

func TestParseDryRunStrict(t *testing.T) {
	if !ParseDryRun("1") || ParseDryRun("true") || ParseDryRun("") {
		t.Fatal("dry run must accept only 1")
	}
}
