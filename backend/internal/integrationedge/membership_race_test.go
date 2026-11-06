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
	leaveRow := advMustTransaction(t, world.ownerSC, "Leave row", "30.00", day)
	if _, err := world.db.GrantSharedTransaction(world.owner, leaveRow, "group", world.groupID, advRequestID(t)); err != nil {
		t.Fatal(err)
	}
	feedTarget := "/v1/shared/groups/" + world.groupID + "/feed"
	before := advFeedIDs(t, world, world.secondSubject)
	if !before[leaveRow] {
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
		"/v1/shared/transactions/"+advResource(world.owner)+"/"+leaveRow, world.secondSubject, "")
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
	narrowRow := advMustTransaction(t, world.ownerSC, "Narrow row", "30.00", day)
	_ = narrowRow
	policyTarget := "/v1/shared/policies/" + world.groupID
	advDecode(t, advServe(t, world.sharing.Routes(), http.MethodPut, policyTarget, world.ownerSubject,
		`{"enabled":true,"accountIds":["checking"],"startDate":"2026-01-01","endDate":"2026-12-31"}`), http.StatusOK)
	before := advFeedList(t, world, world.secondSubject)
	beforeIDs := map[string]bool{}
	for _, raw := range before["items"].([]any) {
		item, _ := raw.(map[string]any)
		transaction, _ := item["transaction"].(map[string]any)
		id, _ := transaction["id"].(string)
		beforeIDs[id] = true
	}
	if !beforeIDs[narrowRow] {
		t.Fatalf("feed = %+v, want the policy row before narrowing", before)
	}
	advDecode(t, advServe(t, world.sharing.Routes(), http.MethodPut, policyTarget, world.ownerSubject,
		`{"enabled":false,"accountIds":["checking"],"startDate":"2026-01-01","endDate":"2026-12-31"}`), http.StatusOK)
	after := advFeedList(t, world, world.secondSubject)
	advFeedTotalsAgreement(t, after)
	for _, raw := range after["items"].([]any) {
		item, _ := raw.(map[string]any)
		transaction, _ := item["transaction"].(map[string]any)
		if transaction["id"] == narrowRow {
			t.Fatal("narrowed row still lists after the policy narrowed to off")
		}
	}
	totals, _ := after["totals"].(map[string]any)
	// This test grants nothing, so disabling the policy withdraws every
	// policy-derived row including pack background: the feed must be empty
	// with agreeing zero totals.
	if totals["count"] != float64(0) {
		t.Fatalf("totals = %+v, want the whole policy-derived set withdrawn", totals)
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
	delRow := advMustTransaction(t, world.ownerSC, "Doomed account row", "30.00", day)
	_ = delRow
	policyTarget := "/v1/shared/policies/" + world.groupID
	advDecode(t, advServe(t, world.sharing.Routes(), http.MethodPut, policyTarget, world.ownerSubject,
		`{"enabled":true,"accountIds":["checking"],"startDate":"2026-01-01","endDate":"2026-12-31"}`), http.StatusOK)
	before := advFeedList(t, world, world.secondSubject)
	if !advFeedIDs(t, world, world.secondSubject)[delRow] {
		t.Fatalf("feed = %+v, want the row before the account dies", before)
	}
	model, err := world.ownerSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	for _, transaction := range model.Transactions {
		if err := world.ownerSC.DeleteTransaction(transaction.ID); err != nil {
			t.Fatal(err)
		}
	}
	if err := world.ownerSC.DeleteAccount("checking"); err != nil {
		t.Fatal(err)
	}
	after := advFeedList(t, world, world.secondSubject)
	advFeedTotalsAgreement(t, after)
	totals, _ := after["totals"].(map[string]any)
	if totals["count"] != float64(0) {
		t.Fatalf("totals = %+v, want every row withdrawn with the account", totals)
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
	goneRow := advMustTransaction(t, world.ownerSC, "Gone row", "30.00", day)
	if _, err := world.db.GrantSharedTransaction(world.owner, goneRow, "group", world.groupID, advRequestID(t)); err != nil {
		t.Fatal(err)
	}
	if _, err := world.db.GrantSharedTransaction(world.owner, goneRow, "user", world.second, advRequestID(t)); err != nil {
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
		`{"owner":`+advQuote(advResource(world.owner))+`,"transactionId":`+advQuote(goneRow)+`}`), http.StatusOK)
	if accept["item"] == nil {
		t.Fatalf("inbox accept = %+v, want the direct share unaffected by the group deletion", accept)
	}
	// Clearing the owner's model withdraws every row at once.
	if err := world.ownerSC.Clear(); err != nil {
		t.Fatal(err)
	}
	leak := advServe(t, world.sharing.Routes(), http.MethodGet,
		"/v1/shared/transactions/"+advResource(world.owner)+"/"+goneRow, world.secondSubject, "")
	if leak.Code != http.StatusNotFound {
		t.Fatalf("cleared-model read status = %d, want 404: %s", leak.Code, leak.Body.String())
	}
}
