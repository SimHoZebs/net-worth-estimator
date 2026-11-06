package sqlite

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const inboxTransactionA = "01900000-0000-7000-8000-0000000000c1"
const inboxTransactionB = "01900000-0000-7000-8000-0000000000c2"

func openInboxTestDB(t *testing.T) *Database {
	t.Helper()
	d, err := SetupDatabase(filepath.Join(t.TempDir(), "inbox.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func reopenInboxTestDB(t *testing.T, d *Database, path string) *Database {
	t.Helper()
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { reopened.Close() })
	return reopened
}

func grantToUser(t *testing.T, d *Database, owner, transaction, recipient string) {
	t.Helper()
	if _, err := d.GrantSharedTransaction(owner, transaction, store.SharingAudienceUser, recipient, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
}

func recipientTransactions(t *testing.T, d *Database, recipient string) []types.Transaction {
	t.Helper()
	rows, err := d.db.Query(`SELECT `+transactionSelect+` `+transactionJoins+` WHERE p.user_id = ?`, recipient)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []types.Transaction
	for rows.Next() {
		transaction, err := scanTransactionRow(rows)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, transaction)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// A granted share first appears pending and unread with its authorized
// preview. Listing never clears unread state.
func TestInboxShareArrivesPendingUnread(t *testing.T) {
	d := openInboxTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, inboxTransactionA)
	grantToUser(t, d, alice, inboxTransactionA, bob)

	items, err := d.ListInboxItems(bob)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	item := items[0]
	if item.Kind != store.InboxKindShare || item.Status != store.InboxStatusPending {
		t.Fatalf("item = %+v, want pending share", item)
	}
	if !item.Unread || item.Dismissed || item.ReceivedAt == 0 {
		t.Fatalf("item = %+v, want unread visible sighting", item)
	}
	if item.Transaction == nil || item.Transaction.ID != inboxTransactionA {
		t.Fatalf("item preview = %+v, want authorized transaction", item.Transaction)
	}
	again, err := d.ListInboxItems(bob)
	if err != nil {
		t.Fatal(err)
	}
	if !again[0].Unread {
		t.Fatal("relisting cleared unread state")
	}
}

// Accepting saves one personal copy and records the decision. A retried
// accept returns the recorded item without minting another copy, and a
// later decline is a no-op: the first decision wins.
func TestInboxAcceptIdempotentSingleCopy(t *testing.T) {
	d := openInboxTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, inboxTransactionA)
	grantToUser(t, d, alice, inboxTransactionA, bob)

	before := len(recipientTransactions(t, d, bob))
	accepted, err := d.AcceptInboxShare(bob, alice, inboxTransactionA)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Status != store.InboxStatusAccepted || accepted.CopyTransactionID == "" {
		t.Fatalf("accepted = %+v, want accepted with copy", accepted)
	}
	if after := len(recipientTransactions(t, d, bob)); after != before+1 {
		t.Fatalf("recipient transactions grew by %d, want 1", after-before)
	}
	retry, err := d.AcceptInboxShare(bob, alice, inboxTransactionA)
	if err != nil {
		t.Fatal(err)
	}
	if retry.CopyTransactionID != accepted.CopyTransactionID {
		t.Fatalf("retry copy = %q, want %q", retry.CopyTransactionID, accepted.CopyTransactionID)
	}
	if after := len(recipientTransactions(t, d, bob)); after != before+1 {
		t.Fatalf("retry grew recipient transactions to %d, want no duplicate", after)
	}
	decline, err := d.DeclineInboxShare(bob, alice, inboxTransactionA)
	if err != nil {
		t.Fatal(err)
	}
	if decline.Status != store.InboxStatusAccepted {
		t.Fatalf("decline-after-accept = %q, want recorded acceptance", decline.Status)
	}
	grants, err := d.ListSharingGrants(alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 1 {
		t.Fatalf("accept removed the grant: %+v", grants)
	}
}

// Accepting adopts a copy the recipient already saved through the
// shared-copies path instead of minting a second one.
func TestInboxAcceptAdoptsExistingCopy(t *testing.T) {
	d := openInboxTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, inboxTransactionA)
	grantToUser(t, d, alice, inboxTransactionA, bob)

	before := len(recipientTransactions(t, d, bob))
	copied, err := d.CopySharedTransaction(alice, inboxTransactionA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := d.AcceptInboxShare(bob, alice, inboxTransactionA)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.CopyTransactionID != copied.ID {
		t.Fatalf("adopted copy = %q, want %q", accepted.CopyTransactionID, copied.ID)
	}
	if after := len(recipientTransactions(t, d, bob)); after != before+1 {
		t.Fatalf("accept minted a second copy: grew by %d", after-before)
	}
}

// Declining a direct share records the refusal and removes the recipient
// from the sender's sharing list. Retries return the recorded item.
func TestInboxDeclineWithdrawsDirectGrant(t *testing.T) {
	d := openInboxTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, inboxTransactionA)
	grantToUser(t, d, alice, inboxTransactionA, bob)

	declined, err := d.DeclineInboxShare(bob, alice, inboxTransactionA)
	if err != nil {
		t.Fatal(err)
	}
	if declined.Status != store.InboxStatusDeclined {
		t.Fatalf("declined = %+v, want declined", declined)
	}
	if declined.Transaction != nil {
		t.Fatal("declined direct share still carries a preview")
	}
	grants, err := d.ListSharingGrants(alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 0 {
		t.Fatalf("sender grants = %+v, want declined recipient gone", grants)
	}
	retry, err := d.DeclineInboxShare(bob, alice, inboxTransactionA)
	if err != nil {
		t.Fatal(err)
	}
	if retry.Status != store.InboxStatusDeclined {
		t.Fatalf("retry = %q, want declined", retry.Status)
	}
	if _, err := d.AcceptInboxShare(bob, alice, inboxTransactionA); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("accept-after-decline = %v, want not-found until reshared", err)
	}
}

// Declining a group-audience share keeps the owner's grant: the refusal
// stays recipient-local while the preview remains authorized.
func TestInboxDeclineGroupShareKeepsGrant(t *testing.T) {
	d := openInboxTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, inboxTransactionA)
	group := sharingGroup(t, d, "alice", "Club", "bob")
	if _, err := d.GrantSharedTransaction(alice, inboxTransactionA, store.SharingAudienceGroup, group, sharingKey(t)); err != nil {
		t.Fatal(err)
	}

	declined, err := d.DeclineInboxShare(bob, alice, inboxTransactionA)
	if err != nil {
		t.Fatal(err)
	}
	if declined.Status != store.InboxStatusDeclined || declined.Transaction == nil {
		t.Fatalf("declined = %+v, want declined with authorized preview", declined)
	}
	grants, err := d.ListSharingGrants(alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 1 || grants[0].Audience != store.SharingAudienceGroup {
		t.Fatalf("group grant disturbed: %+v", grants)
	}
	// A declined group share stays authorized, so the recipient may still
	// accept afterwards; the acceptance saves the personal copy as usual.
	before := len(recipientTransactions(t, d, bob))
	accepted, err := d.AcceptInboxShare(bob, alice, inboxTransactionA)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Status != store.InboxStatusAccepted || accepted.CopyTransactionID == "" {
		t.Fatalf("accept-after-decline = %+v, want accepted with copy", accepted)
	}
	if after := len(recipientTransactions(t, d, bob)); after != before+1 {
		t.Fatalf("accept-after-decline grew transactions by %d, want 1", after-before)
	}
}

// A declined group share keeps its refusal across lists while its grant
// stands: standing grants never reset a recorded decline.
func TestInboxStandingGroupDeclineStaysDeclined(t *testing.T) {
	d := openInboxTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, inboxTransactionA)
	group := sharingGroup(t, d, "alice", "Club", "bob")
	if _, err := d.GrantSharedTransaction(alice, inboxTransactionA, store.SharingAudienceGroup, group, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.DeclineInboxShare(bob, alice, inboxTransactionA); err != nil {
		t.Fatal(err)
	}
	items, err := d.ListInboxItems(bob)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Status != store.InboxStatusDeclined || items[0].Transaction == nil {
		t.Fatalf("relisted = %+v, want declined with authorized preview", items)
	}
}

// A fresh group grant after a decline is a new sender decision: the share
// returns to pending unread. The pause crosses a second boundary so the
// new grant's timestamp strictly follows the decision.
func TestInboxFreshGroupGrantReopensDeclined(t *testing.T) {
	d := openInboxTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, inboxTransactionA)
	first := sharingGroup(t, d, "alice", "First", "bob")
	if _, err := d.GrantSharedTransaction(alice, inboxTransactionA, store.SharingAudienceGroup, first, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.DeclineInboxShare(bob, alice, inboxTransactionA); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1100 * time.Millisecond)
	second := sharingGroup(t, d, "alice", "Second", "bob")
	if _, err := d.GrantSharedTransaction(alice, inboxTransactionA, store.SharingAudienceGroup, second, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	items, err := d.ListInboxItems(bob)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Status != store.InboxStatusPending || !items[0].Unread || items[0].Transaction == nil {
		t.Fatalf("reopened = %+v, want pending unread with preview", items)
	}
}

// A fresh direct grant after a decline is a new sender decision: the share
// returns to pending unread with its preview.
func TestInboxReshareAfterDeclineReturnsPending(t *testing.T) {
	d := openInboxTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, inboxTransactionA)
	grantToUser(t, d, alice, inboxTransactionA, bob)
	if _, err := d.DeclineInboxShare(bob, alice, inboxTransactionA); err != nil {
		t.Fatal(err)
	}
	grantToUser(t, d, alice, inboxTransactionA, bob)
	items, err := d.ListInboxItems(bob)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	reshared := items[0]
	if reshared.Status != store.InboxStatusPending || !reshared.Unread || reshared.Transaction == nil {
		t.Fatalf("reshared = %+v, want pending unread with preview", reshared)
	}
	if reshared.DecidedAt != 0 {
		t.Fatalf("reshared decidedAt = %d, want cleared", reshared.DecidedAt)
	}
}

// A seen share the sender takes back surfaces as canceled without
// content. Recorded decisions survive revocation instead.
func TestInboxCanceledOnRevoke(t *testing.T) {
	d := openInboxTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	carol, storeC := sharingUser(t, d, "carol")
	sharingTransaction(t, storeA, inboxTransactionA)
	sharingTransaction(t, storeC, inboxTransactionB)
	grantToUser(t, d, alice, inboxTransactionA, bob)
	grantToUser(t, d, carol, inboxTransactionB, bob)
	if _, err := d.AcceptInboxShare(bob, carol, inboxTransactionB); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ListInboxItems(bob); err != nil {
		t.Fatal(err)
	}
	if err := d.RevokeSharedTransaction(alice, inboxTransactionA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if err := d.RevokeSharedTransaction(carol, inboxTransactionB, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}

	items, err := d.ListInboxItems(bob)
	if err != nil {
		t.Fatal(err)
	}
	byTransaction := map[string]store.InboxShareItem{}
	for _, item := range items {
		byTransaction[item.TransactionID] = item
	}
	pending, ok := byTransaction[inboxTransactionA]
	if !ok || pending.Status != store.InboxStatusCanceled || pending.Transaction != nil {
		t.Fatalf("revoked pending = %+v, want canceled without preview", pending)
	}
	decided, ok := byTransaction[inboxTransactionB]
	if !ok || decided.Status != store.InboxStatusAccepted {
		t.Fatalf("revoked accepted = %+v, want recorded acceptance", decided)
	}
	if _, err := d.AcceptInboxShare(bob, alice, inboxTransactionA); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("accept-after-revoke = %v, want not-found", err)
	}
}

// Deleting the source transaction cancels its pending inbox items.
func TestInboxCanceledOnSourceDelete(t *testing.T) {
	d := openInboxTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, inboxTransactionA)
	grantToUser(t, d, alice, inboxTransactionA, bob)
	if _, err := d.ListInboxItems(bob); err != nil {
		t.Fatal(err)
	}
	if err := storeA.DeleteTransaction(inboxTransactionA); err != nil {
		t.Fatal(err)
	}
	items, err := d.ListInboxItems(bob)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Status != store.InboxStatusCanceled || items[0].Transaction != nil {
		t.Fatalf("items = %+v, want one canceled without preview", items)
	}
}

// Dismissing hides without deciding; unhiding restores. Dismissing an
// unseen unauthorized share fails closed.
func TestInboxDismissRecoverable(t *testing.T) {
	d := openInboxTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, inboxTransactionA)
	grantToUser(t, d, alice, inboxTransactionA, bob)

	dismissed, err := d.SetInboxShareDismissed(bob, alice, inboxTransactionA, true)
	if err != nil {
		t.Fatal(err)
	}
	if !dismissed.Dismissed || dismissed.Status != store.InboxStatusPending {
		t.Fatalf("dismissed = %+v, want hidden pending", dismissed)
	}
	shown, err := d.SetInboxShareDismissed(bob, alice, inboxTransactionA, false)
	if err != nil {
		t.Fatal(err)
	}
	if shown.Dismissed {
		t.Fatalf("unhidden = %+v, want visible", shown)
	}
	if _, err := d.SetInboxShareDismissed(bob, alice, inboxTransactionB, true); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("dismiss unseen = %v, want not-found", err)
	}
}

// Unread state changes only through explicit marking, and it survives a
// database reopen. Listing, viewing, and deciding never clear it.
func TestInboxUnreadPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "inbox-reopen.db")
	d, err := SetupDatabase(path)
	if err != nil {
		t.Fatal(err)
	}
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, inboxTransactionA)
	grantToUser(t, d, alice, inboxTransactionA, bob)
	if _, err := d.ListInboxItems(bob); err != nil {
		t.Fatal(err)
	}
	if _, err := d.AcceptInboxShare(bob, alice, inboxTransactionA); err != nil {
		t.Fatal(err)
	}
	read, err := d.SetInboxShareRead(bob, alice, inboxTransactionA, true)
	if err != nil {
		t.Fatal(err)
	}
	if read.Unread || read.Status != store.InboxStatusAccepted {
		t.Fatalf("marked = %+v, want read accepted", read)
	}

	d = reopenInboxTestDB(t, d, path)
	items, err := d.ListInboxItems(bob)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Unread || items[0].Status != store.InboxStatusAccepted {
		t.Fatalf("reopened = %+v, want persisted read accepted", items)
	}
	unread, err := d.SetInboxShareRead(bob, alice, inboxTransactionA, false)
	if err != nil {
		t.Fatal(err)
	}
	if !unread.Unread {
		t.Fatal("mark-unread did not restore unread state")
	}
}

// Shares stay invisible to anyone outside the audience, even with forged
// owner and transaction IDs, in the same physical file.
func TestInboxIsolation(t *testing.T) {
	d := openInboxTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, storeB := sharingUser(t, d, "bob")
	carol, _ := sharingUser(t, d, "carol")
	sharingTransaction(t, storeA, inboxTransactionA)
	sharingTransaction(t, storeB, inboxTransactionA)
	grantToUser(t, d, alice, inboxTransactionA, bob)

	if items, err := d.ListInboxItems(carol); err != nil || len(items) != 0 {
		t.Fatalf("outsider inbox = %+v, %v; want empty", items, err)
	}
	unknownOwner := "user:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err := d.AcceptInboxShare(carol, unknownOwner, inboxTransactionA); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("forged-owner accept = %v, want not-found", err)
	}
	if _, err := d.DeclineInboxShare(bob, alice, inboxTransactionB); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("wrong-transaction decline = %v, want not-found", err)
	}
	if _, err := d.SetInboxShareRead(bob, alice, inboxTransactionB, true); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("wrong-transaction read = %v, want not-found", err)
	}
	if _, err := d.AcceptInboxShare(bob, "not-a-user", inboxTransactionA); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("malformed-owner accept = %v, want invalid", err)
	}
	if _, err := d.AcceptInboxShare(bob, alice, "not-a-transaction"); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("malformed-transaction accept = %v, want invalid", err)
	}
	if _, err := d.ListInboxItems("not-a-user"); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("malformed-recipient list = %v, want invalid", err)
	}
}

// The sender's name resolves only through groups both sides currently
// share; otherwise the item carries no name.
func TestInboxSenderDisplayName(t *testing.T) {
	d := openInboxTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	carol, storeC := sharingUser(t, d, "carol")
	sharingTransaction(t, storeA, inboxTransactionA)
	sharingTransaction(t, storeC, inboxTransactionB)
	sharingGroup(t, d, "alice", "Club", "bob")
	grantToUser(t, d, alice, inboxTransactionA, bob)
	grantToUser(t, d, carol, inboxTransactionB, bob)

	items, err := d.ListInboxItems(bob)
	if err != nil {
		t.Fatal(err)
	}
	byTransaction := map[string]store.InboxShareItem{}
	for _, item := range items {
		byTransaction[item.TransactionID] = item
	}
	if byTransaction[inboxTransactionA].SenderDisplayName != "alice" {
		t.Fatalf("group sender name = %q, want alice", byTransaction[inboxTransactionA].SenderDisplayName)
	}
	if byTransaction[inboxTransactionB].SenderDisplayName != "" {
		t.Fatalf("stranger sender name = %q, want empty", byTransaction[inboxTransactionB].SenderDisplayName)
	}
}

// Withdrawing removes only the recipient's own direct grant.
func TestWithdrawUserGrant(t *testing.T) {
	d := openInboxTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	carol, _ := sharingUser(t, d, "carol")
	sharingTransaction(t, storeA, inboxTransactionA)
	group := sharingGroup(t, d, "alice", "Club", "bob")
	grantToUser(t, d, alice, inboxTransactionA, bob)
	if _, err := d.GrantSharedTransaction(alice, inboxTransactionA, store.SharingAudienceGroup, group, sharingKey(t)); err != nil {
		t.Fatal(err)
	}

	if err := d.WithdrawUserGrant(carol, alice, inboxTransactionA); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("stranger withdraw = %v, want not-found", err)
	}
	if err := d.WithdrawUserGrant(bob, alice, inboxTransactionA); err != nil {
		t.Fatal(err)
	}
	grants, err := d.ListSharingGrants(alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 1 || grants[0].Audience != store.SharingAudienceGroup {
		t.Fatalf("grants = %+v, want only the group grant left", grants)
	}
	if err := d.WithdrawUserGrant(bob, alice, inboxTransactionA); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("second withdraw = %v, want not-found", err)
	}
	if err := d.WithdrawUserGrant(bob, alice, "nope"); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("malformed withdraw = %v, want invalid", err)
	}
}
