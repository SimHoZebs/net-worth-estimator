package integrationedge

import (
	"net/http"
	"testing"
)

// Revocation in the middle of reads, copies, and inbox decisions. Every
// revocation must close visibility at once: feeds drop the row, totals
// agree with the listed set, copies fail, and inbox decisions fail without
// writing a copy. Real SQLite store and real production routers over real HTTP; the only stand-in is identity (no OIDC round trip).
func TestIntegrationEdgeRevocationMidPagination_RealSQLite_RealHTTP(t *testing.T) {
	world := advSetup(t)
	if world.groupID == "" {
		t.Skip("needs the group identity set")
	}
	day := int64(1781524800)
	pageRows := map[string]string{}
	for _, row := range []struct{ key, name string }{
		{"a", "Page row A"},
		{"b", "Page row B"},
		{"c", "Page row C"},
	} {
		pageRows[row.key] = advMustPosting(t, world.ownerSC, row.name, "10.00", day)
		if _, err := world.db.GrantSharedPosting(world.owner, pageRows[row.key], "group", world.groupID, advRequestID(t)); err != nil {
			t.Fatal(err)
		}
	}
	feedTarget := "/v1/shared/groups/" + world.groupID + "/feed?limit=2"
	first := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet, feedTarget, world.secondSubject, ""), http.StatusOK)
	items, _ := first["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("first page items = %d, want 2", len(items))
	}
	page, _ := first["page"].(map[string]any)
	cursor, _ := page["nextCursor"].(string)
	if cursor == "" {
		t.Fatalf("first page = %+v, want a next cursor", first)
	}
	fullBefore := advFeedList(t, world, world.secondSubject)
	beforeCount := len(fullBefore["items"].([]any))
	// Owner revokes the row the next page would carry, mid-pagination.
	if err := world.db.RevokeSharedPosting(world.owner, pageRows["c"], "group", world.groupID, advRequestID(t)); err != nil {
		t.Fatal(err)
	}
	second := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet, feedTarget+"&cursor="+cursor, world.secondSubject, ""), http.StatusOK)
	for _, raw := range second["items"].([]any) {
		item, _ := raw.(map[string]any)
		posting, _ := item["posting"].(map[string]any)
		if posting["id"] == pageRows["c"] {
			t.Fatal("revoked row still pages after mid-pagination revocation: leak")
		}
	}
	full := advFeedList(t, world, world.secondSubject)
	advFeedTotalsAgreement(t, full)
	totals, _ := full["totals"].(map[string]any)
	if totals["count"] != float64(beforeCount-1) {
		t.Fatalf("feed totals = %+v, want exactly the revoked row withdrawn", totals)
	}
}

// A copy saved after revocation must fail closed with no recipient row.
func TestIntegrationEdgeRevocationMidCopySave_RealSQLite_RealHTTP(t *testing.T) {
	world := advSetup(t)
	if world.groupID == "" {
		t.Skip("needs the group identity set")
	}
	day := int64(1781524800)
	revokeCopyRow := advMustPosting(t, world.ownerSC, "Revoke-copy row", "15.00", day)
	if _, err := world.db.GrantSharedPosting(world.owner, revokeCopyRow, "group", world.groupID, advRequestID(t)); err != nil {
		t.Fatal(err)
	}
	// The recipient sees the row, then the owner revokes before the save.
	if !advFeedIDs(t, world, world.secondSubject)[revokeCopyRow] {
		t.Fatal("granted row not visible before the revocation")
	}
	if err := world.db.RevokeSharedPosting(world.owner, revokeCopyRow, "group", world.groupID, advRequestID(t)); err != nil {
		t.Fatal(err)
	}
	response := advServe(t, world.sharing.Routes(), http.MethodPost, "/v1/shared/copies", world.secondSubject,
		`{"owner":`+advQuote(advResource(world.owner))+`,"postingId":`+advQuote(revokeCopyRow)+`,"requestId":`+advQuote(advRequestID(t))+`}`)
	if response.Code != http.StatusNotFound {
		t.Fatalf("copy-after-revoke status = %d, want 404 with nothing saved: %s", response.Code, response.Body.String())
	}
	model, err := world.secondSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	for _, posting := range model.Postings {
		if posting.Name == "Revoke-copy row" {
			t.Fatal("copy-after-revoke wrote a recipient row: leak")
		}
	}
}

// An inbox decision after revocation must fail closed with no copy.
func TestIntegrationEdgeRevocationMidInboxDecide_RealSQLite_RealHTTP(t *testing.T) {
	world := advSetup(t)
	if advIdentitySet() == advSetSolo {
		t.Skip("needs a second user")
	}
	day := int64(1781524800)
	revokeInboxRow := advMustPosting(t, world.ownerSC, "Revoke-inbox row", "25.00", day)
	if _, err := world.db.GrantSharedPosting(world.owner, revokeInboxRow, "user", world.second, advRequestID(t)); err != nil {
		t.Fatal(err)
	}
	listed := advDecode(t, advServe(t, world.inbox.Routes(), http.MethodGet, "/v1/inbox", world.secondSubject, ""), http.StatusOK)
	if listed["items"] == nil {
		t.Fatalf("inbox = %+v, want the direct share listed", listed)
	}
	if err := world.db.RevokeSharedPosting(world.owner, revokeInboxRow, "user", world.second, advRequestID(t)); err != nil {
		t.Fatal(err)
	}
	response := advServe(t, world.inbox.Routes(), http.MethodPost, "/v1/inbox/shares/accept", world.secondSubject,
		`{"owner":`+advQuote(advResource(world.owner))+`,"postingId":`+advQuote(revokeInboxRow)+`}`)
	if response.Code != http.StatusNotFound && response.Code != http.StatusConflict {
		t.Fatalf("accept-after-revoke status = %d, want 404 or 409 with no copy: %s", response.Code, response.Body.String())
	}
	model, err := world.secondSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	for _, posting := range model.Postings {
		if posting.Name == "Revoke-inbox row" {
			t.Fatal("accept-after-revoke wrote a recipient row: leak")
		}
	}
}

// Void-marking a row mid-share drops it from the feed and fails copies;
// void-marking a split source keeps the split readable but the voided row
// unshareable. Fail-closed throughout, never a 500.
func TestIntegrationEdgeVoidMidShareAndSplit_RealSQLite_RealHTTP(t *testing.T) {
	world := advSetup(t)
	if world.groupID == "" {
		t.Skip("needs the group identity set")
	}
	day := int64(1781524800)
	rowID := advSeedBankPending(t, world.ownerSC, "Void-share row", "40.00", day, "adv-void-1")
	if _, err := world.db.GrantSharedPosting(world.owner, rowID, "group", world.groupID, advRequestID(t)); err != nil {
		t.Fatal(err)
	}
	split, err := world.db.CreateSplit(world.owner, advSplitInput(world, rowID), advRequestID(t))
	if err != nil {
		t.Fatal(err)
	}
	advVoid(t, world.ownerSC, rowID)
	feed := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet, "/v1/shared/groups/"+world.groupID+"/feed", world.secondSubject, ""), http.StatusOK)
	for _, raw := range feed["items"].([]any) {
		item, _ := raw.(map[string]any)
		posting, _ := item["posting"].(map[string]any)
		if posting["id"] == rowID {
			t.Fatal("voided row still feeds after void-marking: leak")
		}
	}
	copy := advServe(t, world.sharing.Routes(), http.MethodPost, "/v1/shared/copies", world.secondSubject,
		`{"owner":`+advQuote(advResource(world.owner))+`,"postingId":`+advQuote(rowID)+`,"requestId":`+advQuote(advRequestID(t))+`}`)
	if copy.Code != http.StatusNotFound {
		t.Fatalf("copy-of-void status = %d, want 404: %s", copy.Code, copy.Body.String())
	}
	kept, err := world.db.GetSplit(world.owner, split.ID)
	if err != nil {
		t.Fatalf("split unreadable after its source voided: %v", err)
	}
	if kept.ID != split.ID {
		t.Fatalf("split = %+v, want the recorded obligation to survive its voided source", kept)
	}
}
