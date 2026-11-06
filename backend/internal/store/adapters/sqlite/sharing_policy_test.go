// Automatic sharing-policy preferences (GRP-02). Two users share one
// physical file throughout: policies, grants, and transactions stay
// owner-scoped, and revocation lands on commit with no cache.
package sqlite

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

func policyNoon(day string) int64 {
	stamp, err := time.ParseInLocation("2006-01-02", day, time.UTC)
	if err != nil {
		panic(err)
	}
	return stamp.Add(12 * time.Hour).Unix()
}

func policyMember(t *testing.T, d *Database, subject string, accounts ...string) (string, store.Store) {
	t.Helper()
	user, scoped := sharingUser(t, d, subject)
	for _, account := range accounts {
		if account == "checking" {
			continue
		}
		if _, err := scoped.CreateAccount(types.Account{ID: account, Name: account, Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}
	return user, scoped
}

func policyRow(t *testing.T, scoped store.Store, id, source string, destinations []string, day string) types.Transaction {
	t.Helper()
	var sourceID *string
	if source != "" {
		sourceID = &source
	}
	stamp := policyNoon(day)
	transaction, err := scoped.CreateTransaction(types.Transaction{
		ID: id, Name: "Policy " + id, SourceAccountID: sourceID, Destinations: destinations,
		Amount:          types.TransactionAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "10"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      stamp,
		TransactionTime: stamp,
		Enabled:         true,
	})
	if err != nil {
		t.Fatal(err)
	}
	return transaction
}

func enablePolicy(t *testing.T, d *Database, owner, group string, input store.SharingPolicyInput) store.SharingPolicy {
	t.Helper()
	policy, err := d.SetSharingPolicy(owner, group, input)
	if err != nil {
		t.Fatal(err)
	}
	return policy
}

func checkPolicyAccess(t *testing.T, d *Database, owner, transaction, requester string) store.SharedTransactionAccess {
	t.Helper()
	access, err := d.CheckSharedTransactionAccess(owner, transaction, requester)
	if err != nil {
		t.Fatal(err)
	}
	return access
}

// Automatic sharing is off by default; manual transaction shares stay usable
// while it is off.
func TestSharingPolicyOffByDefault(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice")
	bob, _ := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	transaction := policyRow(t, storeA, sharingTransactionA, "checking", nil, "2026-06-15")

	if _, err := d.GetSharingPolicy(alice, group); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("get absent policy = %v, want not-found", err)
	}
	if policies, err := d.ListSharingPolicies(alice); err != nil || len(policies) != 0 {
		t.Fatalf("list = %v, %v, want empty", policies, err)
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); access.Allowed {
		t.Fatal("automatic access allowed with no policy")
	}
	if _, err := d.GrantSharedTransaction(alice, transaction.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatalf("manual grant with automatic off: %v", err)
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); !access.Allowed || access.Reason != "manual-user" {
		t.Fatalf("manual access = %+v, want manual-user allow", access)
	}
}

// Policy writes require current membership, owner-held accounts, a real
// interval, and selected accounts when enabling.
func TestSharingPolicyWriteValidation(t *testing.T) {
	d := openSharingTestDB(t)
	alice, _ := policyMember(t, d, "alice")
	bob, _ := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	unknownGroup, _ := uuid.NewV7()

	outsider, err := d.EnsureGroupUser(sharingIssuer, "outsider")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.SetSharingPolicy(outsider, group, store.SharingPolicyInput{StartDate: "2026-01-01"}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("outsider set = %v, want not-found", err)
	}
	if _, err := d.SetSharingPolicy(alice, unknownGroup.String(), store.SharingPolicyInput{StartDate: "2026-01-01"}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("unknown group set = %v, want not-found", err)
	}
	for _, tc := range []struct {
		name  string
		input store.SharingPolicyInput
	}{
		{"enable without accounts", store.SharingPolicyInput{Enabled: true, StartDate: "2026-01-01"}},
		{"unknown account", store.SharingPolicyInput{Enabled: true, AccountIDs: []string{"ghost"}, StartDate: "2026-01-01"}},
		{"impossible start", store.SharingPolicyInput{AccountIDs: []string{"checking"}, StartDate: "2026-02-30"}},
		{"end before start", store.SharingPolicyInput{AccountIDs: []string{"checking"}, StartDate: "2026-06-01", EndDate: "2026-05-31"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := d.SetSharingPolicy(alice, group, tc.input); !errors.Is(err, store.ErrGroupInvalid) {
				t.Fatalf("set = %v, want invalid", err)
			}
		})
	}
	if _, err := d.SetSharingPolicy("bogus", group, store.SharingPolicyInput{StartDate: "2026-01-01"}); !errors.Is(err, store.ErrGroupInvalid) {
		t.Fatalf("bogus owner set = %v, want invalid", err)
	}
	// A stored policy never appears from rejected writes.
	if _, err := d.GetSharingPolicy(alice, group); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("policy stored after rejected writes: %v", err)
	}
	if _, err := d.GetSharingPolicy(bob, group); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("bob policy = %v, want absent", err)
	}
}

// Eligibility covers any currently involved account (transfers included),
// the inclusive interval, and pending rows; one transaction lists once.
func TestSharingPolicyEligibilityMatrix(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice", "savings", "other", "elsewhere")
	bob, _ := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")

	const (
		srcMatch  = "01900000-0000-7000-8000-0000000000b1"
		dstMatch  = "01900000-0000-7000-8000-0000000000b2"
		multi     = "01900000-0000-7000-8000-0000000000b3"
		early     = "01900000-0000-7000-8000-0000000000b4"
		late      = "01900000-0000-7000-8000-0000000000b5"
		unmatched = "01900000-0000-7000-8000-0000000000b6"
	)
	policyRow(t, storeA, srcMatch, "checking", nil, "2026-06-15")
	policyRow(t, storeA, dstMatch, "other", []string{"savings"}, "2026-06-15")
	policyRow(t, storeA, multi, "checking", []string{"savings"}, "2026-06-15")
	policyRow(t, storeA, early, "checking", nil, "2025-12-31")
	policyRow(t, storeA, late, "checking", nil, "2027-01-01")
	policyRow(t, storeA, unmatched, "other", []string{"elsewhere"}, "2026-06-15")

	enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking", "savings"},
		StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	for id, want := range map[string]bool{
		srcMatch: true, dstMatch: true, multi: true,
		early: false, late: false, unmatched: false,
	} {
		if access := checkPolicyAccess(t, d, alice, id, bob); access.Allowed != want {
			t.Fatalf("transaction %s allowed = %v, want %v", id, access.Allowed, want)
		}
	}
	if access := checkPolicyAccess(t, d, alice, srcMatch, bob); access.Reason != store.SharingPolicyReasonAutomatic {
		t.Fatalf("reason = %q, want automatic-group", access.Reason)
	}
	refs, err := d.ListSharedTransactions(bob)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 3 {
		t.Fatalf("shared list has %d transactions, want 3 (multi-match listed once)", len(refs))
	}
	seen := map[string]int{}
	for _, ref := range refs {
		if ref.OwnerUserID != alice {
			t.Fatalf("list owner = %s, want alice", ref.OwnerUserID)
		}
		seen[ref.Transaction.ID]++
	}
	for id, count := range seen {
		if count != 1 {
			t.Fatalf("transaction %s listed %d times, want once", id, count)
		}
	}
}

// Interval edges are inclusive on both ends; an empty end stays open.
func TestSharingPolicyIntervalEdges(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice")
	bob, _ := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	const (
		startEdge = "01900000-0000-7000-8000-0000000000c1"
		endEdge   = "01900000-0000-7000-8000-0000000000c2"
		future    = "01900000-0000-7000-8000-0000000000c3"
	)
	policyRow(t, storeA, startEdge, "checking", nil, "2026-03-01")
	policyRow(t, storeA, endEdge, "checking", nil, "2026-03-31")
	policyRow(t, storeA, future, "checking", nil, "2027-05-05")

	enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"},
		StartDate: "2026-03-01", EndDate: "2026-03-31",
	})
	for id, want := range map[string]bool{startEdge: true, endEdge: true, future: false} {
		if access := checkPolicyAccess(t, d, alice, id, bob); access.Allowed != want {
			t.Fatalf("transaction %s allowed = %v, want %v", id, access.Allowed, want)
		}
	}
	enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"}, StartDate: "2026-03-01",
	})
	if access := checkPolicyAccess(t, d, alice, future, bob); !access.Allowed {
		t.Fatal("open-ended policy denies a later in-range transaction")
	}
}

// The start defaults to the setup day as a fixed date; both ends stay
// editable afterwards.
func TestSharingPolicySetupDayDefault(t *testing.T) {
	d := openSharingTestDB(t)
	alice, _ := policyMember(t, d, "alice")
	group := sharingGroup(t, d, "alice", "Club")

	policy := enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"},
	})
	if policy.StartDate != store.DefaultSharingStartDate() {
		t.Fatalf("start = %q, want setup-day default", policy.StartDate)
	}
	if policy.Version != 1 {
		t.Fatalf("version = %d, want 1", policy.Version)
	}
	stored, err := d.GetSharingPolicy(alice, group)
	if err != nil {
		t.Fatal(err)
	}
	if stored.StartDate != policy.StartDate || stored.EndDate != "" {
		t.Fatalf("stored interval = %+v, want fixed start with open end", stored)
	}
	edited := enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"},
		StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	if edited.StartDate != "2026-01-01" || edited.EndDate != "2026-12-31" {
		t.Fatalf("edited interval = %+v, want explicit bounds", edited)
	}
	if edited.Version != 2 {
		t.Fatalf("version = %d, want 2 after edit", edited.Version)
	}
}

// Current associations decide: moving or re-dating a row reshapes
// visibility without touching the policy.
func TestSharingPolicyFollowsCurrentRows(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice", "savings")
	bob, _ := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	transaction := policyRow(t, storeA, sharingTransactionA, "checking", nil, "2026-06-15")

	enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"},
		StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); !access.Allowed {
		t.Fatal("in-range transaction denied")
	}
	moved := transaction
	other := "savings"
	moved.SourceAccountID = &other
	if _, err := storeA.UpdateTransaction(moved); err != nil {
		t.Fatal(err)
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); access.Allowed {
		t.Fatal("transaction moved off selected accounts still shared")
	}
	restored := moved
	checking := "checking"
	restored.SourceAccountID = &checking
	if _, err := storeA.UpdateTransaction(restored); err != nil {
		t.Fatal(err)
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); !access.Allowed {
		t.Fatal("transaction moved back not shared again")
	}
	redated := restored
	redated.TransactionTime = policyNoon("2027-02-02")
	if _, err := storeA.UpdateTransaction(redated); err != nil {
		t.Fatal(err)
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); access.Allowed {
		t.Fatal("transaction re-dated out of range still shared")
	}
}

// Pending bank rows qualify exactly like posted ones, including
// late-imported backdated rows with no review step.
func TestSharingPolicyPendingAndLateImported(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice")
	bob, _ := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")

	enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"},
		StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	item := syncPendingTransaction("policy-pending", "checking", "2026-06-10")
	if summary := applyDirectives(t, storeA, []BankDirective{syncPendingDirective(item)}); summary.PendingInserted != 1 {
		t.Fatalf("pending seed = %+v", summary)
	}
	model, err := storeA.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	var pendingID string
	for _, transaction := range model.Transactions {
		if transaction.Pending && transaction.Source != SourceUser {
			pendingID = transaction.ID
		}
	}
	if pendingID == "" {
		t.Fatal("pending bank row missing")
	}
	if access := checkPolicyAccess(t, d, alice, pendingID, bob); !access.Allowed || access.Reason != store.SharingPolicyReasonAutomatic {
		t.Fatalf("pending access = %+v, want automatic-group allow", access)
	}
	refs, err := d.ListSharedTransactions(bob)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].Transaction.ID != pendingID {
		t.Fatalf("shared list = %+v, want the pending transaction", refs)
	}
}

// Void rows never authorize; deleted rows authorize nothing afterwards.
func TestSharingPolicyVoidAndDeletedExcluded(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice")
	bob, _ := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	voidID := seedVoidBankRow(t, storeA, "Voided", "checking", "50.00", "void-key")
	gone := policyRow(t, storeA, sharingTransactionB, "checking", nil, "2026-06-15")

	enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"},
		StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	if access := checkPolicyAccess(t, d, alice, voidID, bob); access.Allowed {
		t.Fatal("void transaction allowed")
	}
	if _, err := d.ReadSharedTransaction(alice, voidID, bob); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("void read = %v, want not-found", err)
	}
	if err := storeA.DeleteTransaction(gone.ID); err != nil {
		t.Fatal(err)
	}
	if access := checkPolicyAccess(t, d, alice, gone.ID, bob); access.Allowed {
		t.Fatal("deleted transaction allowed")
	}
	preview, err := d.PreviewSharingPolicy(alice, group)
	if err != nil {
		t.Fatal(err)
	}
	if preview.EligibleTransactions != 0 {
		t.Fatalf("preview counts %d eligible, want 0 (void/deleted excluded)", preview.EligibleTransactions)
	}
}

// Disable or narrow revokes automatic access after commit while independent
// manual grants and private copies survive.
func TestSharingPolicyRevocationAfterCommit(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice", "savings")
	bob, storeB := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	transaction := policyRow(t, storeA, sharingTransactionA, "checking", nil, "2026-06-15")

	enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"},
		StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	if _, err := d.GrantSharedTransaction(alice, transaction.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	copied, err := d.CopySharedTransaction(alice, transaction.ID, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	disabled := enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		AccountIDs: []string{"checking"}, StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	if disabled.Enabled || disabled.Version != 2 {
		t.Fatalf("disabled policy = %+v, want disabled version 2", disabled)
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); !access.Allowed || access.Reason != "manual-user" {
		t.Fatalf("access after disable = %+v, want surviving manual-user grant", access)
	}
	if err := d.RevokeSharedTransaction(alice, transaction.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); access.Allowed {
		t.Fatal("automatic access survives disable")
	}
	if refs, err := d.ListSharedTransactions(bob); err != nil || len(refs) != 0 {
		t.Fatalf("shared list = %+v, %v, want empty after revoke", refs, err)
	}
	model, err := storeB.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, row := range model.Transactions {
		if row.ID == copied.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("private copy erased by revocation")
	}
}

// Narrowing the interval or deselecting the account revokes on commit.
func TestSharingPolicyNarrowRevokes(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice", "savings")
	bob, _ := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	transaction := policyRow(t, storeA, sharingTransactionA, "checking", nil, "2026-06-15")

	enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking", "savings"},
		StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking", "savings"},
		StartDate: "2026-01-01", EndDate: "2026-06-14",
	})
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); access.Allowed {
		t.Fatal("narrowed end still shares")
	}
	enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"savings"},
		StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); access.Allowed {
		t.Fatal("deselected account still shares")
	}
	policy, err := d.GetSharingPolicy(alice, group)
	if err != nil {
		t.Fatal(err)
	}
	if policy.Version != 3 {
		t.Fatalf("version = %d, want 3 after two narrows", policy.Version)
	}
}

// Counts-only preview: audience and exposure without amounts or payees.
func TestSharingPolicyPreviewCounts(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice")
	bob, _ := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	policyRow(t, storeA, sharingTransactionA, "checking", nil, "2026-06-15")
	policyRow(t, storeA, sharingTransactionB, "checking", nil, "2026-07-15")

	enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"},
		StartDate: "2026-06-01", EndDate: "2026-06-30",
	})
	preview, err := d.PreviewSharingPolicy(alice, group)
	if err != nil {
		t.Fatal(err)
	}
	if preview.EligibleTransactions != 1 {
		t.Fatalf("eligible = %d, want 1", preview.EligibleTransactions)
	}
	if preview.MemberCount != 2 {
		t.Fatalf("members = %d, want 2", preview.MemberCount)
	}
	if !preview.Enabled || preview.StartDate != "2026-06-01" || preview.EndDate != "2026-06-30" {
		t.Fatalf("preview interval = %+v", preview)
	}
	if len(preview.AccountIDs) != 1 || preview.AccountIDs[0] != "checking" {
		t.Fatalf("preview accounts = %v", preview.AccountIDs)
	}
	if _, err := d.PreviewSharingPolicy(bob, group); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("bob preview = %v, want not-found", err)
	}
}

// Deleting an account strips it from policies in the same write with a
// version bump; recreating the ID does not silently reattach consent.
func TestSharingPolicyAccountDeletionStrips(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice")
	bob, _ := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	transaction := policyRow(t, storeA, sharingTransactionA, "checking", nil, "2026-06-15")

	enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"},
		StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	// The transaction must move off the doomed account first: financial
	// references stay valid on delete.
	moved := transaction
	moved.SourceAccountID = nil
	if _, err := storeA.UpdateTransaction(moved); err != nil {
		t.Fatal(err)
	}
	if err := storeA.DeleteAccount("checking"); err != nil {
		t.Fatal(err)
	}
	policy, err := d.GetSharingPolicy(alice, group)
	if err != nil {
		t.Fatal(err)
	}
	if len(policy.AccountIDs) != 0 {
		t.Fatalf("accounts = %v, want stripped", policy.AccountIDs)
	}
	if policy.Version != 2 {
		t.Fatalf("version = %d, want 2 after strip", policy.Version)
	}
	if _, err := storeA.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); access.Allowed {
		t.Fatal("recreated account ID silently reattached consent")
	}
}

// Group deletion purges preferences; model clear/reset drops them too.
func TestSharingPolicyGroupDeletionAndClear(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice")
	bob, _ := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	transaction := policyRow(t, storeA, sharingTransactionA, "checking", nil, "2026-06-15")

	enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"},
		StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	if err := d.DeleteGroup(group, alice); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetSharingPolicy(alice, group); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("policy survives group deletion: %v", err)
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); access.Allowed {
		t.Fatal("automatic access survives group deletion")
	}
	regroup := sharingGroup(t, d, "alice", "Reformed", "bob")
	enablePolicy(t, d, alice, regroup, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"},
		StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	if err := storeA.Clear(); err != nil {
		t.Fatal(err)
	}
	if _, err := d.GetSharingPolicy(alice, regroup); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("policy survives model clear: %v", err)
	}
	if policies, err := d.ListSharingPolicies(alice); err != nil || len(policies) != 0 {
		t.Fatalf("list after clear = %v, %v, want empty", policies, err)
	}
}

// Policies stay owner-scoped with identical IDs and accounts in one file:
// one member's opt-in never shares another member's rows.
func TestSharingPolicyIsolation(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice")
	bob, storeB := policyMember(t, d, "bob")
	group := sharingGroup(t, d, "alice", "Club", "bob")
	policyRow(t, storeA, sharingTransactionA, "checking", nil, "2026-06-15")
	policyRow(t, storeB, sharingTransactionA, "checking", nil, "2026-06-15")

	enablePolicy(t, d, bob, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"},
		StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	// Bob's opt-in shares bob's rows with alice, never alice's rows.
	if access := checkPolicyAccess(t, d, alice, sharingTransactionA, bob); access.Allowed {
		t.Fatal("bob's policy shares alice's rows")
	}
	if access := checkPolicyAccess(t, d, bob, sharingTransactionA, alice); !access.Allowed {
		t.Fatal("bob's policy does not share bob's rows with alice")
	}
	refs, err := d.ListSharedTransactions(alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].OwnerUserID != bob {
		t.Fatalf("alice list = %+v, want bob's transaction only", refs)
	}
	if refs, err := d.ListSharedTransactions(bob); err != nil || len(refs) != 0 {
		t.Fatalf("bob list = %+v, %v, want empty", refs, err)
	}
	// Carol is outside the group entirely.
	carol, err := d.EnsureGroupUser(sharingIssuer, "carol")
	if err != nil {
		t.Fatal(err)
	}
	if access := checkPolicyAccess(t, d, bob, sharingTransactionA, carol); access.Allowed {
		t.Fatal("outsider reads through automatic policy")
	}
}

// Exclusions deny automatic access per viewer while other members stay
// authorized; removing the exclusion restores it.
func TestSharingPolicyExclusionBeatsAutomatic(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice")
	bob, _ := policyMember(t, d, "bob")
	carol, err := d.EnsureGroupUser(sharingIssuer, "carol")
	if err != nil {
		t.Fatal(err)
	}
	carolScoped, err := d.EnsureUser(carol, sharingIssuer, "carol")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := carolScoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	group := sharingGroup(t, d, "alice", "Club", "bob", "carol")
	transaction := policyRow(t, storeA, sharingTransactionA, "checking", nil, "2026-06-15")

	enablePolicy(t, d, alice, group, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"},
		StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	if _, err := d.ExcludeSharedTransaction(alice, transaction.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); access.Allowed {
		t.Fatal("user exclusion does not beat automatic")
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, carol); !access.Allowed {
		t.Fatal("exclusion leaked to another member")
	}
	if err := d.RemoveSharedExclusion(alice, transaction.ID, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := d.ExcludeSharedTransaction(alice, transaction.ID, store.SharingAudienceAll, "", sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); access.Allowed {
		t.Fatal("wildcard exclusion does not beat automatic")
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, carol); access.Allowed {
		t.Fatal("wildcard exclusion leaked")
	}
}

// Leaving denies automatic access immediately; the kept preference resumes
// on rejoin without a fresh opt-in.
func TestSharingPolicyLeaveAndRejoin(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := policyMember(t, d, "alice")
	bob, err := d.EnsureGroupUser(sharingIssuer, "bob")
	if err != nil {
		t.Fatal(err)
	}
	group, err := d.CreateGroup(alice, "Club", "alice")
	if err != nil {
		t.Fatal(err)
	}
	invite, code, err := d.CreateInvite(group.ID, alice, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	_ = invite
	if _, err := d.AcceptInvite(code, bob, "bob"); err != nil {
		t.Fatal(err)
	}
	transaction := policyRow(t, storeA, sharingTransactionA, "checking", nil, "2026-06-15")
	enablePolicy(t, d, alice, group.ID, store.SharingPolicyInput{
		Enabled: true, AccountIDs: []string{"checking"},
		StartDate: "2026-01-01", EndDate: "2026-12-31",
	})
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); !access.Allowed {
		t.Fatal("member denied before leave")
	}
	if err := d.LeaveGroup(group.ID, bob); err != nil {
		t.Fatal(err)
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); access.Allowed {
		t.Fatal("leaver keeps automatic access")
	}
	if _, err := d.GetSharingPolicy(alice, group.ID); err != nil {
		t.Fatalf("owner policy dropped on member leave: %v", err)
	}
	invite2, code2, err := d.CreateInvite(group.ID, alice, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	_ = invite2
	if _, err := d.AcceptInvite(code2, bob, "bob"); err != nil {
		t.Fatal(err)
	}
	if access := checkPolicyAccess(t, d, alice, transaction.ID, bob); !access.Allowed {
		t.Fatal("rejoined member not shared again")
	}
}
