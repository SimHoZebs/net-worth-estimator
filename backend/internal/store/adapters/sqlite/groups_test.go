package sqlite

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/authorization"
)

func openGroupTestDB(t *testing.T) *Database {
	t.Helper()
	d, err := SetupDatabase(filepath.Join(t.TempDir(), "groups.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func ensureTestAccount(t *testing.T, d *Database, issuer, subject string) string {
	t.Helper()
	id, err := d.EnsureGroupAccount(issuer, subject)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestGroupsMultipleMembership(t *testing.T) {
	d := openGroupTestDB(t)
	alice := ensureTestAccount(t, d, "https://issuer.test", "alice")
	bob := ensureTestAccount(t, d, "https://issuer.test", "bob")

	first, err := d.CreateGroup(alice, "Hiking", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	second, err := d.CreateGroup(alice, "Board games", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID {
		t.Fatal("group IDs collided")
	}

	// Alice belongs to two groups.
	groups, err := d.ListGroupsForAccount(alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 2 {
		t.Fatalf("alice groups = %d, want 2", len(groups))
	}

	// Bob joins first via invite.
	invite, code, err := d.CreateInvite(first.ID, alice, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if code == "" || invite.ID == "" {
		t.Fatal("invite code was not returned")
	}
	joined, err := d.AcceptInvite(code, bob, "Bob")
	if err != nil {
		t.Fatal(err)
	}
	if joined.ID != first.ID {
		t.Fatalf("joined %s, want %s", joined.ID, first.ID)
	}

	members, err := d.ListGroupMembers(first.ID, alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 2 {
		t.Fatalf("members = %d, want 2", len(members))
	}

	// Kick removes Bob.
	if err := d.RemoveMember(first.ID, alice, bob); err != nil {
		t.Fatal(err)
	}
	members, err = d.ListGroupMembers(first.ID, alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 1 {
		t.Fatalf("members after kick = %d, want 1", len(members))
	}

	// Leave second group as sole owner deletes it.
	if err := d.LeaveGroup(second.ID, alice); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetGroup(second.ID, alice); err != ErrNotFound {
		t.Fatalf("deleted group err = %v, want ErrNoRows", err)
	}
}

func TestGroupsLastOwnerGuard(t *testing.T) {
	d := openGroupTestDB(t)
	alice := ensureTestAccount(t, d, "https://issuer.test", "alice")
	bob := ensureTestAccount(t, d, "https://issuer.test", "bob")

	group, err := d.CreateGroup(alice, "Household", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	_, code, err := d.CreateInvite(group.ID, alice, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.AcceptInvite(code, bob, "Bob"); err != nil {
		t.Fatal(err)
	}

	// Last owner cannot demote or leave while others remain.
	if err := d.UpdateMemberRole(group.ID, alice, alice, "member"); err == nil {
		t.Fatal("last owner demotion should fail")
	}
	if err := d.LeaveGroup(group.ID, alice); err == nil {
		t.Fatal("last owner leave with members should fail")
	}

	// Promote Bob, then Alice may leave.
	if err := d.UpdateMemberRole(group.ID, alice, bob, GroupRoleOwner); err != nil {
		t.Fatal(err)
	}
	if err := d.LeaveGroup(group.ID, alice); err != nil {
		t.Fatal(err)
	}
}

func TestGroupsAutoLeaveOnAccountDelete(t *testing.T) {
	d := openGroupTestDB(t)
	alice := ensureTestAccount(t, d, "https://issuer.test", "alice")
	bob := ensureTestAccount(t, d, "https://issuer.test", "bob")

	group, err := d.CreateGroup(alice, "Climbing", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	_, code, err := d.CreateInvite(group.ID, alice, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.AcceptInvite(code, bob, "Bob"); err != nil {
		t.Fatal(err)
	}
	if err := d.RemoveGroupMembershipsForAccount(bob); err != nil {
		t.Fatal(err)
	}
	members, err := d.ListGroupMembers(group.ID, alice)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range members {
		if m.AccountID == bob {
			t.Fatal("deleted account still a member")
		}
	}
}

// The group identity shares the private-plan actor derivation so one
// verified identity never splits into two app accounts.
func TestGroupsSharePlanActorIdentity(t *testing.T) {
	d := openGroupTestDB(t)
	id, err := d.EnsureGroupAccount("https://issuer.test", "alice")
	if err != nil {
		t.Fatal(err)
	}
	if id != authorization.ActorKey("https://issuer.test", "alice") {
		t.Fatalf("group account %q != ActorKey", id)
	}
}

// Removal preserves identity and financial state: app_accounts rows and
// account scopes survive, and sole-owned groups are deleted like LeaveGroup
// does instead of stranding an ownerless group.
func TestGroupsRemovalPreservesIdentityAndPlans(t *testing.T) {
	d := openGroupTestDB(t)
	alice := ensureTestAccount(t, d, "https://issuer.test", "alice")
	bob := ensureTestAccount(t, d, "https://issuer.test", "bob")

	solo, err := d.CreateGroup(bob, "Solo", "Bob")
	if err != nil {
		t.Fatal(err)
	}
	shared, err := d.CreateGroup(alice, "Shared", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	_, code, err := d.CreateInvite(shared.ID, alice, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.AcceptInvite(code, bob, "Bob"); err != nil {
		t.Fatal(err)
	}
	bobInvite, _, err := d.CreateInvite(shared.ID, alice, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	// Bob creates an invite too; it must be revoked, not kept redeemable.
	if err := d.UpdateMemberRole(shared.ID, alice, bob, GroupRoleAdmin); err != nil {
		t.Fatal(err)
	}
	_, bobCode, err := d.CreateInvite(shared.ID, bob, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	_ = bobInvite

	if _, err := d.EnsureAccount(bob, "https://issuer.test", "bob"); err != nil {
		t.Fatal(err)
	}
	if err := d.RemoveGroupMembershipsForAccount(bob); err != nil {
		t.Fatal(err)
	}

	var accounts int
	if err := d.SQL().QueryRow(`SELECT COUNT(*) FROM app_accounts WHERE id = ?`, bob).Scan(&accounts); err != nil || accounts != 1 {
		t.Fatalf("app_accounts for bob = %d, %v", accounts, err)
	}
	if exists, err := d.HasAccount(bob); err != nil || !exists {
		t.Fatalf("account scope lost: %v, %v", exists, err)
	}
	if _, err := d.GetGroup(solo.ID, bob); err != ErrNotFound {
		t.Fatalf("sole-owned group err = %v, want ErrNoRows", err)
	}
	members, err := d.ListGroupMembers(shared.ID, alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 1 || members[0].AccountID != alice {
		t.Fatalf("shared members = %+v", members)
	}
	invites, err := d.ListInvites(shared.ID, alice)
	if err != nil {
		t.Fatal(err)
	}
	revoked := 0
	for _, in := range invites {
		var creator string
		if err := d.SQL().QueryRow(`SELECT created_by_account_id FROM group_invites WHERE id = ?`, in.ID).Scan(&creator); err != nil {
			t.Fatal(err)
		}
		if creator == bob {
			if in.RevokedAt == nil {
				t.Fatalf("invite %s by removed account still redeemable", in.ID)
			}
			revoked++
		}
	}
	if revoked == 0 {
		t.Fatal("expected the removed account's invite to be revoked")
	}
	if _, err := d.AcceptInvite(bobCode, alice, "Alice"); err == nil {
		t.Fatal("revoked invite should not redeem")
	}
}

// Invite codes are stored hashed only; no plaintext code column exists.
func TestGroupsInviteCodesAreHashed(t *testing.T) {
	d := openGroupTestDB(t)
	alice := ensureTestAccount(t, d, "https://issuer.test", "alice")
	rows, err := d.SQL().Query(`PRAGMA table_info(group_invites)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var cid int
		var name, ctype string
		var notNull, pk int
		var dflt any
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dflt, &pk); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, name := range names {
		if name == "code" {
			t.Fatal("group_invites stores a plaintext code column")
		}
		if name == "code_hash" {
			found = true
		}
	}
	if !found {
		t.Fatal("group_invites lacks code_hash")
	}
	invite, code, err := d.CreateInvite(mustGroup(t, d, alice).ID, alice, 1, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	var stored string
	if err := d.SQL().QueryRow(`SELECT code_hash FROM group_invites WHERE id = ?`, invite.ID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == code || strings.Contains(stored, code[:8]) {
		t.Fatal("code_hash matches the plaintext code")
	}
	if stored == "" {
		t.Fatal("empty code_hash")
	}
}

func mustGroup(t *testing.T, d *Database, owner string) Group {
	t.Helper()
	group, err := d.CreateGroup(owner, "Test", "Owner")
	if err != nil {
		t.Fatal(err)
	}
	return group
}

// Group writes never touch account-scoped financial tables.
func TestGroupsLeaveFinancialTablesAlone(t *testing.T) {
	d := openGroupTestDB(t)
	alice := ensureTestAccount(t, d, "https://issuer.test", "alice")
	bob := ensureTestAccount(t, d, "https://issuer.test", "bob")
	plan, err := d.EnsureAccount(alice, "https://issuer.test", "alice")
	if err != nil {
		t.Fatal(err)
	}
	before, err := plan.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	group, err := d.CreateGroup(alice, "Finance", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	_, code, err := d.CreateInvite(group.ID, alice, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.AcceptInvite(code, bob, "Bob"); err != nil {
		t.Fatal(err)
	}
	if err := d.RemoveMember(group.ID, alice, bob); err != nil {
		t.Fatal(err)
	}
	after, err := plan.LoadDocument()
	if err != nil {
		t.Fatal(err)
	}
	if (before == nil) != (after == nil) {
		t.Fatalf("document presence changed: %+v -> %+v", before, after)
	}
	var counts [2]int
	if err := d.SQL().QueryRow(`SELECT COUNT(*) FROM accounts WHERE account_id = ?`, alice).Scan(&counts[0]); err != nil {
		t.Fatal(err)
	}
	if counts[0] != 0 {
		t.Fatalf("financial rows changed: %d", counts[0])
	}
}

// Invite lifecycle: single-use, revocation, expiry, duplicate join, bounds.
func TestGroupsInviteLifecycle(t *testing.T) {
	d := openGroupTestDB(t)
	alice := ensureTestAccount(t, d, "https://issuer.test", "alice")
	bob := ensureTestAccount(t, d, "https://issuer.test", "bob")
	carol := ensureTestAccount(t, d, "https://issuer.test", "carol")
	group := mustGroup(t, d, alice)

	single, singleCode, err := d.CreateInvite(group.ID, alice, 1, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.AcceptInvite(singleCode, bob, "Bob"); err != nil {
		t.Fatal(err)
	}
	if _, err := d.AcceptInvite(singleCode, carol, "Carol"); err == nil {
		t.Fatal("single-use invite redeemed twice")
	}
	_ = single

	if _, _, err := d.CreateInvite(group.ID, alice, 0, 24*time.Hour); err == nil {
		t.Fatal("maxUses 0 should fail")
	}
	if _, _, err := d.CreateInvite(group.ID, alice, 101, 24*time.Hour); err == nil {
		t.Fatal("maxUses 101 should fail")
	}
	if _, _, err := d.CreateInvite(group.ID, alice, 1, time.Second); err == nil {
		t.Fatal("sub-minute TTL should fail")
	}

	revoked, revokedCode, err := d.CreateInvite(group.ID, alice, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.RevokeInvite(group.ID, revoked.ID, alice); err != nil {
		t.Fatal(err)
	}
	if _, err := d.AcceptInvite(revokedCode, carol, "Carol"); err == nil {
		t.Fatal("revoked invite redeemed")
	}

	expired, expiredCode, err := d.CreateInvite(group.ID, alice, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.SQL().Exec(`UPDATE group_invites SET expires_at = ? WHERE id = ?`, time.Now().Add(-time.Hour).Unix(), expired.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.AcceptInvite(expiredCode, carol, "Carol"); err == nil {
		t.Fatal("expired invite redeemed")
	}

	_, dupCode, err := d.CreateInvite(group.ID, alice, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.AcceptInvite(dupCode, bob, "Bob"); err == nil {
		t.Fatal("duplicate join should fail")
	}
	if _, err := d.AcceptInvite("not-a-code", carol, "Carol"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown code err = %v, want ErrNoRows", err)
	}
}

// Missing groups report 404 on every path, never a role denial.
func TestGroupsMissingGroupIsNotFound(t *testing.T) {
	d := openGroupTestDB(t)
	alice := ensureTestAccount(t, d, "https://issuer.test", "alice")
	missing := "00000000-0000-7000-8000-000000000000"
	if _, err := d.GetGroup(missing, alice); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get err = %v, want ErrNoRows", err)
	}
	if err := d.RenameGroup(missing, alice, "New"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("rename err = %v, want ErrNoRows", err)
	}
	if err := d.DeleteGroup(missing, alice); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete err = %v, want ErrNoRows", err)
	}
	if _, err := d.ListGroupMembers(missing, alice); !errors.Is(err, ErrNotFound) {
		t.Fatalf("list members err = %v, want ErrNoRows", err)
	}
	if err := d.UpdateMemberRole(missing, alice, alice, GroupRoleMember); !errors.Is(err, ErrNotFound) {
		t.Fatalf("role err = %v, want ErrNoRows", err)
	}
	if err := d.RemoveMember(missing, alice, alice); !errors.Is(err, ErrNotFound) {
		t.Fatalf("remove err = %v, want ErrNoRows", err)
	}
	if _, _, err := d.CreateInvite(missing, alice, 1, 24*time.Hour); !errors.Is(err, ErrNotFound) {
		t.Fatalf("invite err = %v, want ErrNoRows", err)
	}
	if _, err := d.ListInvites(missing, alice); !errors.Is(err, ErrNotFound) {
		t.Fatalf("list invites err = %v, want ErrNoRows", err)
	}
	if err := d.RevokeInvite(missing, "x", alice); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoke err = %v, want ErrNoRows", err)
	}
}

// Role matrix: admins manage invites and members; only owners manage roles
// and groups; members read.
func TestGroupsRoleMatrix(t *testing.T) {
	d := openGroupTestDB(t)
	alice := ensureTestAccount(t, d, "https://issuer.test", "alice")
	bob := ensureTestAccount(t, d, "https://issuer.test", "bob")
	carol := ensureTestAccount(t, d, "https://issuer.test", "carol")
	group := mustGroup(t, d, alice)

	_, code, err := d.CreateInvite(group.ID, alice, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.AcceptInvite(code, bob, "Bob"); err != nil {
		t.Fatal(err)
	}
	if _, err := d.AcceptInvite(code, carol, "Carol"); err != nil {
		t.Fatal(err)
	}
	if err := d.UpdateMemberRole(group.ID, alice, bob, GroupRoleAdmin); err != nil {
		t.Fatal(err)
	}

	// Member cannot manage.
	if err := d.RenameGroup(group.ID, carol, "New"); !errors.Is(err, ErrGroupForbidden) {
		t.Fatalf("member rename err = %v, want forbidden", err)
	}
	if _, _, err := d.CreateInvite(group.ID, carol, 1, 24*time.Hour); !errors.Is(err, ErrGroupForbidden) {
		t.Fatalf("member invite err = %v, want forbidden", err)
	}
	if _, err := d.ListInvites(group.ID, carol); !errors.Is(err, ErrGroupForbidden) {
		t.Fatalf("member list invites err = %v, want forbidden", err)
	}
	if err := d.UpdateMemberRole(group.ID, carol, bob, GroupRoleMember); !errors.Is(err, ErrGroupForbidden) {
		t.Fatalf("member role change err = %v, want forbidden", err)
	}
	// Members can read the member list.
	if _, err := d.ListGroupMembers(group.ID, carol); err != nil {
		t.Fatal(err)
	}
	// Non-members get 404.
	dave := ensureTestAccount(t, d, "https://issuer.test", "dave")
	if _, err := d.GetGroup(group.ID, dave); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member get err = %v, want ErrNoRows", err)
	}
	if _, err := d.ListGroupMembers(group.ID, dave); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member list err = %v, want ErrNoRows", err)
	}

	// Admin manages invites and members, but not roles or owners.
	if _, _, err := d.CreateInvite(group.ID, bob, 1, 24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ListInvites(group.ID, bob); err != nil {
		t.Fatal(err)
	}
	if err := d.RemoveMember(group.ID, bob, carol); err != nil {
		t.Fatal(err)
	}
	if err := d.UpdateMemberRole(group.ID, bob, alice, GroupRoleMember); !errors.Is(err, ErrGroupForbidden) {
		t.Fatalf("admin demote owner err = %v, want forbidden", err)
	}
	second, err := d.CreateGroup(alice, "Second", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	_, code2, err := d.CreateInvite(second.ID, alice, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.AcceptInvite(code2, bob, "Bob"); err != nil {
		t.Fatal(err)
	}
	if err := d.UpdateMemberRole(second.ID, alice, bob, GroupRoleAdmin); err != nil {
		t.Fatal(err)
	}
	if err := d.RemoveMember(second.ID, bob, alice); !errors.Is(err, ErrGroupForbidden) {
		t.Fatalf("admin kick owner err = %v, want forbidden", err)
	}
}
