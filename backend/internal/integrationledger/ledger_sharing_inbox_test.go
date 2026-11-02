package integrationledger

import (
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

// Completeness across two real users in one database: the shared grocery
// row is visible in the recipient feed and opens through the detail read,
// the viewer totals include it, revocation removes it everywhere and drops
// the totals, and the saved copy survives. The inbox leg lists the direct
// share pending, accepts exactly one copy, declines the second without a
// copy, and keeps unread counts correct.

func ledgerGroup(t *testing.T, world *ledgerWorld) string {
	t.Helper()
	created := ledgerDecode(t, ledgerServe(t, world.groups.Routes(), http.MethodPost, "/v1/groups", world.ownerSubject, `{"name":"Household"}`), http.StatusCreated)
	group, _ := created["group"].(map[string]any)
	groupID, _ := group["id"].(string)
	if groupID == "" {
		t.Fatalf("group = %+v", created)
	}
	invite := ledgerDecode(t, ledgerServe(t, world.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/invites", world.ownerSubject, `{"maxUses":5}`), http.StatusCreated)
	code, _ := invite["code"].(string)
	ledgerDecode(t, ledgerServe(t, world.groups.Routes(), http.MethodPost, "/v1/invites/accept", world.secondSubject, `{"code":`+ledgerQuote(code)+`}`), http.StatusOK)
	return groupID
}

func ledgerGrant(t *testing.T, world *ledgerWorld, postingID, audienceType, audienceID string) {
	t.Helper()
	ledgerDecode(t, ledgerServe(t, world.sharing.Routes(), http.MethodPost, "/v1/shared/grants", world.ownerSubject,
		`{"postingId":`+ledgerQuote(postingID)+`,"audienceType":`+ledgerQuote(audienceType)+`,"audienceId":`+ledgerQuote(audienceID)+`,"requestId":`+ledgerQuote(ledgerRequestID(t))+`}`), http.StatusCreated)
}

func ledgerFeed(t *testing.T, world *ledgerWorld, subject, groupID string) map[string]any {
	t.Helper()
	return ledgerDecode(t, ledgerServe(t, world.sharing.Routes(), http.MethodGet, "/v1/shared/groups/"+groupID+"/feed", subject, ""), http.StatusOK)
}

func TestLedgerSharedRowVisibleOpenableRevocable(t *testing.T) {
	world := ledgerSetup(t, nil)
	ledgerDeletePhantom(t, world)
	groupID := ledgerGroup(t, world)
	byName := ledgerPostingIDs(t, world.ownerSC)
	groceries := byName["GROCER 123"]
	if len(groceries) != 4 {
		t.Fatalf("grocery rows = %d, want 4", len(groceries))
	}
	shared := groceries[0]
	ledgerGrant(t, world, shared, store.SharingAudienceGroup, groupID)

	// The recipient feed shows the shared row, and only it: counts and
	// totals describe exactly the listed set.
	feed := ledgerFeed(t, world, world.secondSubject, groupID)
	items, _ := feed["items"].([]any)
	totals, _ := feed["totals"].(map[string]any)
	if len(items) != 1 || totals["count"] != float64(1) || totals["totalAmount"] != float64(150) {
		t.Fatalf("feed = %+v totals = %+v, want the 1 shared row at 150", items, totals)
	}
	item, _ := items[0].(map[string]any)
	posting, _ := item["posting"].(map[string]any)
	if posting["id"] != shared {
		t.Fatalf("feed item = %+v, want the shared grocery row", item)
	}

	// The row opens through the detail read.
	detail := ledgerServe(t, world.sharing.Routes(), http.MethodGet,
		"/v1/shared/postings/"+ledgerResource(world.owner)+"/"+shared, world.secondSubject, "")
	if detail.Code != http.StatusOK {
		t.Fatalf("detail = %d %s, want the row openable", detail.Code, detail.Body.String())
	}

	// The recipient saves a copy, then the owner revokes: the row leaves
	// the feed and the detail read everywhere, totals drop to zero, and
	// the saved copy survives as an editable private row.
	copied := ledgerDecode(t, ledgerServe(t, world.sharing.Routes(), http.MethodPost, "/v1/shared/copies", world.secondSubject,
		`{"owner":`+ledgerQuote(ledgerResource(world.owner))+`,"postingId":`+ledgerQuote(shared)+`,"requestId":`+ledgerQuote(ledgerRequestID(t))+`}`), http.StatusCreated)
	copyID, _ := copied["posting"].(map[string]any)["id"].(string)
	if copyID == "" || copyID == shared {
		t.Fatalf("copy = %+v, want a new recipient-owned row", copied)
	}
	ledgerDecode(t, ledgerServe(t, world.sharing.Routes(), http.MethodDelete, "/v1/shared/grants", world.ownerSubject,
		`{"postingId":`+ledgerQuote(shared)+`,"audienceType":"group","audienceId":`+ledgerQuote(groupID)+`,"requestId":`+ledgerQuote(ledgerRequestID(t))+`}`), http.StatusOK)
	emptied := ledgerFeed(t, world, world.secondSubject, groupID)
	emptiedItems, _ := emptied["items"].([]any)
	emptiedTotals, _ := emptied["totals"].(map[string]any)
	if len(emptiedItems) != 0 || emptiedTotals["count"] != float64(0) || emptiedTotals["totalAmount"] != float64(0) {
		t.Fatalf("revoked feed = %+v totals = %+v, want empty with zero totals", emptiedItems, emptiedTotals)
	}
	if got := ledgerServe(t, world.sharing.Routes(), http.MethodGet,
		"/v1/shared/postings/"+ledgerResource(world.owner)+"/"+shared, world.secondSubject, ""); got.Code != http.StatusNotFound {
		t.Fatalf("revoked detail = %d, want 404", got.Code)
	}
	secondModel, err := world.secondSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	survives := false
	for _, row := range secondModel.Postings {
		if row.ID == copyID {
			survives = true
			row.Name = "Kept groceries"
			if _, err := world.secondSC.UpdatePosting(row); err != nil {
				t.Fatalf("copy not editable after revocation: %v", err)
			}
		}
	}
	if !survives {
		t.Fatal("saved copy gone after revocation")
	}
}

func ledgerResource(user string) string {
	return "users/" + user[len("user:"):]
}

func TestLedgerInboxAcceptDeclineCounts(t *testing.T) {
	world := ledgerSetup(t, nil)
	ledgerDeletePhantom(t, world)
	byName := ledgerPostingIDs(t, world.ownerSC)
	bookshop := byName["Bookshop order"][0]
	refund := byName["Refund desk"][0]
	ledgerGrant(t, world, bookshop, store.SharingAudienceUser, world.second)
	ledgerGrant(t, world, refund, store.SharingAudienceUser, world.second)
	shareRef := func(posting string) string {
		return `{"owner":` + ledgerQuote(ledgerResource(world.owner)) + `,"postingId":` + ledgerQuote(posting) + `}`
	}

	// Both shares list pending with the unread count to match.
	pending := ledgerDecode(t, ledgerServe(t, world.inbox.Routes(), http.MethodGet, "/v1/inbox", world.secondSubject, ""), http.StatusOK)
	items, _ := pending["items"].([]any)
	if len(items) != 2 || pending["unreadCount"] != float64(2) {
		t.Fatalf("inbox = %+v, want 2 pending with unread 2", pending)
	}

	// Accepting saves exactly one copy; retrying returns the same one.
	accepted := ledgerDecode(t, ledgerServe(t, world.inbox.Routes(), http.MethodPost, "/v1/inbox/shares/accept", world.secondSubject, shareRef(bookshop)), http.StatusOK)
	firstCopy, _ := accepted["item"].(map[string]any)["copyPostingId"].(string)
	if firstCopy == "" {
		t.Fatalf("accept = %+v, want a saved copy", accepted)
	}
	retried := ledgerDecode(t, ledgerServe(t, world.inbox.Routes(), http.MethodPost, "/v1/inbox/shares/accept", world.secondSubject, shareRef(bookshop)), http.StatusOK)
	if retried["item"].(map[string]any)["copyPostingId"] != firstCopy {
		t.Fatalf("accept retry = %+v, want the same copy", retried)
	}
	secondModel, err := world.secondSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(secondModel.Postings) != 1 || secondModel.Postings[0].ID != firstCopy {
		t.Fatalf("recipient rows = %+v, want exactly the accepted copy", secondModel.Postings)
	}

	// Declining removes the share without saving anything.
	declined := ledgerDecode(t, ledgerServe(t, world.inbox.Routes(), http.MethodPost, "/v1/inbox/shares/decline", world.secondSubject, shareRef(refund)), http.StatusOK)
	if declined["item"].(map[string]any)["status"] != "declined" {
		t.Fatalf("decline = %+v", declined)
	}
	secondModel, err = world.secondSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(secondModel.Postings) != 1 {
		t.Fatalf("recipient rows = %d after decline, want still 1", len(secondModel.Postings))
	}
	remaining := ledgerDecode(t, ledgerServe(t, world.inbox.Routes(), http.MethodGet, "/v1/inbox?status=all", world.secondSubject, ""), http.StatusOK)
	leftovers, _ := remaining["items"].([]any)
	if len(leftovers) != 2 {
		t.Fatalf("inbox all = %d items, want accepted plus declined", len(leftovers))
	}
}
