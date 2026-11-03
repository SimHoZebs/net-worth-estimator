// Server-side group-share authorization and revocation (GRP-05). Two
// users share one physical file throughout: the visibility index is
// discovery only, CheckSharedPostingAccess decides every read from live
// rows, and revocation fences on commit with no positive auth cache.
package sqlite

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

func indexFixture(t *testing.T, aliceAccounts ...string) (*Database, string, store.Store, string, string) {
	t.Helper()
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice", aliceAccounts...)
	bob, _ := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	return d, alice, storeA, bob, group
}

func enableAuto(t *testing.T, d *Database, owner, group string, accounts ...string) store.SharingPolicy {
	t.Helper()
	return enablePolicy(t, d, owner, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: accounts, StartDate: "2026-01-01",
	})
}

func visibilityCount(t *testing.T, d *Database, where string, args ...any) int {
	t.Helper()
	var count int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM sharing_visibility `+where, args...).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func listShared(t *testing.T, d *Database, requester string) []store.SharedPostingRef {
	t.Helper()
	refs, err := d.ListSharedPostings(requester)
	if err != nil {
		t.Fatal(err)
	}
	return refs
}

func listedIDs(refs []store.SharedPostingRef) map[string]int {
	out := map[string]int{}
	for _, ref := range refs {
		out[ref.Posting.ID]++
	}
	return out
}

// Enabling a policy and creating a posting maintain the index in the same
// write either way round, and the list serves the covered posting.
func TestSharingIndexMaintainedSameWrite(t *testing.T) {
	d, alice, storeA, bob, group := indexFixture(t)
	posting := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	if got := visibilityCount(t, d, `WHERE owner_user_id = ?`, alice); got != 0 {
		t.Fatalf("index rows before policy = %d, want 0", got)
	}
	policy := enableAuto(t, d, alice, group, "checking")
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND posting_id = ? AND group_id = ? AND policy_version = ?`,
		alice, posting.ID, group, policy.Version); got != 1 {
		t.Fatalf("index rows after policy = %d, want 1 at version %d", got, policy.Version)
	}
	second := policyRow(t, storeA, sharingPostingB, "checking", nil, "2026-06-16")
	if got := visibilityCount(t, d, `WHERE owner_user_id = ?`, alice); got != 2 {
		t.Fatalf("index rows after second posting = %d, want 2", got)
	}
	refs := listShared(t, d, bob)
	ids := listedIDs(refs)
	if ids[posting.ID] != 1 || ids[second.ID] != 1 || len(refs) != 2 {
		t.Fatalf("shared list = %v, want both postings once", ids)
	}
	if access := checkPolicyAccess(t, d, alice, posting.ID, bob); !access.Allowed || access.Reason != store.SharingPolicyReasonAutomatic {
		t.Fatalf("automatic access = %+v, want automatic-group allow", access)
	}
}

// Any number of matching accounts still yields one reference per
// posting plus group; a second group yields a second reference while the
// list still shows the posting once.
func TestSharingIndexOneRowPerPostingGroup(t *testing.T) {
	d, alice, storeA, bob, group := indexFixture(t, "savings")
	other := sharingGroup(t, d, "alice", "Society", "bob")
	posting := policyRow(t, storeA, sharingPostingA, "checking", []string{"savings"}, "2026-06-15")
	enableAuto(t, d, alice, group, "checking", "savings")
	enableAuto(t, d, alice, other, "checking")
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND posting_id = ?`, alice, posting.ID); got != 2 {
		t.Fatalf("index rows = %d, want 2 (one per group)", got)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND posting_id = ? AND group_id = ?`, alice, posting.ID, group); got != 1 {
		t.Fatalf("index rows for one group = %d, want 1 despite two matching accounts", got)
	}
	refs := listShared(t, d, bob)
	if ids := listedIDs(refs); ids[posting.ID] != 1 || len(refs) != 1 {
		t.Fatalf("shared list = %v, want the posting exactly once", ids)
	}
}

// Owner edits reshape visibility on commit: moving away drops the row and
// denies, moving back restores both. An independent manual grant survives
// the move untouched.
func TestSharingIndexEditMovesVisibility(t *testing.T) {
	d, alice, storeA, bob, group := indexFixture(t, "savings")
	posting := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	enableAuto(t, d, alice, group, "checking")
	if _, err := d.GrantSharedPosting(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	moved := posting
	savings := "savings"
	moved.SourceAccountID = &savings
	if _, err := storeA.UpdatePosting(moved); err != nil {
		t.Fatal(err)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND posting_id = ?`, alice, posting.ID); got != 0 {
		t.Fatalf("index rows after move = %d, want 0", got)
	}
	if access := checkPolicyAccess(t, d, alice, posting.ID, bob); !access.Allowed || access.Reason != "manual-user" {
		t.Fatalf("access after move = %+v, want manual-user allow (automatic gone)", access)
	}
	checking := "checking"
	moved.SourceAccountID = &checking
	if _, err := storeA.UpdatePosting(moved); err != nil {
		t.Fatal(err)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND posting_id = ?`, alice, posting.ID); got != 1 {
		t.Fatalf("index rows after move back = %d, want 1", got)
	}
	if access := checkPolicyAccess(t, d, alice, posting.ID, bob); !access.Allowed {
		t.Fatalf("access after move back = %+v, want allow", access)
	}
}

// Disabling or narrowing a policy fences its generation on commit: rows go
// with the same write and reads deny immediately. Re-enabling rebuilds at
// a bumped version.
func TestSharingIndexRevocationFencesOnCommit(t *testing.T) {
	d, alice, storeA, bob, group := indexFixture(t)
	posting := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	first := enableAuto(t, d, alice, group, "checking")
	disabled, err := d.SetSharingPolicy(alice, group, store.SharingPolicyInput{Enabled: false, AccountIDs: []string{"checking"}, StartDate: "2026-01-01"})
	if err != nil {
		t.Fatal(err)
	}
	if disabled.Version != first.Version+1 {
		t.Fatalf("version after disable = %d, want %d", disabled.Version, first.Version+1)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND group_id = ?`, alice, group); got != 0 {
		t.Fatalf("index rows after disable = %d, want 0", got)
	}
	if access := checkPolicyAccess(t, d, alice, posting.ID, bob); access.Allowed {
		t.Fatal("automatic access allowed after disable")
	}
	if refs := listShared(t, d, bob); len(refs) != 0 {
		t.Fatalf("shared list after disable = %d, want 0", len(refs))
	}
	restored := enableAuto(t, d, alice, group, "checking")
	if restored.Version != disabled.Version+1 {
		t.Fatalf("version after re-enable = %d, want %d", restored.Version, disabled.Version+1)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND posting_id = ? AND policy_version = ?`,
		alice, posting.ID, restored.Version); got != 1 {
		t.Fatalf("index rows after re-enable = %d, want 1 at version %d", got, restored.Version)
	}
	narrowed, err := d.SetSharingPolicy(alice, group, store.SharingPolicyInput{Enabled: true, AccountIDs: []string{"checking"}, StartDate: "2026-01-01", EndDate: "2026-01-31"})
	if err != nil {
		t.Fatal(err)
	}
	_ = narrowed
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND posting_id = ?`, alice, posting.ID); got != 0 {
		t.Fatalf("index rows after narrowing out = %d, want 0", got)
	}
	if access := checkPolicyAccess(t, d, alice, posting.ID, bob); access.Allowed {
		t.Fatal("automatic access allowed after narrowing out")
	}
}

// A stale reference can never authorize: old-version rows, rows for
// non-covered or voided postings, and rows for dead audiences all fail
// the live gate and never reach the list.
func TestSharingIndexStaleRowNeverOverShares(t *testing.T) {
	d, alice, storeA, bob, group := indexFixture(t, "savings")
	covered := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	uncovered := policyRow(t, storeA, sharingPostingB, "savings", nil, "2026-06-15")
	first := enableAuto(t, d, alice, group, "checking")
	// Bump the generation so a retained old-version row exists nowhere in
	// the maintained slice.
	second, err := d.SetSharingPolicy(alice, group, store.SharingPolicyInput{Enabled: true, AccountIDs: []string{"checking"}, StartDate: "2026-02-01"})
	if err != nil {
		t.Fatal(err)
	}
	if second.Version != first.Version+1 {
		t.Fatalf("version after change = %d, want %d", second.Version, first.Version+1)
	}
	plant := func(postingID string, version int64) {
		t.Helper()
		if _, err := d.db.Exec(`INSERT INTO sharing_visibility(owner_user_id, posting_id, group_id, policy_version, updated_at)
			VALUES (?, ?, ?, ?, ?)`, alice, postingID, group, version, time.Now().Unix()); err != nil {
			t.Fatal(err)
		}
	}
	plant(uncovered.ID, second.Version)
	// Fence the maintained row, then retain only the old generation: the
	// list must under-share while the live rule still allows the detail.
	if _, err := d.db.Exec(`DELETE FROM sharing_visibility WHERE owner_user_id = ? AND posting_id = ?`, alice, covered.ID); err != nil {
		t.Fatal(err)
	}
	plant(covered.ID, first.Version)
	if access := checkPolicyAccess(t, d, alice, uncovered.ID, bob); access.Allowed {
		t.Fatal("stale index row authorized a non-covered posting")
	}
	refs := listShared(t, d, bob)
	for _, ref := range refs {
		if ref.Posting.ID == uncovered.ID {
			t.Fatal("stale index row listed a non-covered posting")
		}
		if ref.Posting.ID == covered.ID {
			t.Fatal("old-version index row listed a fenced generation")
		}
	}
	if _, err := d.ReadSharedPosting(alice, covered.ID, bob); err != nil {
		t.Fatalf("detail read under a fenced generation = %v, want live-rule allow", err)
	}
}

// A missing reference only hides a list entry: detail reads still
// evaluate the live rule, and a rebuild restores the list.
func TestSharingIndexMissingUnderSharesOnly(t *testing.T) {
	d, alice, storeA, bob, group := indexFixture(t)
	posting := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	enableAuto(t, d, alice, group, "checking")
	if _, err := d.db.Exec(`DELETE FROM sharing_visibility WHERE owner_user_id = ? AND posting_id = ?`, alice, posting.ID); err != nil {
		t.Fatal(err)
	}
	if refs := listShared(t, d, bob); len(refs) != 0 {
		t.Fatalf("shared list with dropped index = %d, want 0 (under-share)", len(refs))
	}
	read, err := d.ReadSharedPosting(alice, posting.ID, bob)
	if err != nil {
		t.Fatalf("detail read with dropped index = %v, want live-rule allow", err)
	}
	if read.ID != posting.ID {
		t.Fatalf("detail read id = %s, want %s", read.ID, posting.ID)
	}
	if err := d.RebuildSharingIndex(alice); err != nil {
		t.Fatal(err)
	}
	if refs := listShared(t, d, bob); len(refs) != 1 {
		t.Fatalf("shared list after rebuild = %d, want 1", len(refs))
	}
}

// Revoking a grant denies on commit; the grant and exclusion guards stay
// mutually exclusive in one transaction each way round.
func TestSharingRevocationRace(t *testing.T) {
	d, alice, storeA, bob, _ := indexFixture(t)
	posting := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	grant, err := d.GrantSharedPosting(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t))
	if err != nil || grant.Intent != store.SharingIntentShared {
		t.Fatalf("grant = %+v, %v", grant, err)
	}
	if refs := listShared(t, d, bob); len(refs) != 1 {
		t.Fatalf("shared list after grant = %d, want 1", len(refs))
	}
	if err := d.RevokeSharedPosting(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkPolicyAccess(t, d, alice, posting.ID, bob); access.Allowed {
		t.Fatal("access allowed after revoke")
	}
	if _, err := d.ReadSharedPosting(alice, posting.ID, bob); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("read after revoke = %v, want not-found", err)
	}
	if err := d.RevokeSharedPosting(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("double revoke = %v, want not-found", err)
	}
	exclusion, err := d.ExcludeSharedPosting(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t))
	if err != nil || exclusion.Intent != store.SharingIntentExcluded {
		t.Fatalf("exclude = %+v, %v", exclusion, err)
	}
	if _, err := d.GrantSharedPosting(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t)); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("grant over exclusion = %v, want invalid", err)
	}
	if err := d.RemoveSharedExclusion(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GrantSharedPosting(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatalf("grant after unexclude = %v", err)
	}
	if _, err := d.ExcludeSharedPosting(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t)); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("exclude over grant = %v, want invalid", err)
	}
}

// A wildcard exclusion covers current and future audiences: a group
// created after the exclusion stays denied while other postings flow.
func TestSharingWildcardCoversFutureGroups(t *testing.T) {
	d, alice, storeA, bob, _ := indexFixture(t)
	blocked := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	open := policyRow(t, storeA, sharingPostingB, "checking", nil, "2026-06-15")
	if _, err := d.ExcludeSharedPosting(alice, blocked.ID, store.SharingAudienceAll, "", sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	future := sharingGroup(t, d, "alice", "Future", "bob")
	enableAuto(t, d, alice, future, "checking")
	if access := checkPolicyAccess(t, d, alice, blocked.ID, bob); access.Allowed {
		t.Fatal("wildcard-excluded posting allowed in a future group")
	}
	if access := checkPolicyAccess(t, d, alice, open.ID, bob); !access.Allowed {
		t.Fatalf("open posting in future group = %+v, want allow", access)
	}
	refs := listShared(t, d, bob)
	if ids := listedIDs(refs); ids[blocked.ID] != 0 || ids[open.ID] != 1 {
		t.Fatalf("shared list = %v, want only the open posting", ids)
	}
}

// A friend exclusion follows the person through group grants: the named
// friend is denied while other members of the same group stay authorized.
func TestSharingFriendExclusionThroughGroup(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice")
	bob, _ := policyMember(t, d, "bob")
	carol, _ := policyMember(t, d, "carol")
	group := sharingGroup(t, d, "alice", "Club", "bob", "carol")
	posting := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	if _, err := d.GrantSharedPosting(alice, posting.ID, store.SharingAudienceGroup, group, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExcludeSharedPosting(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkPolicyAccess(t, d, alice, posting.ID, bob); access.Allowed {
		t.Fatal("excluded friend allowed through the group grant")
	}
	if access := checkPolicyAccess(t, d, alice, posting.ID, carol); !access.Allowed || access.Reason != "manual-group" {
		t.Fatalf("other member access = %+v, want manual-group allow", access)
	}
	if _, err := d.ReadSharedPosting(alice, posting.ID, bob); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("excluded friend read = %v, want not-found", err)
	}
	refs := listShared(t, d, carol)
	if ids := listedIDs(refs); ids[posting.ID] != 1 {
		t.Fatalf("carol list = %v, want the posting", ids)
	}
	if refs := listShared(t, d, bob); len(refs) != 0 {
		t.Fatalf("bob list = %d, want 0", len(refs))
	}
}

// Membership end denies immediately and fences the owner's slice; joining
// again rebuilds the slice so the list matches the live rule.
func TestSharingMembershipLeaveRemoveRejoin(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice")
	bob, storeB := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	second := sharingGroup(t, d, "alice", "Society", "bob")
	alicePosting := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	bobPosting := policyRow(t, storeB, sharingPostingB, "checking", nil, "2026-06-15")
	enableAuto(t, d, alice, group, "checking")
	enableAuto(t, d, alice, second, "checking")
	enableAuto(t, d, bob, group, "checking")
	if refs := listShared(t, d, bob); len(refs) != 1 {
		t.Fatalf("bob list before leave = %d, want 1 (alice posting)", len(refs))
	}
	if err := d.LeaveGroup(group, bob); err != nil {
		t.Fatal(err)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND group_id = ?`, bob, group); got != 0 {
		t.Fatalf("bob index rows after leave = %d, want 0", got)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND group_id = ?`, alice, group); got != 1 {
		t.Fatalf("alice index rows after bob leaves = %d, want 1", got)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND group_id = ?`, alice, second); got != 1 {
		t.Fatalf("alice rows in untouched group = %d, want 1", got)
	}
	// Leaving one group keeps the other audience: the union still
	// authorizes through the surviving membership.
	if access := checkPolicyAccess(t, d, alice, alicePosting.ID, bob); !access.Allowed {
		t.Fatalf("bob through surviving group = %+v, want allow", access)
	}
	if err := d.RemoveMember(second, alice, bob); err != nil {
		t.Fatal(err)
	}
	if access := checkPolicyAccess(t, d, alice, alicePosting.ID, bob); access.Allowed {
		t.Fatal("bob allowed after removal from the last group")
	}
	invite, code, err := d.CreateInvite(group, alice, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	_ = invite
	if _, err := d.AcceptInvite(code, bob, "bob"); err != nil {
		t.Fatal(err)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND group_id = ?`, bob, group); got != 1 {
		t.Fatalf("bob index rows after rejoin = %d, want 1", got)
	}
	if access := checkPolicyAccess(t, d, bob, bobPosting.ID, alice); !access.Allowed {
		t.Fatalf("bob posting after rejoin = %+v, want allow", access)
	}
	if refs := listShared(t, d, alice); len(refs) != 1 || refs[0].Posting.ID != bobPosting.ID {
		t.Fatalf("alice list after rejoin = %v, want bob posting", listedIDs(refs))
	}
}

// Forged owner, posting, account, and audience IDs fail closed without
// distinguishing missing from denied.
func TestSharingIndexForgedIDsFailClosed(t *testing.T) {
	d, alice, storeA, bob, group := indexFixture(t)
	posting := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	enableAuto(t, d, alice, group, "checking")
	forgedOwner := "user:0000000000000000000000000000000000000000000000000000000000000000"
	unknownPosting, _ := uuid.NewV7()
	unknownGroup, _ := uuid.NewV7()
	cases := []struct {
		name                      string
		owner, posting, requester string
	}{
		{"forged owner", forgedOwner, posting.ID, bob},
		{"malformed owner", "user:not-hex", posting.ID, bob},
		{"unknown posting", alice, unknownPosting.String(), bob},
		{"malformed posting", alice, "not-a-uuid", bob},
		{"forged requester", alice, posting.ID, forgedOwner},
		{"cross-user posting", bob, posting.ID, alice},
	}
	for _, tc := range cases {
		if access, err := d.CheckSharedPostingAccess(tc.owner, tc.posting, tc.requester); err != nil || access.Allowed {
			t.Fatalf("%s: access = %+v, %v, want denied", tc.name, access, err)
		}
		if _, err := d.ReadSharedPosting(tc.owner, tc.posting, tc.requester); !errors.Is(err, store.ErrNotFound) {
			t.Fatalf("%s: read = %v, want not-found", tc.name, err)
		}
	}
	if _, err := d.GrantSharedPosting(alice, posting.ID, store.SharingAudienceGroup, unknownGroup.String(), sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("grant to unknown group = %v, want not-found", err)
	}
	if _, err := d.GrantSharedPosting(bob, posting.ID, store.SharingAudienceUser, alice, sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("grant for another owner's posting = %v, want not-found", err)
	}
	if _, err := d.SetSharingPolicy(alice, group, store.SharingPolicyInput{Enabled: true, AccountIDs: []string{"no-such-account"}, StartDate: "2026-01-01"}); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("policy with forged account = %v, want invalid", err)
	}
	if _, err := d.GrantSharedPosting(alice, posting.ID, store.SharingAudienceUser, "user:forged", sharingKey(t)); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("grant to malformed user = %v, want invalid", err)
	}
}

// Manual and automatic reasons union without duplicating the posting.
func TestSharingDuplicateReasonsCountOnce(t *testing.T) {
	d, alice, storeA, bob, group := indexFixture(t)
	posting := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	enableAuto(t, d, alice, group, "checking")
	if _, err := d.GrantSharedPosting(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	refs := listShared(t, d, bob)
	if ids := listedIDs(refs); ids[posting.ID] != 1 || len(refs) != 1 {
		t.Fatalf("shared list = %v, want the posting exactly once", ids)
	}
}

// Bank sync maintains the index in the same write: pending seeds qualify
// like posted ones, settlement keeps access, and voiding retains the
// reference while the live gate denies.
func TestSharingSyncMaintainsIndex(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice", "prime_card")
	bob, _ := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	enableAuto(t, d, alice, group, "prime_card")
	seed := syncPendingPosting("sync-a", "prime_card", "2026-08-02")
	summary, err := storeA.ApplySync(nil, []BankDirective{syncPendingDirective(seed)})
	if err != nil || summary.PendingInserted != 1 {
		t.Fatalf("apply = %+v, err %v", summary, err)
	}
	model, err := storeA.LoadModel()
	if err != nil || len(model.Postings) != 1 {
		t.Fatalf("model postings = %v, %v", model, err)
	}
	pendingID := model.Postings[0].ID
	if !model.Postings[0].Pending {
		t.Fatal("synced row is not pending")
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND posting_id = ?`, alice, pendingID); got != 1 {
		t.Fatalf("index rows after sync seed = %d, want 1", got)
	}
	if access := checkPolicyAccess(t, d, alice, pendingID, bob); !access.Allowed || access.Reason != store.SharingPolicyReasonAutomatic {
		t.Fatalf("pending access = %+v, want automatic-group allow", access)
	}
	settled := syncSettledPosting("posted-a", "prime_card", "Posted a", "2026-08-03")
	settled.Source = SourceSimpleFIN
	summary, err = storeA.ApplySync(nil, []BankDirective{{Convert: &BankConvert{
		ID:      pendingID,
		Posting: settled.Posting,
		AddKeys: []BankKey{{Provider: SourceSimpleFIN, AccountID: "bridge-prime_card", TransactionID: "posted-a"}},
	}}})
	if err != nil || summary.SettledConverted != 1 {
		t.Fatalf("convert = %+v, err %v", summary, err)
	}
	if access := checkPolicyAccess(t, d, alice, pendingID, bob); !access.Allowed {
		t.Fatalf("settled access = %+v, want allow", access)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND posting_id = ?`, alice, pendingID); got != 1 {
		t.Fatalf("index rows after settle = %d, want 1", got)
	}
	voidSeed := syncPendingPosting("sync-b", "prime_card", "2026-08-04")
	if _, err := storeA.ApplySync(nil, []BankDirective{syncPendingDirective(voidSeed)}); err != nil {
		t.Fatal(err)
	}
	afterSeed, err := storeA.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	var voidID string
	for _, row := range afterSeed.Postings {
		if row.ID != pendingID {
			voidID = row.ID
		}
	}
	if voidID == "" {
		t.Fatal("second synced row missing")
	}
	summary, err = storeA.ApplySync(nil, []BankDirective{{Void: voidID}})
	if err != nil {
		t.Fatalf("void = %v", err)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND posting_id = ?`, alice, voidID); got != 1 {
		t.Fatalf("index rows after void = %d, want 1 retained", got)
	}
	if access := checkPolicyAccess(t, d, alice, voidID, bob); access.Allowed {
		t.Fatal("voided posting allowed through the retained reference")
	}
	if refs := listShared(t, d, bob); len(refs) != 1 || refs[0].Posting.ID != pendingID {
		t.Fatalf("shared list after void = %v, want only the settled posting", listedIDs(refs))
	}
}

// Deleting a posting drops its grants and index rows in the same write;
// deleting a group drops its policies, grants, and index slice.
func TestSharingDeleteDropsConsentAndIndex(t *testing.T) {
	d, alice, storeA, _, group := indexFixture(t)
	posting := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	enableAuto(t, d, alice, group, "checking")
	if _, err := d.GrantSharedPosting(alice, posting.ID, store.SharingAudienceGroup, group, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if err := storeA.DeletePosting(posting.ID); err != nil {
		t.Fatal(err)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND posting_id = ?`, alice, posting.ID); got != 0 {
		t.Fatalf("index rows after delete = %d, want 0", got)
	}
	var grants int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM sharing_grants WHERE owner_user_id = ? AND posting_id = ?`, alice, posting.ID).Scan(&grants); err != nil {
		t.Fatal(err)
	}
	if grants != 0 {
		t.Fatalf("grant rows after delete = %d, want 0", grants)
	}
	second := policyRow(t, storeA, sharingPostingB, "checking", nil, "2026-06-15")
	_ = second
	if err := d.DeleteGroup(group, alice); err != nil {
		t.Fatal(err)
	}
	if got := visibilityCount(t, d, `WHERE group_id = ?`, group); got != 0 {
		t.Fatalf("index rows after group delete = %d, want 0", got)
	}
	if _, err := d.GetSharingPolicy(alice, group); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("policy after group delete = %v, want not-found", err)
	}
}

// Every consent mutation audits actor, timestamp, and before/after
// coverage in the same transaction; idempotent retries audit nothing.
func TestSharingAuditTrail(t *testing.T) {
	d, alice, storeA, bob, group := indexFixture(t)
	posting := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	enableAuto(t, d, alice, group, "checking")
	auditCount := func(kind string) int {
		t.Helper()
		var count int
		if err := d.db.QueryRow(`SELECT COUNT(*) FROM sharing_audit WHERE owner_user_id = ? AND kind = ?`, alice, kind).Scan(&count); err != nil {
			t.Fatal(err)
		}
		return count
	}
	if got := auditCount("policy-set"); got != 1 {
		t.Fatalf("policy-set audits = %d, want 1", got)
	}
	var actor string
	var created int64
	if err := d.db.QueryRow(`SELECT actor_user_id, created_at FROM sharing_audit WHERE owner_user_id = ? AND kind = 'policy-set'`, alice).Scan(&actor, &created); err != nil {
		t.Fatal(err)
	}
	if actor != alice || created == 0 {
		t.Fatalf("policy-set audit actor/timestamp = %s/%d", actor, created)
	}
	var detail string
	if err := d.db.QueryRow(`SELECT detail_json FROM sharing_audit WHERE owner_user_id = ? AND kind = 'policy-set'`, alice).Scan(&detail); err != nil {
		t.Fatal(err)
	}
	if detail == "" || detail == "{}" {
		t.Fatal("policy-set audit carries no before/after coverage")
	}
	if _, err := d.GrantSharedPosting(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GrantSharedPosting(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if got := auditCount("grant"); got != 1 {
		t.Fatalf("grant audits after idempotent retry = %d, want 1", got)
	}
	if err := d.RevokeSharedPosting(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExcludeSharedPosting(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if err := d.RemoveSharedExclusion(alice, posting.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"revoke", "exclude", "unexclude"} {
		if got := auditCount(kind); got != 1 {
			t.Fatalf("%s audits = %d, want 1", kind, got)
		}
	}
	// The posting must move off the doomed account first: financial
	// references stay valid on delete, and the strip then narrows the
	// policy to zero accounts, which matches nothing.
	moved := posting
	moved.SourceAccountID = nil
	if _, err := storeA.UpdatePosting(moved); err != nil {
		t.Fatal(err)
	}
	if err := storeA.DeleteAccount("checking"); err != nil {
		t.Fatal(err)
	}
	if got := auditCount("policy-strip"); got != 1 {
		t.Fatalf("policy-strip audits = %d, want 1", got)
	}
	if access := checkPolicyAccess(t, d, alice, posting.ID, bob); access.Allowed {
		t.Fatal("access allowed after account strip")
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND group_id = ?`, alice, group); got != 0 {
		t.Fatalf("index rows after account strip = %d, want 0", got)
	}
}

// Stripping one account from a multi-account policy audits the true
// before/after coverage: the before list keeps the removed account.
func TestSharingIndexStripAuditsBeforeCoverage(t *testing.T) {
	d, alice, storeA, bob, group := indexFixture(t, "savings")
	posting := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	enableAuto(t, d, alice, group, "checking", "savings")
	// The posting must move off the doomed first account before the
	// delete: this exercises the aliasing case where the removed element
	// is not the last one.
	moved := posting
	moved.SourceAccountID = nil
	if _, err := storeA.UpdatePosting(moved); err != nil {
		t.Fatal(err)
	}
	if err := storeA.DeleteAccount("checking"); err != nil {
		t.Fatal(err)
	}
	var detail string
	if err := d.db.QueryRow(`SELECT detail_json FROM sharing_audit WHERE owner_user_id = ? AND kind = 'policy-strip'`, alice).Scan(&detail); err != nil {
		t.Fatalf("policy-strip audit = %v", err)
	}
	var entry struct {
		Before map[string]any `json:"before"`
		After  map[string]any `json:"after"`
	}
	if err := json.Unmarshal([]byte(detail), &entry); err != nil {
		t.Fatal(err)
	}
	before, _ := entry.Before["accounts"].([]any)
	after, _ := entry.After["accounts"].([]any)
	if len(before) != 2 || len(after) != 1 {
		t.Fatalf("strip coverage before/after = %v/%v, want 2/1 accounts", before, after)
	}
	found := false
	for _, id := range before {
		if id == "checking" {
			found = true
		}
	}
	if !found {
		t.Fatalf("strip before coverage = %v, want the removed account kept", before)
	}
	policy, err := d.GetSharingPolicy(alice, group)
	if err != nil {
		t.Fatal(err)
	}
	if len(policy.AccountIDs) != 1 || policy.AccountIDs[0] != "savings" {
		t.Fatalf("stripped accounts = %v, want [savings]", policy.AccountIDs)
	}
	if access := checkPolicyAccess(t, d, alice, posting.ID, bob); access.Allowed {
		t.Fatal("access allowed after the only covering account stripped")
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND posting_id = ?`, alice, posting.ID); got != 0 {
		t.Fatalf("index rows after strip-out = %d, want 0", got)
	}
}

// Scoped statements bind the owner last: two users sharing one file with
// identical posting IDs stay isolated through every index mutation, so a
// positional/named rotation would fail these assertions instead of
// silently crossing rows.
func TestSharingIndexScopedBinding(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice")
	bob, storeB := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	alicePosting := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	bobPosting := policyRow(t, storeB, sharingPostingA, "checking", nil, "2026-06-15")
	enableAuto(t, d, alice, group, "checking")
	enableAuto(t, d, bob, group, "checking")
	renamed := bobPosting
	renamed.Name = "Bob renamed"
	if _, err := storeB.UpdatePosting(renamed); err != nil {
		t.Fatal(err)
	}
	var owner, posting, audience string
	var version int64
	row := d.db.QueryRow(`SELECT owner_user_id, posting_id, group_id, policy_version FROM sharing_visibility WHERE owner_user_id = ?`, alice)
	if err := row.Scan(&owner, &posting, &audience, &version); err != nil {
		t.Fatalf("alice index row = %v", err)
	}
	if owner != alice || posting != alicePosting.ID || audience != group || version != 1 {
		t.Fatalf("alice index row = %s/%s/%s/v%d, want exact owner/posting/group/version", owner, posting, audience, version)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ?`, bob); got != 1 {
		t.Fatalf("bob index rows = %d, want 1", got)
	}
	if err := storeA.DeletePosting(alicePosting.ID); err != nil {
		t.Fatal(err)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ?`, alice); got != 0 {
		t.Fatalf("alice index rows after delete = %d, want 0", got)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ?`, bob); got != 1 {
		t.Fatalf("bob index rows after alice delete = %d, want 1 (untouched)", got)
	}
	if access := checkPolicyAccess(t, d, bob, bobPosting.ID, alice); !access.Allowed {
		t.Fatalf("bob sharing after alice delete = %+v, want allow", access)
	}
}

// The list path stays proportional to shared rows, not owners' models:
// evidence for the index replacing the per-read full scan.
func TestSharingIndexListPerformance(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice")
	bob, _ := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	enableAuto(t, d, alice, group, "checking")
	const rows = 300
	for i := 0; i < rows; i++ {
		id, err := uuid.NewV7()
		if err != nil {
			t.Fatal(err)
		}
		policyRow(t, storeA, id.String(), "checking", nil, "2026-06-15")
	}
	// Private noise outside the policy must never leak into the list.
	private, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	noise := policyRow(t, storeA, private.String(), "checking", nil, "2020-01-01")
	start := time.Now()
	refs := listShared(t, d, bob)
	elapsed := time.Since(start)
	if len(refs) != rows {
		t.Fatalf("shared list = %d, want %d", len(refs), rows)
	}
	seen := map[string]bool{}
	for _, ref := range refs {
		if ref.OwnerUserID != alice {
			t.Fatalf("list owner = %s, want alice", ref.OwnerUserID)
		}
		if seen[ref.Posting.ID] {
			t.Fatalf("duplicate listing for %s", ref.Posting.ID)
		}
		seen[ref.Posting.ID] = true
	}
	if seen[noise.ID] {
		t.Fatal("out-of-range posting listed")
	}
	checkStart := time.Now()
	access := checkPolicyAccess(t, d, alice, refs[0].Posting.ID, bob)
	checkElapsed := time.Since(checkStart)
	if !access.Allowed {
		t.Fatal("sampled detail check denied")
	}
	t.Logf("grp-05 list: %d shared of %d postings in %s; single check in %s", len(refs), rows+1, elapsed, checkElapsed)
	if elapsed > 120*time.Second {
		t.Fatalf("shared list took %s, want under 120s", elapsed)
	}
}

// Rebuild is the operator recovery path: it restores a wiped index from
// live rows and audits the run without changing authorization.
func TestSharingIndexRebuildRecovery(t *testing.T) {
	d, alice, storeA, bob, group := indexFixture(t)
	posting := policyRow(t, storeA, sharingPostingA, "checking", nil, "2026-06-15")
	policy := enableAuto(t, d, alice, group, "checking")
	if _, err := d.db.Exec(`DELETE FROM sharing_visibility WHERE owner_user_id = ?`, alice); err != nil {
		t.Fatal(err)
	}
	if err := d.RebuildSharingIndex(alice); err != nil {
		t.Fatal(err)
	}
	if got := visibilityCount(t, d, `WHERE owner_user_id = ? AND posting_id = ? AND policy_version = ?`,
		alice, posting.ID, policy.Version); got != 1 {
		t.Fatalf("index rows after rebuild = %d, want 1 at version %d", got, policy.Version)
	}
	if refs := listShared(t, d, bob); len(refs) != 1 {
		t.Fatalf("shared list after rebuild = %d, want 1", len(refs))
	}
	var audits int
	if err := d.db.QueryRow(`SELECT COUNT(*) FROM sharing_audit WHERE owner_user_id = ? AND kind = 'index-rebuild'`, alice).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 1 {
		t.Fatalf("index-rebuild audits = %d, want 1", audits)
	}
	if err := d.RebuildSharingIndex("user:not-hex"); err == nil {
		t.Fatal("rebuild with malformed owner allowed")
	}
}
