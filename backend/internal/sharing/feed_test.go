package sharing_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/sharing"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
)

const feedGroupTransactionA = "01900000-0000-7000-8000-0000000000d1"
const feedGroupTransactionB = "01900000-0000-7000-8000-0000000000d2"
const feedGroupTransactionC = "01900000-0000-7000-8000-0000000000d3"

type feedResponse struct {
	GroupID string `json:"groupId"`
	Items   []struct {
		OwnerUserID       string `json:"ownerUserId"`
		SourceDisplayName string `json:"sourceDisplayName"`
		Audiences         []struct {
			Type string `json:"type"`
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"audiences"`
		Transaction struct {
			ID              string `json:"id"`
			Name            string `json:"name"`
			TransactionTime int64  `json:"transactionTime"`
			Pending         bool   `json:"pending"`
		} `json:"transaction"`
	} `json:"items"`
	Totals struct {
		Count        int     `json:"count"`
		TotalAmount  float64 `json:"totalAmount"`
		VaryingCount int     `json:"varyingCount"`
		PendingCount int     `json:"pendingCount"`
	} `json:"totals"`
	Page struct {
		NextCursor string `json:"nextCursor"`
		HasMore    bool   `json:"hasMore"`
	} `json:"page"`
}

func feedGroup(t *testing.T, db store.Database, owner, name, member string) string {
	t.Helper()
	ownerID, err := db.EnsureGroupUser(testIssuer, owner)
	if err != nil {
		t.Fatal(err)
	}
	group, err := db.CreateGroup(ownerID, name, owner)
	if err != nil {
		t.Fatal(err)
	}
	memberID, err := db.EnsureGroupUser(testIssuer, member)
	if err != nil {
		t.Fatal(err)
	}
	_, code, err := db.CreateInvite(group.ID, ownerID, 5, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.AcceptInvite(code, memberID, member); err != nil {
		t.Fatal(err)
	}
	return group.ID
}

func ownerResource(user string) string {
	return "users/" + user[len("user:"):]
}

func getFeed(t *testing.T, h *sharing.Handler, target, subject string) (int, feedResponse) {
	t.Helper()
	w := do(t, h, "GET", target, subject, "")
	var response feedResponse
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode feed: %v: %s", err, w.Body.String())
	}
	return w.Code, response
}

func feedSetup(t *testing.T) (*sharing.Handler, store.Database, string, string, string) {
	t.Helper()
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	_, _ = mustUser(t, db, "bob")
	group := feedGroup(t, db, "alice", "Cabin", "bob")
	mustTransaction(t, storeA, feedGroupTransactionA)
	mustTransaction(t, storeA, feedGroupTransactionB)
	mustTransaction(t, storeA, feedGroupTransactionC)
	return h, db, alice, group, ownerResource(alice)
}

// The feed serves the member's authorized transactions with totals over the
// same set; keyset pages walk the whole feed without repeats.
func TestGroupFeedEndpoint(t *testing.T) {
	h, db, alice, group, _ := feedSetup(t)
	for _, id := range []string{feedGroupTransactionA, feedGroupTransactionB, feedGroupTransactionC} {
		if _, err := db.GrantSharedTransaction(alice, id, store.SharingAudienceGroup, group, testRequestKey(t)); err != nil {
			t.Fatal(err)
		}
	}
	target := "/v1/shared/groups/" + group + "/feed?limit=2"
	code, first := getFeed(t, h, target, "bob")
	if code != 200 {
		t.Fatalf("feed status = %d, want 200", code)
	}
	if len(first.Items) != 2 || !first.Page.HasMore || first.Page.NextCursor == "" {
		t.Fatalf("first page = %+v, want 2 items with a next cursor", first.Page)
	}
	if first.Totals.Count != 3 || first.Totals.TotalAmount != 30 || first.Totals.VaryingCount != 0 || first.Totals.PendingCount != 0 {
		t.Fatalf("totals = %+v, want count 3 amount 30", first.Totals)
	}
	code, second := getFeed(t, h, target+"&cursor="+first.Page.NextCursor, "bob")
	if code != 200 || len(second.Items) != 1 || second.Page.HasMore {
		t.Fatalf("second page = %d %+v, want 1 item without more", code, second.Page)
	}
	if second.Items[0].Transaction.ID == first.Items[0].Transaction.ID || second.Items[0].Transaction.ID == first.Items[1].Transaction.ID {
		t.Fatalf("second page repeats the first page: %+v", second.Items)
	}
	// Totals stay over the whole filtered set on every page.
	if second.Totals.Count != 3 {
		t.Fatalf("second page totals = %+v, want count 3", second.Totals)
	}
	if second.Items[0].SourceDisplayName != "alice" || len(second.Items[0].Audiences) != 1 {
		t.Fatalf("feed item = %+v, want named source with one audience", second.Items[0])
	}
}

// Navigation filters narrow the listing and the totals together; invalid
// filters report 400 with a plain reason.
func TestGroupFeedFilters(t *testing.T) {
	h, db, alice, group, aliceResource := feedSetup(t)
	for _, id := range []string{feedGroupTransactionA, feedGroupTransactionB} {
		if _, err := db.GrantSharedTransaction(alice, id, store.SharingAudienceGroup, group, testRequestKey(t)); err != nil {
			t.Fatal(err)
		}
	}
	base := "/v1/shared/groups/" + group + "/feed"
	code, filtered := getFeed(t, h, base+"?member="+aliceResource, "bob")
	if code != 200 || len(filtered.Items) != 2 || filtered.Totals.Count != 2 {
		t.Fatalf("member filter = %d %+v, want 2 items", code, filtered.Totals)
	}
	code, none := getFeed(t, h, base+"?member=users/0000000000000000000000000000000000000000000000000000000000000000", "bob")
	if code != 200 || len(none.Items) != 0 || none.Totals.Count != 0 || none.Totals.TotalAmount != 0 {
		t.Fatalf("unknown member filter = %d %+v, want empty", code, none.Totals)
	}
	code, dated := getFeed(t, h, base+"?startDate=2026-01-01&endDate=2026-12-31", "bob")
	if code != 200 || len(dated.Items) != 2 {
		t.Fatalf("date filter = %d items, want 2", len(dated.Items))
	}
	code, future := getFeed(t, h, base+"?startDate=2030-01-01", "bob")
	if code != 200 || len(future.Items) != 0 || future.Totals.Count != 0 {
		t.Fatalf("future filter = %d %+v, want empty", code, future.Totals)
	}
	code, out := getFeed(t, h, base+"?direction=out", "bob")
	if code != 200 || len(out.Items) != 2 {
		t.Fatalf("direction filter = %d items, want 2", len(out.Items))
	}
	code, in := getFeed(t, h, base+"?direction=in", "bob")
	if code != 200 || len(in.Items) != 0 {
		t.Fatalf("money-in filter = %d items, want 0", len(in.Items))
	}
	for _, bad := range []string{"?startDate=not-a-date", "?direction=sideways", "?limit=0", "?limit=500", "?cursor=!!!", "?member=nope"} {
		if code, _ := getFeed(t, h, base+bad, "bob"); code != 400 {
			t.Fatalf("filter %q status = %d, want 400", bad, code)
		}
	}
	if code, _ := getFeed(t, h, base+"?startDate=2026-02-01&endDate=2026-01-01", "bob"); code != 400 {
		t.Fatalf("inverted range status = %d, want 400", code)
	}
}

// Non-members, unknown groups, forged group IDs, and anonymous callers
// fail closed without revealing group visibility.
func TestGroupFeedClosedToOutsiders(t *testing.T) {
	h, db, alice, group, _ := feedSetup(t)
	if _, err := db.GrantSharedTransaction(alice, feedGroupTransactionA, store.SharingAudienceGroup, group, testRequestKey(t)); err != nil {
		t.Fatal(err)
	}
	mustUser(t, db, "carol")
	target := "/v1/shared/groups/" + group + "/feed"
	if code, _ := getFeed(t, h, target, "carol"); code != 404 {
		t.Fatalf("non-member status = %d, want 404", code)
	}
	if code, _ := getFeed(t, h, "/v1/shared/groups/00000000-0000-4000-8000-000000000000/feed", "bob"); code != 404 {
		t.Fatalf("unknown group status = %d, want 404", code)
	}
	if code, _ := getFeed(t, h, "/v1/shared/groups/not-a-group/feed", "bob"); code != 404 {
		t.Fatalf("forged group status = %d, want 404", code)
	}
	if code, _ := getFeed(t, h, target, ""); code != 401 {
		t.Fatalf("anonymous status = %d, want 401", code)
	}
}

// Exclusions deny the feed, the totals count the survivors, and pending
// rows stay visible with their marker while authorized.
func TestGroupFeedExclusionsTotals(t *testing.T) {
	h, db, alice, group, _ := feedSetup(t)
	for _, id := range []string{feedGroupTransactionA, feedGroupTransactionB} {
		if _, err := db.GrantSharedTransaction(alice, id, store.SharingAudienceGroup, group, testRequestKey(t)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.ExcludeSharedTransaction(alice, feedGroupTransactionA, store.SharingAudienceUser, mustUserID(t, db, "bob"), testRequestKey(t)); err != nil {
		t.Fatal(err)
	}
	code, response := getFeed(t, h, "/v1/shared/groups/"+group+"/feed", "bob")
	if code != 200 || len(response.Items) != 1 || response.Totals.Count != 1 || response.Totals.TotalAmount != 10 {
		t.Fatalf("excluded feed = %d %+v, want one 10-unit survivor", code, response.Totals)
	}
}

func mustUserID(t *testing.T, db store.Database, subject string) string {
	t.Helper()
	user, err := db.EnsureGroupUser(testIssuer, subject)
	if err != nil {
		t.Fatal(err)
	}
	return user
}
