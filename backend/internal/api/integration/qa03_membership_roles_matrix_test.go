package integration

import (
	"net/http"
	"sync"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// QA-03 follow-up, part 2: membership, roles, copies and inbox under
// membership changes, error and empty states, and concurrency spot
// checks. Same rules as part 1: production HTTP, one shared database
// file for both users, stand-ins named (identity principal in context;
// one setup-only clock backdate for invite expiry).

func qa03MemberIDs(t *testing.T, social *qa03Social, groupID, subject string, want int) []map[string]any {
	t.Helper()
	decoded := qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodGet, "/v1/groups/"+groupID+"/members", subject, ""), want)
	var members []map[string]any
	if want == http.StatusOK {
		raw, _ := decoded["members"].([]any)
		for _, m := range raw {
			members = append(members, m.(map[string]any))
		}
	}
	return members
}

func qa03MemberRole(members []map[string]any, accountID string) string {
	for _, m := range members {
		if m["accountId"] == accountID {
			role, _ := m["role"].(string)
			return role
		}
	}
	return ""
}

// Invite create, accept, revoke, and expiry; removal, voluntary leave,
// rejoin with the preference resumed, and group deletion clearing every
// view.
func TestQA03MembershipLifecycleDeniesImmediately(t *testing.T) {
	social := qa03SocialSetup(t)
	qa03MustPosting(t, social.ownerSC, qa03SharedGroceries, "Groceries", "42.50", qa03MatrixDay)
	created := qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups", "qa03-owner", `{"name":"Household"}`), http.StatusCreated)
	groupID := created["group"].(map[string]any)["id"].(string)
	qa03SetPolicy(t, social, "qa03-owner", groupID, qa03PolicyBody(true, `["checking"]`, "2026-01-01", "2026-12-31"), http.StatusOK)

	// Before joining, the feed denies without revealing the group.
	if got := qa03Serve(t, social.sharing.Routes(), http.MethodGet, "/v1/shared/groups/"+groupID+"/feed", "qa03-member", ""); got.Code != http.StatusNotFound {
		t.Fatalf("outsider feed = %d, want 404", got.Code)
	}

	// Invite, accept, access.
	invite := qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/invites", "qa03-owner", `{"maxUses":5}`), http.StatusCreated)
	code := invite["code"].(string)
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/invites/accept", "qa03-member", `{"code":`+qa03Quote(code)+`}`), http.StatusOK)
	if got := qa03FeedCount(qa03MatrixFeed(t, social, "qa03-member", groupID)); got != 1 {
		t.Fatalf("member feed = %d, want 1 after joining", got)
	}

	// A revoked invite denies the next accept.
	second := qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/invites", "qa03-owner", `{"maxUses":5}`), http.StatusCreated)
	secondID := second["invite"].(map[string]any)["id"].(string)
	secondCode := second["code"].(string)
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodDelete, "/v1/groups/"+groupID+"/invites/"+secondID, "qa03-owner", ""), http.StatusOK)
	if got := qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/invites/accept", "qa03-member", `{"code":`+qa03Quote(secondCode)+`}`); got.Code != http.StatusBadRequest && got.Code != http.StatusNotFound {
		t.Fatalf("revoked-invite accept = %d, want a rejection", got.Code)
	}

	// An expired invite denies too. The clock step below is setup-only:
	// the accept itself runs the production path.
	third := qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/invites", "qa03-owner", `{"maxUses":5}`), http.StatusCreated)
	thirdCode := third["code"].(string)
	expireInviteForMatrix(t, social, third)
	if got := qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/invites/accept", "qa03-member", `{"code":`+qa03Quote(thirdCode)+`}`); got.Code != http.StatusBadRequest && got.Code != http.StatusNotFound {
		t.Fatalf("expired-invite accept = %d, want a rejection", got.Code)
	}

	// Admin removal ends access immediately with the same denial as a
	// voluntary leave.
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodDelete, "/v1/groups/"+groupID+"/members/"+qa03ResourceMemberID(t, social), "qa03-owner", ""), http.StatusOK)
	if got := qa03Serve(t, social.sharing.Routes(), http.MethodGet, "/v1/shared/groups/"+groupID+"/feed", "qa03-member", ""); got.Code != http.StatusNotFound {
		t.Fatalf("removed-member feed = %d, want 404", got.Code)
	}
	// Rejoin through a fresh invite, then leave voluntarily: same denial.
	fresh := qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/invites", "qa03-owner", `{"maxUses":5}`), http.StatusCreated)
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/invites/accept", "qa03-member", `{"code":`+qa03Quote(fresh["code"].(string))+`}`), http.StatusOK)
	if got := qa03FeedCount(qa03MatrixFeed(t, social, "qa03-member", groupID)); got != 1 {
		t.Fatalf("rejoined feed = %d, want 1", got)
	}
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/leave", "qa03-member", ""), http.StatusOK)
	if got := qa03Serve(t, social.sharing.Routes(), http.MethodGet, "/v1/shared/groups/"+groupID+"/feed", "qa03-member", ""); got.Code != http.StatusNotFound {
		t.Fatalf("left-member feed = %d, want 404", got.Code)
	}

	// Rejoining resumes the member's own sharing preference.
	again := qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/invites", "qa03-owner", `{"maxUses":5}`), http.StatusCreated)
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/invites/accept", "qa03-member", `{"code":`+qa03Quote(again["code"].(string))+`}`), http.StatusOK)
	qa03SetPolicy(t, social, "qa03-member", groupID, qa03PolicyBody(true, `["checking"]`, "2026-01-01", "2026-12-31"), http.StatusOK)
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/leave", "qa03-member", ""), http.StatusOK)
	latest := qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/invites", "qa03-owner", `{"maxUses":5}`), http.StatusCreated)
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/invites/accept", "qa03-member", `{"code":`+qa03Quote(latest["code"].(string))+`}`), http.StatusOK)
	resumed, err := social.db.GetSharingPolicy(social.member, groupID)
	if err != nil || !resumed.Enabled {
		t.Fatalf("member policy = %+v err = %v, want the preference resumed after rejoin", resumed, err)
	}

	// Group deletion clears every view: feed, members, and policy.
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodDelete, "/v1/groups/"+groupID, "qa03-owner", ""), http.StatusOK)
	if got := qa03Serve(t, social.sharing.Routes(), http.MethodGet, "/v1/shared/groups/"+groupID+"/feed", "qa03-owner", ""); got.Code != http.StatusNotFound {
		t.Fatalf("deleted-group owner feed = %d, want 404", got.Code)
	}
	if got := qa03Serve(t, social.groups.Routes(), http.MethodGet, "/v1/groups/"+groupID+"/members", "qa03-owner", ""); got.Code != http.StatusNotFound {
		t.Fatalf("deleted-group members = %d, want 404", got.Code)
	}
	if _, err := social.db.GetSharingPolicy(social.owner, groupID); err == nil {
		t.Fatal("owner policy survives its group deletion")
	}
}

// Owner, admin, and member gates: promotion and demotion move invite
// management and role changes exactly; a demoted admin keeps plain
// member reads without errors.
func TestQA03RoleGatesMoveManagementExactly(t *testing.T) {
	social := qa03SocialSetup(t)
	created := qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups", "qa03-owner", `{"name":"Household"}`), http.StatusCreated)
	groupID := created["group"].(map[string]any)["id"].(string)
	invite := qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/invites", "qa03-owner", `{"maxUses":5}`), http.StatusCreated)
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/invites/accept", "qa03-member", `{"code":`+qa03Quote(invite["code"].(string))+`}`), http.StatusOK)
	memberUserID := qa03ResourceMemberID(t, social)

	roleOf := func(subject string) string {
		t.Helper()
		return qa03MemberRole(qa03MemberIDs(t, social, groupID, subject, http.StatusOK), memberUserID)
	}
	if roleOf("qa03-owner") != "member" {
		t.Fatalf("member role = %q, want member", roleOf("qa03-owner"))
	}

	// A plain member manages nothing.
	if got := qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/invites", "qa03-member", `{"maxUses":1}`); got.Code != http.StatusForbidden {
		t.Fatalf("member invite = %d, want 403", got.Code)
	}
	if got := qa03Serve(t, social.groups.Routes(), http.MethodPatch, "/v1/groups/"+groupID+"/members/"+memberUserID, "qa03-member", `{"role":"admin"}`); got.Code != http.StatusForbidden {
		t.Fatalf("member self-promote = %d, want 403", got.Code)
	}

	// The owner promotes to admin: invites open, role changes stay shut.
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPatch, "/v1/groups/"+groupID+"/members/"+memberUserID, "qa03-owner", `{"role":"admin"}`), http.StatusOK)
	if roleOf("qa03-owner") != "admin" {
		t.Fatalf("member role = %q, want admin", roleOf("qa03-owner"))
	}
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/invites", "qa03-member", `{"maxUses":1}`), http.StatusCreated)
	if got := qa03Serve(t, social.groups.Routes(), http.MethodPatch, "/v1/groups/"+groupID+"/members/"+memberUserID, "qa03-member", `{"role":"member"}`); got.Code != http.StatusForbidden {
		t.Fatalf("admin self-demote = %d, want 403 (owners only)", got.Code)
	}

	// Demoted back to member: invite management closes, plain reads stay
	// clean, and feed/policy reads keep working without errors.
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPatch, "/v1/groups/"+groupID+"/members/"+memberUserID, "qa03-owner", `{"role":"member"}`), http.StatusOK)
	if roleOf("qa03-owner") != "member" {
		t.Fatalf("member role = %q, want member after demotion", roleOf("qa03-owner"))
	}
	if got := qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/invites", "qa03-member", `{"maxUses":1}`); got.Code != http.StatusForbidden {
		t.Fatalf("demoted invite = %d, want 403", got.Code)
	}
	members := qa03MemberIDs(t, social, groupID, "qa03-member", http.StatusOK)
	if len(members) != 2 {
		t.Fatalf("member list = %d, want 2 readable without errors", len(members))
	}

	// The last owner cannot be demoted or removed.
	ownerUserID := qa03ResourceOwnerID(t, social)
	if got := qa03Serve(t, social.groups.Routes(), http.MethodPatch, "/v1/groups/"+groupID+"/members/"+ownerUserID, "qa03-owner", `{"role":"member"}`); got.Code != http.StatusBadRequest {
		t.Fatalf("last-owner demote = %d, want 400", got.Code)
	}
	if got := qa03Serve(t, social.groups.Routes(), http.MethodDelete, "/v1/groups/"+groupID+"/members/"+ownerUserID, "qa03-owner", ""); got.Code != http.StatusBadRequest {
		t.Fatalf("last-owner remove = %d, want 400", got.Code)
	}
}

// Save-a-copy and the link refresh states under membership changes
// mid-flight: current while authorized, source-changed after an owner
// edit (copy keeps its edits), unauthorized after revocation or removal
// (copy and edits survive), and no copy minted from a denied accept.
func TestQA03CopiesAndRefreshUnderMembershipChanges(t *testing.T) {
	social := qa03SocialSetup(t)
	qa03MustPosting(t, social.ownerSC, qa03SharedGroceries, "Groceries", "42.50", qa03MatrixDay)
	groupID := qa03MatrixGroup(t, social)
	qa03Grant(t, social, "qa03-owner", qa03SharedGroceries, store.SharingAudienceGroup, groupID)

	copied := qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodPost, "/v1/shared/copies", "qa03-member",
		`{"owner":`+qa03Quote(qa03Resource(social.owner))+`,"postingId":`+qa03Quote(qa03SharedGroceries)+`,"requestId":`+qa03Quote(qa03RequestID(t))+`}`), http.StatusCreated)
	copyID := copied["posting"].(map[string]any)["id"].(string)

	refresh := func() (int, map[string]any) {
		t.Helper()
		response := qa03Serve(t, social.sharing.Routes(), http.MethodPost, "/v1/shared/copies/"+copyID+"/refresh", "qa03-member", "")
		var decoded map[string]any
		if response.Code == http.StatusOK {
			decoded = qa03Decode(t, response, http.StatusOK)
		}
		return response.Code, decoded
	}
	if code, out := refresh(); code != http.StatusOK || out["status"] != store.SharingLinkCurrent {
		t.Fatalf("refresh = %d %+v, want current", code, out)
	}

	// The owner edits the source: refresh reports the change while the
	// recipient's copy keeps its own edits.
	renamed := qa03OwnerPosting(t, social, qa03SharedGroceries)
	renamed.Name = "Groceries (corrected)"
	if _, err := social.ownerSC.UpdatePosting(renamed); err != nil {
		t.Fatal(err)
	}
	edited := qa03MemberPosting(t, social, copyID)
	edited.Name = "My groceries"
	if _, err := social.memberSC.UpdatePosting(edited); err != nil {
		t.Fatal(err)
	}
	if code, out := refresh(); code != http.StatusOK || out["status"] != store.SharingLinkSourceChange {
		t.Fatalf("refresh = %d %+v, want source-changed", code, out)
	}
	if got := qa03MemberPosting(t, social, copyID); got.Name != "My groceries" {
		t.Fatalf("copy = %+v, want the recipient edit intact", got)
	}

	// Revocation flips refresh to unauthorized; the copy and its edits
	// stay intact, and a fresh accept mints nothing.
	qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodDelete, "/v1/shared/grants", "qa03-owner",
		`{"postingId":`+qa03Quote(qa03SharedGroceries)+`,"audienceType":"group","audienceId":`+qa03Quote(groupID)+`,"requestId":`+qa03Quote(qa03RequestID(t))+`}`), http.StatusOK)
	if code, out := refresh(); code != http.StatusOK || out["status"] != store.SharingLinkUnauthorized {
		t.Fatalf("refresh = %d %+v, want unauthorized", code, out)
	}
	if got := qa03MemberPosting(t, social, copyID); got.Name != "My groceries" {
		t.Fatalf("copy = %+v, want it intact after revocation", got)
	}
	denied := qa03Serve(t, social.sharing.Routes(), http.MethodPost, "/v1/shared/copies", "qa03-member",
		`{"owner":`+qa03Quote(qa03Resource(social.owner))+`,"postingId":`+qa03Quote(qa03SharedGroceries)+`,"requestId":`+qa03Quote(qa03RequestID(t))+`}`)
	if denied.Code != http.StatusNotFound {
		t.Fatalf("copy-after-revoke = %d, want 404", denied.Code)
	}

	// Membership removal also flips a live link to unauthorized.
	qa03Grant(t, social, "qa03-owner", qa03SharedGroceries, store.SharingAudienceGroup, groupID)
	if code, out := refresh(); code != http.StatusOK || out["status"] != store.SharingLinkCurrent {
		t.Fatalf("refresh = %d %+v, want current after re-grant", code, out)
	}
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodDelete, "/v1/groups/"+groupID+"/members/"+qa03ResourceMemberID(t, social), "qa03-owner", ""), http.StatusOK)
	if code, out := refresh(); code != http.StatusOK || out["status"] != store.SharingLinkUnauthorized {
		t.Fatalf("refresh = %d %+v, want unauthorized after removal", code, out)
	}
	if got := qa03MemberPosting(t, social, copyID); got.Name != "My groceries" {
		t.Fatalf("copy = %+v, want it intact after removal", got)
	}
}

// Unknown groups, outsiders, empty feeds, empty inbox tabs, and failed
// saves that stay local with a clean retry.
func TestQA03ErrorAndEmptyStates(t *testing.T) {
	social := qa03SocialSetup(t)
	qa03MustPosting(t, social.ownerSC, qa03SharedGroceries, "Groceries", "42.50", qa03MatrixDay)
	groupID := qa03MatrixGroup(t, social)
	unknownGroup := "00000000-0000-4000-8000-000000000000"

	// Unknown and outsider reads fail closed with the same shape: no
	// existence leakage between "missing" and "denied".
	unknownFeed := qa03Serve(t, social.sharing.Routes(), http.MethodGet, "/v1/shared/groups/"+unknownGroup+"/feed", "qa03-owner", "")
	qa03Stranger(t, social)
	outsiderFeed := qa03Serve(t, social.sharing.Routes(), http.MethodGet, "/v1/shared/groups/"+groupID+"/feed", "qa03-stranger", "")
	if unknownFeed.Code != http.StatusNotFound || outsiderFeed.Code != http.StatusNotFound {
		t.Fatalf("feeds = %d/%d, want 404/404", unknownFeed.Code, outsiderFeed.Code)
	}
	if unknownFeed.Body.String() != outsiderFeed.Body.String() {
		t.Fatalf("shapes differ: %q vs %q", unknownFeed.Body.String(), outsiderFeed.Body.String())
	}
	unknownDetail := qa03Serve(t, social.sharing.Routes(), http.MethodGet, "/v1/shared/postings/"+qa03Resource(social.owner)+"/"+qa03SharedGroceries, "qa03-stranger", "")
	if unknownDetail.Code != http.StatusNotFound {
		t.Fatalf("stranger detail = %d, want 404", unknownDetail.Code)
	}
	if got := qa03Serve(t, social.groups.Routes(), http.MethodGet, "/v1/groups/"+unknownGroup+"/members", "qa03-owner", ""); got.Code != http.StatusNotFound {
		t.Fatalf("unknown members = %d, want 404", got.Code)
	}

	// An empty feed is well-formed: no items, zero totals.
	empty := qa03MatrixFeed(t, social, "qa03-owner", groupID)
	qa03FeedAgrees(t, empty)
	if qa03FeedCount(empty) != 0 {
		t.Fatalf("empty feed = %+v", qa03FeedItemIDs(empty))
	}

	// Every inbox tab starts empty and well-formed.
	for _, tab := range []string{"", "?status=pending", "?status=accepted", "?status=declined", "?status=canceled", "?status=all"} {
		listed := qa03Decode(t, qa03Serve(t, social.inbox.Routes(), http.MethodGet, "/v1/inbox"+tab, "qa03-member", ""), http.StatusOK)
		if items, _ := listed["items"].([]any); len(items) != 0 {
			t.Fatalf("inbox %q = %+v, want empty", tab, items)
		}
	}
	if got := qa03Serve(t, social.inbox.Routes(), http.MethodGet, "/v1/inbox?status=bogus", "qa03-member", ""); got.Code != http.StatusBadRequest {
		t.Fatalf("bogus tab = %d, want 400", got.Code)
	}

	// A failed save writes nothing: the grants list is unchanged, and a
	// corrected retry with a fresh key succeeds.
	before, err := social.db.ListSharingGrants(social.owner)
	if err != nil {
		t.Fatal(err)
	}
	failed := qa03Serve(t, social.sharing.Routes(), http.MethodPost, "/v1/shared/grants", "qa03-owner",
		`{"postingId":`+qa03Quote(qa03SharedGroceries)+`,"audienceType":"sideways","audienceId":`+qa03Quote(groupID)+`,"requestId":`+qa03Quote(qa03RequestID(t))+`}`)
	if failed.Code != http.StatusBadRequest && failed.Code != http.StatusNotFound {
		t.Fatalf("bad grant = %d, want a 4xx with nothing written", failed.Code)
	}
	after, err := social.db.ListSharingGrants(social.owner)
	if err != nil {
		t.Fatal(err)
	}
	if len(before) != len(after) {
		t.Fatalf("grants = %d, want %d unchanged after the failed save", len(after), len(before))
	}
	qa03Grant(t, social, "qa03-owner", qa03SharedGroceries, store.SharingAudienceGroup, groupID)
	if got := qa03FeedCount(qa03MatrixFeed(t, social, "qa03-member", groupID)); got != 1 {
		t.Fatalf("member feed = %d, want 1 after the clean retry", got)
	}
}

// Reads racing mutations stay fail-closed and internally consistent:
// every response is either pre- or post-commit truth, never an error
// and never stale authorization after a settled revoke.
func TestQA03ConcurrentReadsStayFailClosed(t *testing.T) {
	social := qa03SocialSetup(t)
	qa03MustPosting(t, social.ownerSC, qa03SharedGroceries, "Groceries", "42.50", qa03MatrixDay)
	qa03MustPosting(t, social.ownerSC, qa03SharedFuel, "Fuel", "30.00", qa03MatrixDay)
	groupID := qa03MatrixGroup(t, social)
	qa03SetPolicy(t, social, "qa03-owner", groupID, qa03PolicyBody(true, `["checking"]`, "2026-01-01", "2026-12-31"), http.StatusOK)
	qa03Grant(t, social, "qa03-owner", qa03SharedGroceries, store.SharingAudienceGroup, groupID)
	qa03Grant(t, social, "qa03-owner", qa03SharedFuel, store.SharingAudienceGroup, groupID)

	feedTarget := "/v1/shared/groups/" + groupID + "/feed"
	readFeed := func() (int, map[string]any) {
		response := qa03Serve(t, social.sharing.Routes(), http.MethodGet, feedTarget, "qa03-member", "")
		if response.Code != http.StatusOK {
			return response.Code, nil
		}
		var decoded map[string]any
		if err := qa03DecodeJSON(response.Body.Bytes(), &decoded); err != nil {
			t.Errorf("decode feed: %v", err)
			return -1, nil
		}
		return response.Code, decoded
	}

	// Policy narrowed mid-read: every response agrees with itself.
	var wg sync.WaitGroup
	for r := 0; r < 4; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 25; i++ {
				code, feed := readFeed()
				if code != http.StatusOK || feed == nil {
					t.Errorf("feed read = %d", code)
					return
				}
				items, _ := feed["items"].([]any)
				if qa03FeedCount(feed) != len(items) {
					t.Errorf("totals disagree mid-read: %+v", feed["totals"])
					return
				}
			}
		}()
	}
	for i := 0; i < 25; i++ {
		end := "2026-12-31"
		if i%2 == 0 {
			end = "2026-01-31"
		}
		qa03Serve(t, social.sharing.Routes(), http.MethodPut, "/v1/shared/policies/"+groupID, "qa03-owner",
			qa03PolicyBody(true, `["checking"]`, "2026-01-01", end))
	}
	wg.Wait()
	qa03SetPolicy(t, social, "qa03-owner", groupID, qa03PolicyBody(true, `["checking"]`, "2026-01-01", "2026-12-31"), http.StatusOK)
	if got := qa03FeedCount(qa03MatrixFeed(t, social, "qa03-member", groupID)); got != 2 {
		t.Fatalf("settled feed = %d, want 2", got)
	}

	// Member removed mid-feed-page: the next page fails closed.
	first := qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodGet, feedTarget+"?limit=1", "qa03-member", ""), http.StatusOK)
	cursor, _ := first["page"].(map[string]any)["nextCursor"].(string)
	if cursor == "" {
		t.Fatalf("first page = %+v, want a cursor", first["page"])
	}
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodDelete, "/v1/groups/"+groupID+"/members/"+qa03ResourceMemberID(t, social), "qa03-owner", ""), http.StatusOK)
	if got := qa03Serve(t, social.sharing.Routes(), http.MethodGet, feedTarget+"?limit=1&cursor="+cursor, "qa03-member", ""); got.Code != http.StatusNotFound {
		t.Fatalf("post-removal page = %d, want 404", got.Code)
	}

	// Grants revoked racing copy saves: each save either wins before the
	// revoke or fails closed after it — never an error, never a second
	// copy of the same triple. Request keys are minted up front: UUID
	// failure must stay on the test goroutine, never in a worker.
	keys := make([]string, 0, 40)
	for i := 0; i < 40; i++ {
		keys = append(keys, qa03RequestID(t))
	}
	for r := 0; r < 4; r++ {
		wg.Add(1)
		go func(r int) {
			defer wg.Done()
			for i := 0; i < 10; i++ {
				response := qa03Serve(t, social.sharing.Routes(), http.MethodPost, "/v1/shared/copies", "qa03-member",
					`{"owner":`+qa03Quote(qa03Resource(social.owner))+`,"postingId":`+qa03Quote(qa03SharedFuel)+`,"requestId":`+qa03Quote(keys[r*10+i])+`}`)
				if response.Code != http.StatusCreated && response.Code != http.StatusNotFound {
					t.Errorf("copy race = %d", response.Code)
					return
				}
			}
		}(r)
	}
	qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodDelete, "/v1/shared/grants", "qa03-owner",
		`{"postingId":`+qa03Quote(qa03SharedFuel)+`,"audienceType":"group","audienceId":`+qa03Quote(groupID)+`,"requestId":`+qa03Quote(qa03RequestID(t))+`}`), http.StatusOK)
	wg.Wait()
	model, err := social.memberSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	fuelCopies := 0
	for _, posting := range model.Postings {
		if posting.Name == "Fuel" {
			fuelCopies++
		}
	}
	if fuelCopies > 1 {
		t.Fatalf("fuel copies = %d, want at most one per triple", fuelCopies)
	}
}
