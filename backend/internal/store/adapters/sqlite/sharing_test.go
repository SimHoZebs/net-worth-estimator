package sqlite

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const sharingIssuer = "https://issuer.test"

const sharingTransactionA = "01900000-0000-7000-8000-0000000000a1"
const sharingTransactionB = "01900000-0000-7000-8000-0000000000a2"

func openSharingTestDB(t *testing.T) *Database {
	t.Helper()
	d, err := SetupDatabase(filepath.Join(t.TempDir(), "sharing.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func sharingUser(t *testing.T, d *Database, subject string) (string, store.Store) {
	t.Helper()
	user, err := d.EnsureGroupUser(sharingIssuer, subject)
	if err != nil {
		t.Fatal(err)
	}
	scoped, err := d.EnsureUser(user, sharingIssuer, subject)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	return user, scoped
}

func sharingTransaction(t *testing.T, scoped store.Store, id string) types.Transaction {
	t.Helper()
	source := "checking"
	transaction, err := scoped.CreateTransaction(types.Transaction{
		ID: id, Name: "Shared " + id, SourceAccountID: &source,
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      1782950400,
		TransactionTime: 1782950400,
		Enabled:         true,
	})
	if err != nil {
		t.Fatal(err)
	}
	return transaction
}

func sharingGroup(t *testing.T, d *Database, owner, name string, members ...string) string {
	t.Helper()
	ownerID, err := d.EnsureGroupUser(sharingIssuer, owner)
	if err != nil {
		t.Fatal(err)
	}
	group, err := d.CreateGroup(ownerID, name, owner)
	if err != nil {
		t.Fatal(err)
	}
	for _, member := range members {
		memberID, err := d.EnsureGroupUser(sharingIssuer, member)
		if err != nil {
			t.Fatal(err)
		}
		invite, code, err := d.CreateInvite(group.ID, ownerID, 5, 24*time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		_ = invite
		if _, err := d.AcceptInvite(code, memberID, member); err != nil {
			t.Fatal(err)
		}
	}
	return group.ID
}

func checkAccess(t *testing.T, d *Database, owner, transaction, requester string) store.SharedTransactionAccess {
	t.Helper()
	access, err := d.CheckSharedTransactionAccess(owner, transaction, requester)
	if err != nil {
		t.Fatal(err)
	}
	return access
}

// Two users share one physical file with identical transaction IDs. A grant
// authorizes exactly one owner-scoped transaction for one audience.
func TestSharingIsolationSameIDs(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, storeB := sharingUser(t, d, "bob")
	transactionA := sharingTransaction(t, storeA, sharingTransactionA)
	sharingTransaction(t, storeB, sharingTransactionA)

	if access := checkAccess(t, d, alice, sharingTransactionA, bob); access.Allowed {
		t.Fatal("ungranted cross-user read allowed")
	}
	if _, err := d.ReadSharedTransaction(alice, sharingTransactionA, bob); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("ungranted read = %v, want not-found", err)
	}
	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	access := checkAccess(t, d, alice, sharingTransactionA, bob)
	if !access.Allowed || access.Reason != "manual-user" {
		t.Fatalf("granted access = %+v, want manual-user allow", access)
	}
	read, err := d.ReadSharedTransaction(alice, sharingTransactionA, bob)
	if err != nil {
		t.Fatal(err)
	}
	if read.ID != transactionA.ID || read.Name != transactionA.Name {
		t.Fatalf("shared read = %+v, want owner's transaction", read)
	}
	// The recipient's own row with the identical ID is untouched and the
	// grant authorizes nothing else.
	if access := checkAccess(t, d, alice, sharingTransactionB, bob); access.Allowed {
		t.Fatal("grant leaked to another transaction")
	}
	if access := checkAccess(t, d, bob, sharingTransactionA, alice); access.Allowed {
		t.Fatal("grant leaked across owner direction")
	}
	model, err := storeB.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Transactions) != 1 || model.Transactions[0].ID != sharingTransactionA {
		t.Fatalf("recipient model changed by grant: %+v", model.Transactions)
	}
	refs, err := d.ListSharedTransactions(bob)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].OwnerUserID != alice || refs[0].Transaction.ID != sharingTransactionA {
		t.Fatalf("shared list = %+v, want one owner-scoped transaction", refs)
	}
}

// Revocation denies subsequent reads unless another independent valid
// grant survives.
func TestSharingRevocationKeepsIndependentGrants(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)
	group := sharingGroup(t, d, "alice", "Club", "bob")

	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceGroup, group, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if err := d.RevokeSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkAccess(t, d, alice, sharingTransactionA, bob); !access.Allowed || access.Reason != "manual-group" {
		t.Fatalf("group grant did not survive user-grant revocation: %+v", access)
	}
	if err := d.RevokeSharedTransaction(alice, sharingTransactionA, store.SharingAudienceGroup, group, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkAccess(t, d, alice, sharingTransactionA, bob); access.Allowed {
		t.Fatal("revoked grants still authorize")
	}
	if _, err := d.ReadSharedTransaction(alice, sharingTransactionA, bob); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("revoked read = %v, want not-found", err)
	}
	if refs, err := d.ListSharedTransactions(bob); err != nil || len(refs) != 0 {
		t.Fatalf("revoked list = %+v, %v, want empty", refs, err)
	}
	// Revoking a missing grant reports not-found, and grants are idempotent.
	if err := d.RevokeSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("double revoke = %v, want not-found", err)
	}
	first, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	second, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("grant not idempotent: %+v vs %+v", first, second)
	}
}

// Group grants authorize only while both requester and source owner hold
// current membership. Removal denies immediately.
func TestSharingGroupMembershipGating(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)
	group := sharingGroup(t, d, "alice", "Club", "bob")

	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceGroup, group, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkAccess(t, d, alice, sharingTransactionA, bob); !access.Allowed || access.Reason != "manual-group" {
		t.Fatalf("member access = %+v, want manual-group allow", access)
	}
	if err := d.RemoveMember(group, alice, bob); err != nil {
		t.Fatal(err)
	}
	if access := checkAccess(t, d, alice, sharingTransactionA, bob); access.Allowed {
		t.Fatal("removed member still authorized")
	}
	if _, err := d.ReadSharedTransaction(alice, sharingTransactionA, bob); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("removed member read = %v, want not-found", err)
	}
	// A non-member outsider never gains access through the group grant.
	carol, _ := sharingUser(t, d, "carol")
	if access := checkAccess(t, d, alice, sharingTransactionA, carol); access.Allowed {
		t.Fatal("outsider authorized through group grant")
	}
}

// Explicit share and exclusion cannot coexist for one audience. A user
// exclusion denies that person through group grants while other members
// stay authorized; a wildcard exclusion denies everyone.
func TestSharingExclusionMatrix(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	carol, _ := sharingUser(t, d, "carol")
	sharingTransaction(t, storeA, sharingTransactionA)
	group := sharingGroup(t, d, "alice", "Club", "bob", "carol")

	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceGroup, group, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExcludeSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkAccess(t, d, alice, sharingTransactionA, bob); access.Allowed {
		t.Fatal("excluded member authorized through group grant")
	}
	if access := checkAccess(t, d, alice, sharingTransactionA, carol); !access.Allowed {
		t.Fatal("other group member denied by unrelated exclusion")
	}
	// A grant for an excluded audience is rejected until the exclusion is
	// removed; an exclusion for a granted audience is rejected until the
	// grant is revoked.
	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t)); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("grant over exclusion = %v, want invalid", err)
	}
	if _, err := d.ExcludeSharedTransaction(alice, sharingTransactionA, store.SharingAudienceGroup, group, sharingKey(t)); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("exclusion over grant = %v, want invalid", err)
	}
	if err := d.RemoveSharedExclusion(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkAccess(t, d, alice, sharingTransactionA, bob); !access.Allowed {
		t.Fatal("member denied after exclusion removal")
	}
	if _, err := d.ExcludeSharedTransaction(alice, sharingTransactionA, store.SharingAudienceAll, "", sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkAccess(t, d, alice, sharingTransactionA, bob); access.Allowed {
		t.Fatal("wildcard exclusion still authorizes group member")
	}
	if access := checkAccess(t, d, alice, sharingTransactionA, carol); access.Allowed {
		t.Fatal("wildcard exclusion still authorizes other member")
	}
	if err := d.RemoveSharedExclusion(alice, sharingTransactionA, store.SharingAudienceAll, "", sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkAccess(t, d, alice, sharingTransactionA, bob); !access.Allowed {
		t.Fatal("member denied after wildcard removal")
	}
}

// A group exclusion denies current members of the excluded group even
// when another audience grants them access.
func TestSharingGroupExclusionEnforced(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	carol, _ := sharingUser(t, d, "carol")
	sharingTransaction(t, storeA, sharingTransactionA)
	friends := sharingGroup(t, d, "alice", "Friends", "bob", "carol")
	club := sharingGroup(t, d, "alice", "Club", "bob")

	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceGroup, friends, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExcludeSharedTransaction(alice, sharingTransactionA, store.SharingAudienceGroup, club, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	// Bob belongs to both: the exclusion wins over the grant.
	if access := checkAccess(t, d, alice, sharingTransactionA, bob); access.Allowed {
		t.Fatal("group-excluded member authorized through another group grant")
	}
	// Carol belongs only to the granted group: still authorized.
	if access := checkAccess(t, d, alice, sharingTransactionA, carol); !access.Allowed {
		t.Fatal("non-excluded group member denied")
	}
	if _, err := d.ReadSharedTransaction(alice, sharingTransactionA, bob); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("group-excluded read = %v, want not-found", err)
	}
	if refs, err := d.ListSharedTransactions(bob); err != nil || len(refs) != 0 {
		t.Fatalf("group-excluded list = %+v, %v, want empty", refs, err)
	}
}

// Well-formed but never-provisioned audiences fail closed instead of
// parking dangling consent that would auto-authorize later provisioning.
func TestSharingUnknownAudienceNotFound(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	sharingTransaction(t, storeA, sharingTransactionA)
	ghost := "user:0000000000000000000000000000000000000000000000000000000000000000"

	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, ghost, sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("grant unknown user = %v, want not-found", err)
	}
	if _, err := d.ExcludeSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, ghost, sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("exclude unknown user = %v, want not-found", err)
	}
	grants, err := d.ListSharingGrants(alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 0 {
		t.Fatalf("dangling consent recorded: %+v", grants)
	}
}

// All group-deletion paths clear the dead audience's consent rows:
// owner delete, sole-owner leave, and user-removal cleanup. Surviving
// groups keep their grants.
func TestSharingGroupDeletionPathsClearGrants(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)
	solo := sharingGroup(t, d, "alice", "Solo")
	shared := sharingGroup(t, d, "alice", "Shared", "bob")

	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceGroup, solo, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceGroup, shared, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	// Sole owner leaving deletes the group and its consent rows.
	if err := d.LeaveGroup(solo, alice); err != nil {
		t.Fatal(err)
	}
	grants, err := d.ListSharingGrants(alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 1 || grants[0].AudienceID != shared {
		t.Fatalf("sole-owner leave kept dead consent: %+v", grants)
	}
	// Removing the owner's memberships deletes the now-empty group and
	// its rows, while the group surviving with Bob keeps its grant.
	if err := d.RemoveGroupMembershipsForUser(alice); err != nil {
		t.Fatal(err)
	}
	grants, err = d.ListSharingGrants(alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 1 || grants[0].AudienceID != shared {
		t.Fatalf("membership cleanup consent = %+v, want surviving group only", grants)
	}
	if access := checkAccess(t, d, alice, sharingTransactionA, bob); access.Allowed {
		t.Fatal("non-member owner grant still authorizes without membership")
	}
}

// Deleting a group drops its explicit consent rows in the same
// transaction; owner grant lists stop surfacing the dead audience while
// reads already deny through missing membership.
func TestSharingDeleteGroupClearsGrants(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)
	group := sharingGroup(t, d, "alice", "Club", "bob")

	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceGroup, group, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if err := d.DeleteGroup(group, alice); err != nil {
		t.Fatal(err)
	}
	grants, err := d.ListSharingGrants(alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 0 {
		t.Fatalf("dead audience consent retained: %+v", grants)
	}
	if access := checkAccess(t, d, alice, sharingTransactionA, bob); access.Allowed {
		t.Fatal("deleted group still authorizes")
	}
}

// The recipient deleting their own copy also drops its provenance row.
func TestSharingRecipientDeleteDropsProvenance(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, storeB := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)

	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	copied, err := d.CopySharedTransaction(alice, sharingTransactionA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := storeB.DeleteTransaction(copied.ID); err != nil {
		t.Fatal(err)
	}
	var provenance int
	if err := d.SQL().QueryRow(`SELECT COUNT(*) FROM sharing_copies`).Scan(&provenance); err != nil || provenance != 0 {
		t.Fatalf("orphan provenance = %d, %v, want 0", provenance, err)
	}
}

// Forged and malformed IDs fail closed without distinguishing denial from
// absence. Owner typos and unknown transactions/groups report not-found.
func TestSharingForgedIDsFailClosed(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)

	for _, tc := range [][3]string{
		{"user:deadbeef", sharingTransactionA, bob},
		{alice, "not-a-uuid", bob},
		{alice, sharingTransactionA, "user:deadbeef"},
		{"", sharingTransactionA, bob},
		{alice, sharingTransactionA, ""},
		{alice, "01900000-0000-7000-8000-0000000000ff", bob},
	} {
		if access := checkAccess(t, d, tc[0], tc[1], tc[2]); access.Allowed {
			t.Fatalf("forged IDs authorized: %q", tc)
		}
		if _, err := d.ReadSharedTransaction(tc[0], tc[1], tc[2]); !errors.Is(err, store.ErrNotFound) {
			t.Fatalf("forged read = %v, want not-found", err)
		}
	}
	if _, err := d.GrantSharedTransaction(alice, "01900000-0000-7000-8000-0000000000ff", store.SharingAudienceUser, bob, sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("grant unknown transaction = %v, want not-found", err)
	}
	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceGroup, "01900000-0000-7000-8000-0000000000ff", sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("grant unknown group = %v, want not-found", err)
	}
	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, "friend", bob, sharingKey(t)); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("grant unknown audience = %v, want invalid", err)
	}
	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceAll, "", sharingKey(t)); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("wildcard grant = %v, want invalid", err)
	}
	if _, err := d.ExcludeSharedTransaction(alice, sharingTransactionA, store.SharingAudienceAll, "bob", sharingKey(t)); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("wildcard with ID = %v, want invalid", err)
	}
}

// Recipient copies are independent rows: revocation never rewrites them
// and the recipient edits them through their own scope.
func TestSharingCopySurvivesRevocation(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, storeB := sharingUser(t, d, "bob")
	source := sharingTransaction(t, storeA, sharingTransactionA)

	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	copied, err := d.CopySharedTransaction(alice, sharingTransactionA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if copied.ID == "" || copied.ID == source.ID {
		t.Fatalf("copy kept source identity: %q", copied.ID)
	}
	if copied.Name != source.Name {
		t.Fatalf("copy name = %q, want %q", copied.Name, source.Name)
	}
	if copied.Claim != nil {
		t.Fatal("copy kept the owner-scoped claim")
	}
	if err := d.RevokeSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkAccess(t, d, alice, sharingTransactionA, bob); access.Allowed {
		t.Fatal("revoked grant still authorizes")
	}
	updated, err := storeB.UpdateTransaction(types.Transaction{
		ID: copied.ID, Name: "Recipient edited", SourceAccountID: copied.SourceAccountID,
		Destinations: copied.Destinations, Amount: copied.Amount,
		PostedTime: copied.PostedTime, TransactionTime: copied.TransactionTime, Enabled: copied.Enabled,
	})
	if err != nil {
		t.Fatalf("recipient cannot edit own copy: %v", err)
	}
	if updated.Name != "Recipient edited" {
		t.Fatalf("copy edit lost: %+v", updated)
	}
	model, err := storeA.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Transactions) != 1 || model.Transactions[0].Name != source.Name {
		t.Fatalf("source original changed by recipient: %+v", model.Transactions)
	}
	var provenance int
	if err := d.SQL().QueryRow(`SELECT COUNT(*) FROM sharing_copies WHERE recipient_user_id = ? AND copy_transaction_id = ? AND source_owner_id = ? AND source_transaction_id = ?`,
		bob, copied.ID, alice, sharingTransactionA).Scan(&provenance); err != nil || provenance != 1 {
		t.Fatalf("copy provenance = %d, %v, want 1", provenance, err)
	}
}

// A copy clears the source account when the recipient owns no account
// with that ID; the store foreign key would otherwise reject the row.
func TestSharingCopyClearsUnknownSourceAccount(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)
	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	bobScoped, err := d.User(bob)
	if err != nil {
		t.Fatal(err)
	}
	if err := bobScoped.DeleteAccount("checking"); err != nil {
		t.Fatal(err)
	}
	copied, err := d.CopySharedTransaction(alice, sharingTransactionA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if copied.SourceAccountID != nil {
		t.Fatalf("copy kept unresolvable source account %q", *copied.SourceAccountID)
	}
}

// Deleting the source transaction and clearing the owner model remove consent
// in the same transaction: deleted transactions authorize nothing.
func TestSharingDeleteAndClearRemoveConsent(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)
	sharingTransaction(t, storeA, sharingTransactionB)

	if _, err := d.GrantSharedTransaction(alice, sharingTransactionA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GrantSharedTransaction(alice, sharingTransactionB, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if err := storeA.DeleteTransaction(sharingTransactionA); err != nil {
		t.Fatal(err)
	}
	if access := checkAccess(t, d, alice, sharingTransactionA, bob); access.Allowed {
		t.Fatal("deleted transaction still authorized")
	}
	grants, err := d.ListSharingGrants(alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 1 || grants[0].TransactionID != sharingTransactionB {
		t.Fatalf("delete did not clear only the deleted transaction's consent: %+v", grants)
	}
	if access := checkAccess(t, d, alice, sharingTransactionB, bob); !access.Allowed {
		t.Fatal("sibling grant removed with deleted transaction")
	}
	if err := storeA.Clear(); err != nil {
		t.Fatal(err)
	}
	if access := checkAccess(t, d, alice, sharingTransactionB, bob); access.Allowed {
		t.Fatal("cleared model still authorizes")
	}
	grants, err = d.ListSharingGrants(alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 0 {
		t.Fatalf("grants survived clear: %+v", grants)
	}
}

// Copying without authorization reports not-found, like a denied read.
func TestSharingCopyDeniedWithoutGrant(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingTransaction(t, storeA, sharingTransactionA)
	if _, err := d.CopySharedTransaction(alice, sharingTransactionA, bob, sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("ungranted copy = %v, want not-found", err)
	}
	if !strings.HasPrefix(alice, "user:") || !strings.HasPrefix(bob, "user:") {
		t.Fatalf("unexpected user IDs %q %q", alice, bob)
	}
}
