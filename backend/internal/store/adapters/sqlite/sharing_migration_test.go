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
// (setup validates it) and exercises the grant, copy provenance, inbox,
// policy, visibility, audit, and idempotency-key tracks end to end.
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

	if _, err := d.CopySharedTransaction(alice, transaction.ID, bob, sharingKey(t)); err != nil {
		t.Fatalf("copy: %v", err)
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

	events := sharingAudit(t, d, alice, transaction.ID)
	seen := map[string]bool{}
	for _, event := range events {
		seen[event.Action] = true
	}
	if !seen["grant"] || !seen[store.SharingAuditCopyAccepted] {
		t.Fatalf("audit actions = %v, want grant and copy-accepted", seen)
	}
}
