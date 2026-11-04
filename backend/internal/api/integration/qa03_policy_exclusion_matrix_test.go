package integration

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// QA-03 follow-up: every group interaction around the stale-feed fix.
//
// These journeys extend the landed QA-03 suite without re-testing the
// fix's own regression specs (own rows list in the feed; mutations
// refresh views to post-commit truth). They pin the behavior around
// that fix: policy lifecycle, exclusions, membership, roles, copies and
// inbox under membership changes, error and empty states, and
// concurrency spot checks. Two real users share one physical database
// file wherever another party is involved. The only stand-ins are
// identity itself (principal in context, no login round trip) and one
// setup-only clock backdate for invite expiry; every authorization,
// read, and mutation runs over production HTTP.

const qa03MatrixDay = 1781524800 // 2026-06-15 12:00 UTC

func qa03OwnerPlan(t *testing.T, social *qa03Social) http.Handler {
	t.Helper()
	return New(social.ownerSC, Config{})
}

func qa03DeleteOwnerAccount(t *testing.T, social *qa03Social, accountID string, wantPersisted bool) {
	t.Helper()
	var payload struct {
		DeletedID string                       `json:"deletedId"`
		Issues    []types.ModelValidationIssue `json:"issues"`
		Saved     bool                         `json:"saved"`
	}
	response := doRowRequest(t, qa03OwnerPlan(t, social), http.MethodDelete, "/v1/accounts/"+accountID, "")
	if response.Code != http.StatusOK {
		t.Fatalf("delete account %s = %d %s", accountID, response.Code, response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Saved != wantPersisted {
		t.Fatalf("delete account %s saved = %v, want %v (issues %+v)", accountID, payload.Saved, wantPersisted, payload.Issues)
	}
}

func qa03MatrixFeed(t *testing.T, social *qa03Social, subject, groupID string) map[string]any {
	t.Helper()
	return qa03Feed(t, social, subject, "/v1/shared/groups/"+groupID+"/feed")
}

func qa03FeedItemIDs(feed map[string]any) []string {
	var ids []string
	items, _ := feed["items"].([]any)
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		owner, _ := item["ownerUserId"].(string)
		posting, _ := item["posting"].(map[string]any)
		id, _ := posting["id"].(string)
		ids = append(ids, owner+"/"+id)
	}
	return ids
}

func qa03FeedCount(feed map[string]any) int {
	totals, _ := feed["totals"].(map[string]any)
	count, _ := totals["count"].(float64)
	return int(count)
}

func qa03FeedHas(feed map[string]any, owner, posting string) bool {
	for _, id := range qa03FeedItemIDs(feed) {
		if id == owner+"/"+posting {
			return true
		}
	}
	return false
}

// Every feed response must describe exactly the set it lists.
func qa03FeedAgrees(t *testing.T, feed map[string]any) {
	t.Helper()
	items, _ := feed["items"].([]any)
	if qa03FeedCount(feed) != len(items) {
		t.Fatalf("feed totals count %d disagrees with %d listed items: %+v", qa03FeedCount(feed), len(items), feed["totals"])
	}
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		if item["sourceDisplayName"] == "" || item["audiences"] == nil || item["posting"] == nil {
			t.Fatalf("feed item = %+v, want named source with audiences and posting", item)
		}
	}
}

func qa03MatrixGroup(t *testing.T, social *qa03Social) string {
	t.Helper()
	created := qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups", "qa03-owner", `{"name":"Household"}`), http.StatusCreated)
	group, _ := created["group"].(map[string]any)
	groupID, _ := group["id"].(string)
	if groupID == "" {
		t.Fatalf("group = %+v", created)
	}
	invite := qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/invites", "qa03-owner", `{"maxUses":5}`), http.StatusCreated)
	code, _ := invite["code"].(string)
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/invites/accept", "qa03-member", `{"code":`+qa03Quote(code)+`}`), http.StatusOK)
	return groupID
}

func qa03SetPolicy(t *testing.T, social *qa03Social, subject, groupID, body string, want int) map[string]any {
	t.Helper()
	return qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodPut, "/v1/shared/policies/"+groupID, subject, body), want)
}

func qa03PolicyBody(enabled bool, accounts string, start, end string) string {
	return `{"enabled":` + map[bool]string{true: "true", false: "false"}[enabled] +
		`,"accountIds":` + accounts + `,"startDate":` + qa03Quote(start) + `,"endDate":` + qa03Quote(end) + `}`
}

// Enabling a policy shows rows at once, narrowing drops them at once,
// disabling denies at once, and re-enabling restores — for the owner's
// own feed and the member's feed alike. A zero-account policy matches
// nothing, and deleting an account mid-policy strips the feed to what
// remains.
func TestQA03PolicyLifecycleAppliesImmediately(t *testing.T) {
	social := qa03SocialSetup(t)
	qa03MustPosting(t, social.ownerSC, qa03SharedGroceries, "Groceries", "42.50", qa03MatrixDay)
	qa03MustPosting(t, social.ownerSC, qa03SharedFuel, "Fuel", "30.00", qa03MatrixDay)
	groupID := qa03MatrixGroup(t, social)

	// No policy yet: both feeds are empty but well-formed.
	ownerFeed := qa03MatrixFeed(t, social, "qa03-owner", groupID)
	qa03FeedAgrees(t, ownerFeed)
	if qa03FeedCount(ownerFeed) != 0 {
		t.Fatalf("owner feed = %+v, want empty before any policy", qa03FeedItemIDs(ownerFeed))
	}

	// Enable: both rows show at once in both feeds (own rows list now).
	qa03SetPolicy(t, social, "qa03-owner", groupID, qa03PolicyBody(true, `["checking"]`, "2026-01-01", "2026-12-31"), http.StatusOK)
	ownerFeed = qa03MatrixFeed(t, social, "qa03-owner", groupID)
	memberFeed := qa03MatrixFeed(t, social, "qa03-member", groupID)
	qa03FeedAgrees(t, ownerFeed)
	qa03FeedAgrees(t, memberFeed)
	if qa03FeedCount(ownerFeed) != 2 || qa03FeedCount(memberFeed) != 2 {
		t.Fatalf("feeds = %d/%d, want 2/2 right after enabling", qa03FeedCount(ownerFeed), qa03FeedCount(memberFeed))
	}

	// Narrow the window past June: both rows drop at once everywhere.
	qa03SetPolicy(t, social, "qa03-owner", groupID, qa03PolicyBody(true, `["checking"]`, "2026-07-01", "2026-12-31"), http.StatusOK)
	if got := qa03FeedCount(qa03MatrixFeed(t, social, "qa03-owner", groupID)); got != 0 {
		t.Fatalf("owner feed = %d, want 0 after narrowing", got)
	}
	if got := qa03FeedCount(qa03MatrixFeed(t, social, "qa03-member", groupID)); got != 0 {
		t.Fatalf("member feed = %d, want 0 after narrowing", got)
	}

	// Re-enable the full window, then disable: rows denied at once, and
	// the detail read fails closed without existence leakage.
	qa03SetPolicy(t, social, "qa03-owner", groupID, qa03PolicyBody(true, `["checking"]`, "2026-01-01", "2026-12-31"), http.StatusOK)
	if got := qa03FeedCount(qa03MatrixFeed(t, social, "qa03-member", groupID)); got != 2 {
		t.Fatalf("member feed = %d, want 2 after re-enabling", got)
	}
	qa03SetPolicy(t, social, "qa03-owner", groupID, qa03PolicyBody(false, `["checking"]`, "2026-01-01", "2026-12-31"), http.StatusOK)
	deniedFeed := qa03MatrixFeed(t, social, "qa03-member", groupID)
	qa03FeedAgrees(t, deniedFeed)
	if qa03FeedCount(deniedFeed) != 0 {
		t.Fatalf("member feed = %d, want 0 after disabling", qa03FeedCount(deniedFeed))
	}
	denied := qa03Serve(t, social.sharing.Routes(), http.MethodGet, "/v1/shared/postings/"+qa03Resource(social.owner)+"/"+qa03SharedGroceries, "qa03-member", "")
	if denied.Code != http.StatusNotFound {
		t.Fatalf("disabled-policy read = %d, want 404", denied.Code)
	}

	// Enabling with zero accounts is rejected at the boundary with a
	// plain reason; the kept-but-matching-nothing state below comes only
	// from deleting every selected account.
	rejected := qa03Serve(t, social.sharing.Routes(), http.MethodPut, "/v1/shared/policies/"+groupID, "qa03-owner",
		qa03PolicyBody(true, `[]`, "2026-01-01", "2026-12-31"))
	if rejected.Code != http.StatusBadRequest {
		t.Fatalf("zero-account enable = %d, want 400", rejected.Code)
	}

	// Re-enable on checking, then delete a second account mid-policy: the
	// feed follows to what remains without touching the survivor.
	// Deleting an account its postings still reference is refused first
	// (fail-closed with the referencing row named); only the unused
	// account deletes and strips the policy.
	if _, err := social.ownerSC.CreateAccount(types.Account{ID: "savings", Name: "Savings", Kind: types.AccountKindCash, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	savings := "savings"
	savingsPosting := "01900000-0000-7000-8000-0000000000e5"
	if _, err := social.ownerSC.CreatePosting(types.Posting{
		ID: savingsPosting, Name: "Dues", SourceAccountID: &savings,
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "5.00"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      qa03MatrixDay,
		TransactionTime: qa03MatrixDay,
		Enabled:         true,
	}); err != nil {
		t.Fatal(err)
	}
	qa03SetPolicy(t, social, "qa03-owner", groupID, qa03PolicyBody(true, `["checking","savings"]`, "2026-01-01", "2026-12-31"), http.StatusOK)
	preview := qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodPost, "/v1/shared/policies/"+groupID+"/preview", "qa03-owner",
		qa03PolicyBody(true, `["checking","savings"]`, "2026-01-01", "2026-12-31")), http.StatusOK)
	eligible, _ := preview["preview"].(map[string]any)["eligiblePostings"].(float64)
	if int(eligible) != 3 {
		t.Fatalf("preview = %+v, want 3 eligible postings", preview["preview"])
	}
	if got := qa03FeedCount(qa03MatrixFeed(t, social, "qa03-member", groupID)); got != 3 {
		t.Fatalf("member feed = %d, want 3 across both accounts", got)
	}
	qa03DeleteOwnerAccount(t, social, "savings", false)
	refused := qa03MatrixFeed(t, social, "qa03-member", groupID)
	qa03FeedAgrees(t, refused)
	if qa03FeedCount(refused) != 3 {
		t.Fatalf("member feed = %+v, want 3 unchanged after the refused deletion", qa03FeedItemIDs(refused))
	}

	// With its posting gone the account deletes, the policy strips to the
	// survivor, and the feed follows.
	if response := doRowRequest(t, qa03OwnerPlan(t, social), http.MethodDelete, "/v1/postings/"+savingsPosting, ""); response.Code != http.StatusOK {
		t.Fatalf("delete posting = %d %s", response.Code, response.Body.String())
	}
	qa03DeleteOwnerAccount(t, social, "savings", true)
	after := qa03MatrixFeed(t, social, "qa03-member", groupID)
	qa03FeedAgrees(t, after)
	if qa03FeedCount(after) != 2 || qa03FeedHas(after, social.owner, savingsPosting) {
		t.Fatalf("member feed = %+v, want the 2 checking rows after the account deletion", qa03FeedItemIDs(after))
	}
	stored, err := social.db.GetSharingPolicy(social.owner, groupID)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range stored.AccountIDs {
		if id == "savings" {
			t.Fatalf("policy = %+v, want the deleted account stripped", stored)
		}
	}

	// Deleting the last selected account keeps the enabled row with zero
	// accounts, and it matches nothing.
	for _, id := range []string{qa03SharedGroceries, qa03SharedFuel} {
		if response := doRowRequest(t, qa03OwnerPlan(t, social), http.MethodDelete, "/v1/postings/"+id, ""); response.Code != http.StatusOK {
			t.Fatalf("delete posting %s = %d %s", id, response.Code, response.Body.String())
		}
	}
	qa03DeleteOwnerAccount(t, social, "checking", true)
	stored, err = social.db.GetSharingPolicy(social.owner, groupID)
	if err != nil || !stored.Enabled || len(stored.AccountIDs) != 0 {
		t.Fatalf("policy = %+v err = %v, want the enabled zero-account row kept", stored, err)
	}
	empty := qa03MatrixFeed(t, social, "qa03-member", groupID)
	qa03FeedAgrees(t, empty)
	if qa03FeedCount(empty) != 0 {
		t.Fatalf("member feed = %+v, want nothing matched", qa03FeedItemIDs(empty))
	}
}

// User, group, multi-audience, and wildcard exclusions added and removed:
// feed, detail, counts, and totals agree at every step for the excluder
// (own rows) and the excluded viewer alike.
func TestQA03ExclusionsAgreeForExcluderAndViewer(t *testing.T) {
	social := qa03SocialSetup(t)
	qa03MustPosting(t, social.ownerSC, qa03SharedGroceries, "Groceries", "42.50", qa03MatrixDay)
	qa03MustPosting(t, social.ownerSC, qa03SharedFuel, "Fuel", "30.00", qa03MatrixDay)
	groupID := qa03MatrixGroup(t, social)
	qa03SetPolicy(t, social, "qa03-owner", groupID, qa03PolicyBody(true, `["checking"]`, "2026-01-01", "2026-12-31"), http.StatusOK)

	detail := func(subject, posting string, want int) {
		t.Helper()
		got := qa03Serve(t, social.sharing.Routes(), http.MethodGet, "/v1/shared/postings/"+qa03Resource(social.owner)+"/"+posting, subject, "")
		if got.Code != want {
			t.Fatalf("detail %s/%s = %d, want %d", subject, posting, got.Code, want)
		}
	}
	check := func(step string, ownerCount, memberCount int) {
		t.Helper()
		ownerFeed := qa03MatrixFeed(t, social, "qa03-owner", groupID)
		memberFeed := qa03MatrixFeed(t, social, "qa03-member", groupID)
		qa03FeedAgrees(t, ownerFeed)
		qa03FeedAgrees(t, memberFeed)
		if qa03FeedCount(ownerFeed) != ownerCount || qa03FeedCount(memberFeed) != memberCount {
			t.Fatalf("%s: feeds = %d/%d, want %d/%d", step, qa03FeedCount(ownerFeed), qa03FeedCount(memberFeed), ownerCount, memberCount)
		}
	}
	exclude := func(posting, audienceType, audienceID string) {
		t.Helper()
		qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodPost, "/v1/shared/exclusions", "qa03-owner",
			`{"postingId":`+qa03Quote(posting)+`,"audienceType":`+qa03Quote(audienceType)+`,"audienceId":`+qa03Quote(audienceID)+`,"requestId":`+qa03Quote(qa03RequestID(t))+`}`), http.StatusCreated)
	}
	unexclude := func(posting, audienceType, audienceID string) {
		t.Helper()
		qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodDelete, "/v1/shared/exclusions", "qa03-owner",
			`{"postingId":`+qa03Quote(posting)+`,"audienceType":`+qa03Quote(audienceType)+`,"audienceId":`+qa03Quote(audienceID)+`,"requestId":`+qa03Quote(qa03RequestID(t))+`}`), http.StatusOK)
	}

	check("baseline", 2, 2)
	detail("qa03-owner", qa03SharedGroceries, http.StatusOK)
	detail("qa03-member", qa03SharedGroceries, http.StatusOK)

	// A user exclusion hides the row from that viewer only; the excluder
	// still sees their own row.
	exclude(qa03SharedGroceries, store.SharingAudienceUser, social.member)
	check("user-excluded", 2, 1)
	detail("qa03-owner", qa03SharedGroceries, http.StatusOK)
	detail("qa03-member", qa03SharedGroceries, http.StatusNotFound)
	unexclude(qa03SharedGroceries, store.SharingAudienceUser, social.member)
	check("user-removed", 2, 2)
	detail("qa03-member", qa03SharedGroceries, http.StatusOK)

	// A group exclusion hides the row from every member including the
	// excluder's own feed.
	exclude(qa03SharedGroceries, store.SharingAudienceGroup, groupID)
	check("group-excluded", 1, 1)
	detail("qa03-owner", qa03SharedGroceries, http.StatusOK)
	detail("qa03-member", qa03SharedGroceries, http.StatusNotFound)
	if qa03FeedHas(qa03MatrixFeed(t, social, "qa03-owner", groupID), social.owner, qa03SharedGroceries) {
		t.Fatal("excluded row still in the excluder's own feed")
	}

	// A second audience on the same row composes: removing one exclusion
	// still denies through the other.
	exclude(qa03SharedGroceries, store.SharingAudienceUser, social.member)
	unexclude(qa03SharedGroceries, store.SharingAudienceGroup, groupID)
	check("multi-audience", 2, 1)
	detail("qa03-member", qa03SharedGroceries, http.StatusNotFound)
	unexclude(qa03SharedGroceries, store.SharingAudienceUser, social.member)
	check("multi-removed", 2, 2)

	// A wildcard exclusion hides the row from every audience at once.
	exclude(qa03SharedFuel, store.SharingAudienceAll, "")
	check("wildcard", 1, 1)
	detail("qa03-member", qa03SharedFuel, http.StatusNotFound)
	unexclude(qa03SharedFuel, store.SharingAudienceAll, "")
	check("wildcard-removed", 2, 2)
	detail("qa03-member", qa03SharedFuel, http.StatusOK)
}
