package simplefin

import (
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func reconcileInflowBankRow(id, name, account, amount string, keys ...store.BankKey) store.BankRow {
	return store.BankRow{
		Posting: types.Posting{
			ID:              id,
			Name:            name,
			Source:          store.SourceSimpleFIN,
			Destinations:    []string{account},
			Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      1785715200,
			TransactionTime: 1785715200,
			Enabled:         true,
		},
		Keys: keys,
	}
}

func TestAuditHistoricalVoidsFlagsUniqueTipPair(t *testing.T) {
	bank := []store.BankRow{
		reconcileBankRow("uuid-void", "Bistro", "prime_card", "50.00", false, true,
			pendingKey("prime_card", "old-auth")),
		reconcileBankRow("uuid-settled", "Bistro", "prime_card", "58.00", false, false,
			pendingKey("prime_card", "post-a")),
	}
	pairs := AuditHistoricalVoids(bank, "prime_card")
	if len(pairs) != 1 {
		t.Fatalf("pairs = %+v, want one flagged pair", pairs)
	}
	pair := pairs[0]
	if pair.VoidID != "uuid-void" || pair.SettledID != "uuid-settled" {
		t.Fatalf("pair = %+v, want void uuid-void with settled uuid-settled", pair)
	}
	if pair.VoidAmount != "50.00" || pair.SettledAmount != "58.00" {
		t.Fatalf("pair amounts = %+v, want source expressions", pair)
	}
}

func TestAuditHistoricalVoidsSkipsAmbiguous(t *testing.T) {
	bank := []store.BankRow{
		reconcileBankRow("uuid-void", "Bistro", "prime_card", "50.00", false, true,
			pendingKey("prime_card", "old-auth")),
		reconcileBankRow("uuid-settled-a", "Bistro", "prime_card", "55.00", false, false,
			pendingKey("prime_card", "post-a")),
		reconcileBankRow("uuid-settled-b", "Bistro", "prime_card", "56.00", false, false,
			pendingKey("prime_card", "post-b")),
	}
	if pairs := AuditHistoricalVoids(bank, "prime_card"); len(pairs) != 0 {
		t.Fatalf("ambiguous pairs = %+v, want none flagged", pairs)
	}
}

func TestAuditHistoricalVoidsSkipsNonMatches(t *testing.T) {
	bank := []store.BankRow{
		// Beyond tolerance: a genuine second charge, not a phantom.
		reconcileBankRow("uuid-void-far", "Bistro", "prime_card", "50.00", false, true,
			pendingKey("prime_card", "old-far")),
		reconcileBankRow("uuid-settled-far", "Bistro", "prime_card", "80.00", false, false,
			pendingKey("prime_card", "post-far")),
		// Zero-amount card check: never joins.
		reconcileBankRow("uuid-void-zero", "Bistro", "prime_card", "0.00", false, true,
			pendingKey("prime_card", "old-zero")),
		reconcileBankRow("uuid-settled-zero", "Bistro", "prime_card", "2.00", false, false,
			pendingKey("prime_card", "post-zero")),
		// Direction mismatch: outflow auth never joins an inflow posting.
		reconcileBankRow("uuid-void-dir", "Refund Desk", "prime_card", "42.10", false, true,
			pendingKey("prime_card", "old-dir")),
		// Other account: scoped out.
		reconcileBankRow("uuid-void-other", "Bistro", "other_card", "50.00", false, true,
			pendingKey("other_card", "old-other")),
		reconcileBankRow("uuid-settled-other", "Bistro", "other_card", "58.00", false, false,
			pendingKey("other_card", "post-other")),
		reconcileInflowBankRow("uuid-inflow", "Refund Desk", "prime_card", "42.10",
			pendingKey("prime_card", "post-inflow")),
	}
	if pairs := AuditHistoricalVoids(bank, "prime_card"); len(pairs) != 0 {
		t.Fatalf("non-matches = %+v, want none flagged", pairs)
	}
}

func TestAuditHistoricalVoidsIgnoresLiveRows(t *testing.T) {
	bank := []store.BankRow{
		// Live pending and enabled settled rows are lifecycle state, not
		// audit subjects: only voids are flagged.
		reconcileBankRow("uuid-pending", "Bistro", "prime_card", "50.00", true, false,
			pendingKey("prime_card", "live-auth")),
		reconcileBankRow("uuid-settled", "Bistro", "prime_card", "58.00", false, false,
			pendingKey("prime_card", "post-a")),
	}
	if pairs := AuditHistoricalVoids(bank, "prime_card"); len(pairs) != 0 {
		t.Fatalf("live rows = %+v, want none flagged", pairs)
	}
}

func TestAuditHistoricalVoidsFlagsAgainstDisabledSettled(t *testing.T) {
	// Deleting the phantom void never touches the settled sibling, so an
	// owner-disabled settled row still flags: the exclusion stays intact.
	voided := reconcileBankRow("uuid-void", "Bistro", "prime_card", "50.00", false, true,
		pendingKey("prime_card", "old-auth"))
	settled := reconcileBankRow("uuid-settled", "Bistro", "prime_card", "58.00", false, false,
		pendingKey("prime_card", "post-a"))
	settled.Posting.Enabled = false
	bank := []store.BankRow{voided, settled}
	pairs := AuditHistoricalVoids(bank, "prime_card")
	if len(pairs) != 1 || pairs[0].VoidID != "uuid-void" {
		t.Fatalf("pairs = %+v, want the void flagged", pairs)
	}
}
