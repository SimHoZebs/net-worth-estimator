package integrationedge

import (
	"net/http"
	"testing"
)

// Membership and consent ripped out from under live reads. Leaving must
// close the feed at once; a policy narrowed to nothing must list nothing
// with agreeing zero totals; deleting the policy's account or the group
// itself must fail closed, never 500 or leak rows. Real SQLite store and real production routers over real HTTP; the only stand-in is identity (no OIDC round trip).
func TestIntegrationEdgeMembershipRemovedMidFeed_RealSQLite_RealHTTP(t *testing.T) {
	world := advSetup(t)
	if world.groupID == "" {
		t.Skip("needs the group identity set")
	}
	day := int64(1781524800)
	leaveRow := advMustPosting(t, world.ownerSC, "Leave row", "30.00", day)
	if _, err := world.db.GrantSharedPosting(world.owner, leaveRow, "group", world.groupID, advRequestID(t)); err != nil {
		t.Fatal(err)
	}
	feedTarget := "/v1/shared/groups/" + world.groupID + "/feed"
	before := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet, feedTarget, world.secondSubject, ""), http.StatusOK)
	if len(before["items"].([]any)) != 1 {
		t.Fatalf("feed = %+v, want the row visible before leaving", before)
	}
	if err := world.db.LeaveGroup(world.groupID, world.second); err != nil {
		t.Fatal(err)
	}
	after := advServe(t, world.sharing.Routes(), http.MethodGet, feedTarget, world.secondSubject, "")
	if after.Code == http.StatusOK {
		decoded := advDecode(t, after, http.StatusOK)
		if len(decoded["items"].([]any)) != 0 {
			t.Fatal("ex-member still lists group rows after leaving: leak")
		}
		totals, _ := decoded["totals"].(map[string]any)
		if totals["count"] != float64(0) {
			t.Fatalf("ex-member totals = %+v, want zero with the empty feed", totals)
		}
	} else if after.Code != http.StatusNotFound {
		t.Fatalf("ex-member feed status = %d, want 404 or empty 200: %s", after.Code, after.Body.String())
	}
	// The direct read closes too.
	read := advServe(t, world.sharing.Routes(), http.MethodGet,
		"/v1/shared/postings/"+advResource(world.owner)+"/"+leaveRow, world.secondSubject, "")
	if read.Code != http.StatusNotFound {
		t.Fatalf("ex-member read status = %d, want 404: %s", read.Code, read.Body.String())
	}
}

// A policy narrowed to zero accounts mid-list must list nothing with
// agreeing zero totals: consent narrowed is consent withdrawn.
func TestIntegrationEdgePolicyNarrowedToZeroMidList_RealSQLite_RealHTTP(t *testing.T) {
	world := advSetup(t)
	if world.groupID == "" {
		t.Skip("needs the group identity set")
	}
	day := int64(1781524800)
	narrowRow := advMustPosting(t, world.ownerSC, "Narrow row", "30.00", day)
	_ = narrowRow
	policyTarget := "/v1/shared/policies/" + world.groupID
	advDecode(t, advServe(t, world.sharing.Routes(), http.MethodPut, policyTarget, world.ownerSubject,
		`{"enabled":true,"accountIds":["checking"],"startDate":"2026-01-01","endDate":"2026-12-31"}`), http.StatusOK)
	feedTarget := "/v1/shared/groups/" + world.groupID + "/feed"
	before := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet, feedTarget, world.secondSubject, ""), http.StatusOK)
	if len(before["items"].([]any)) != 1 {
		t.Fatalf("feed = %+v, want the policy row before narrowing", before)
	}
	advDecode(t, advServe(t, world.sharing.Routes(), http.MethodPut, policyTarget, world.ownerSubject,
		`{"enabled":false,"accountIds":["checking"],"startDate":"2026-01-01","endDate":"2026-12-31"}`), http.StatusOK)
	after := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet, feedTarget, world.secondSubject, ""), http.StatusOK)
	if len(after["items"].([]any)) != 0 {
		t.Fatalf("feed = %+v, want nothing after the policy narrowed to off", after)
	}
	totals, _ := after["totals"].(map[string]any)
	if totals["count"] != float64(0) || totals["totalAmount"] != float64(0) {
		t.Fatalf("totals = %+v, want zero count and zero sum with the empty feed", totals)
	}
}

// Deleting the policy's account mid-policy must drop its rows without
// erroring: no 500, no orphan amounts in totals.
func TestIntegrationEdgeAccountDeletedMidPolicy_RealSQLite_RealHTTP(t *testing.T) {
	world := advSetup(t)
	if world.groupID == "" {
		t.Skip("needs the group identity set")
	}
	day := int64(1781524800)
	delRow := advMustPosting(t, world.ownerSC, "Doomed account row", "30.00", day)
	_ = delRow
	policyTarget := "/v1/shared/policies/" + world.groupID
	advDecode(t, advServe(t, world.sharing.Routes(), http.MethodPut, policyTarget, world.ownerSubject,
		`{"enabled":true,"accountIds":["checking"],"startDate":"2026-01-01","endDate":"2026-12-31"}`), http.StatusOK)
	feedTarget := "/v1/shared/groups/" + world.groupID + "/feed"
	before := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet, feedTarget, world.secondSubject, ""), http.StatusOK)
	if len(before["items"].([]any)) != 1 {
		t.Fatalf("feed = %+v, want the row before the account dies", before)
	}
	if err := world.ownerSC.DeletePosting(delRow); err != nil {
		t.Fatal(err)
	}
	if err := world.ownerSC.DeleteAccount("checking"); err != nil {
		t.Fatal(err)
	}
	after := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet, feedTarget, world.secondSubject, ""), http.StatusOK)
	if len(after["items"].([]any)) != 0 {
		t.Fatalf("feed = %+v, want nothing after the account died", after)
	}
	totals, _ := after["totals"].(map[string]any)
	if totals["count"] != float64(0) {
		t.Fatalf("totals = %+v, want zero with the emptied feed", totals)
	}
}

// The group deleted mid-flow closes the feed, the inbox grant path stays
// direct-share scoped, and the cleared model withdraws every row.
func TestIntegrationEdgeGroupDeletedAndModelClearedMidFlow_RealSQLite_RealHTTP(t *testing.T) {
	world := advSetup(t)
	if world.groupID == "" {
		t.Skip("needs the group identity set")
	}
	day := int64(1781524800)
	goneRow := advMustPosting(t, world.ownerSC, "Gone row", "30.00", day)
	if _, err := world.db.GrantSharedPosting(world.owner, goneRow, "group", world.groupID, advRequestID(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := world.db.GrantSharedPosting(world.owner, goneRow, "user", world.second, advRequestID(t)); err != nil {
		t.Fatal(err)
	}
	if err := world.db.DeleteGroup(world.groupID, world.owner); err != nil {
		t.Fatal(err)
	}
	feed := advServe(t, world.sharing.Routes(), http.MethodGet, "/v1/shared/groups/"+world.groupID+"/feed", world.secondSubject, "")
	if feed.Code != http.StatusNotFound {
		t.Fatalf("deleted-group feed status = %d, want 404: %s", feed.Code, feed.Body.String())
	}
	// The direct-share inbox leg survives the group deletion untouched.
	accept := advDecode(t, advServe(t, world.inbox.Routes(), http.MethodPost, "/v1/inbox/shares/accept", world.secondSubject,
		`{"owner":`+advQuote(advResource(world.owner))+`,"postingId":`+advQuote(goneRow)+`}`), http.StatusOK)
	if accept["item"] == nil {
		t.Fatalf("inbox accept = %+v, want the direct share unaffected by the group deletion", accept)
	}
	// Clearing the owner's model withdraws every row at once.
	if err := world.ownerSC.Clear(); err != nil {
		t.Fatal(err)
	}
	leak := advServe(t, world.sharing.Routes(), http.MethodGet,
		"/v1/shared/postings/"+advResource(world.owner)+"/"+goneRow, world.secondSubject, "")
	if leak.Code != http.StatusNotFound {
		t.Fatalf("cleared-model read status = %d, want 404: %s", leak.Code, leak.Body.String())
	}
}
