// Migration backfill coverage: a database the deployment migration
// provisioned from a pre-sharing source must serve every sharing track
// through the store. The migration harness points at the migrated file;
// the store gate skips this test otherwise.
package sqlite

import (
	"os"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// TestSharingMigratedDatabaseFlows opens a migrated pre-sharing database
// (setup validates it) and exercises the grant, copy with link identity,
// inbox, policy, visibility, audit, idempotency-key, split, allocation,
// settlement, and settlement-request tracks end to end.
func TestSharingMigratedDatabaseFlows(t *testing.T) {
	path := os.Getenv("WAYPOINT_MIGRATED_DB")
	if path == "" {
		t.Skip("migration harness provides WAYPOINT_MIGRATED_DB")
	}
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatalf("setup validates migrated database: %v", err)
	}
	t.Cleanup(func() { d.Close() })

	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	transaction := sharingTransaction(t, storeA, sharingTransactionA)

	if _, err := d.GrantSharedTransaction(alice, transaction.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatalf("grant: %v", err)
	}
	if access := checkAccess(t, d, alice, transaction.ID, bob); !access.Allowed || access.Reason != "manual-user" {
		t.Fatalf("access = %+v, want manual-user allow", access)
	}
	if _, err := d.ReadSharedTransaction(alice, transaction.ID, bob); err != nil {
		t.Fatalf("read: %v", err)
	}

	copied, err := d.CopySharedTransaction(alice, transaction.ID, bob, sharingKey(t))
	if err != nil {
		t.Fatalf("copy: %v", err)
	}
	link, err := d.GetSharingLink(bob, copied.ID)
	if err != nil {
		t.Fatalf("link: %v", err)
	}
	if link.LinkID != store.SharingLinkID(alice, transaction.ID, bob) {
		t.Fatalf("link = %q, want deterministic link identity", link.LinkID)
	}
	refreshed, err := d.RefreshSharingLink(bob, copied.ID, sharingKey(t))
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if refreshed.Status != store.SharingLinkCurrent {
		t.Fatalf("refresh status = %q, want current", refreshed.Status)
	}

	items, err := d.ListInboxItems(bob)
	if err != nil {
		t.Fatalf("inbox list: %v", err)
	}
	found := false
	for _, item := range items {
		if item.OwnerUserID == alice && item.TransactionID == transaction.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("inbox list misses the shared transaction")
	}
	decided, err := d.AcceptInboxShare(bob, alice, transaction.ID)
	if err != nil {
		t.Fatalf("inbox accept: %v", err)
	}
	if decided.Status != store.InboxStatusAccepted {
		t.Fatalf("inbox status = %q, want accepted", decided.Status)
	}

	group := sharingGroup(t, d, "alice", "Club", "bob")
	if _, err := d.SetSharingPolicy(alice, group, store.SharingPolicyInput{Enabled: true, AccountIDs: []string{"checking"}, StartDate: "2026-01-01"}); err != nil {
		t.Fatalf("policy: %v", err)
	}
	preview, err := d.PreviewSharingPolicy(alice, group)
	if err != nil {
		t.Fatalf("policy preview: %v", err)
	}
	if preview.EligibleTransactions < 1 {
		t.Fatalf("eligible transactions = %d, want at least the shared row", preview.EligibleTransactions)
	}
	shared, err := d.ListSharedTransactions(bob)
	if err != nil {
		t.Fatalf("shared list: %v", err)
	}
	if len(shared) == 0 {
		t.Fatal("shared list is empty")
	}

	events, err := d.ListSharingAudit(alice, transaction.ID)
	if err != nil {
		t.Fatalf("audit: %v", err)
	}
	seen := map[string]bool{}
	for _, event := range events {
		seen[event.Action] = true
	}
	if !seen["grant"] || !seen[store.SharingAuditCopyAccepted] {
		t.Fatalf("audit actions = %v, want grant and copy-accepted", seen)
	}

	split := createSplit(t, d, splitInput(alice, transaction.ID, alice, alice, bob))
	if split.Version != 1 || split.Status != store.SplitStatusProposed {
		t.Fatalf("split = v%d %q, want v1 proposed", split.Version, split.Status)
	}
	if len(split.Allocations) != 2 {
		t.Fatalf("allocations = %d, want 2", len(split.Allocations))
	}
	if after, err := d.AcceptSplit(alice, split.ID, 1, sharingKey(t)); err != nil {
		t.Fatalf("split accept alice: %v", err)
	} else if after.Status != store.SplitStatusProposed {
		t.Fatalf("split status after one accept = %q, want proposed", after.Status)
	}
	if after, err := d.AcceptSplit(bob, split.ID, 1, sharingKey(t)); err != nil {
		t.Fatalf("split accept bob: %v", err)
	} else if after.Status != store.SplitStatusAccepted {
		t.Fatalf("split status after every accept = %q, want accepted", after.Status)
	}

	recorded, err := d.RecordSettlement(alice, store.SettlementInput{SplitID: split.ID, ParticipantID: bob, AmountMinor: 100}, sharingKey(t))
	if err != nil {
		t.Fatalf("settlement: %v", err)
	}
	history, err := d.ListSettlements(alice, split.ID)
	if err != nil {
		t.Fatalf("settlement history: %v", err)
	}
	if len(history) != 1 || history[0].ID != recorded.ID {
		t.Fatalf("settlement history = %+v, want the recorded settlement", history)
	}

	for table := range map[string]bool{
		"sharing_grants": true, "sharing_copies": true, "inbox_share_state": true,
		"sharing_policies": true, "sharing_visibility": true, "sharing_audit": true,
		"sharing_requests": true, "splits": true, "split_allocations": true,
		"split_settlements": true, "split_settlement_requests": true,
	} {
		var count int
		if err := d.db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if count == 0 {
			t.Fatalf("table %s is empty after exercising its flow", table)
		}
	}
}
