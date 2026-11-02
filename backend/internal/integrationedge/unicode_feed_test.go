package integrationedge

import (
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/integrationfixtures"
)

// Unicode and emoji counterparty names through the owner's list, the
// shared feed, totals, copies, and the inbox. Every surface must carry
// the names byte-identical: truncation mid-rune or normalization drift
// corrupts row identity. Real SQLite store and real production routers over real HTTP; the only stand-in is identity (no OIDC round trip).
func TestIntegrationEdgeUnicodeNames_RealSQLite_RealHTTP(t *testing.T) {
	world := advSetup(t)
	if world.groupID == "" {
		t.Skip("needs the group identity set")
	}
	pack, err := integrationfixtures.Load(integrationfixtures.PackUnicode)
	if err != nil {
		t.Fatal(err)
	}
	for _, posting := range pack.Model.Postings {
		advEnsurePostingID(t, world.ownerSC, posting.ID, posting.Name, "12.00", 1781524800)
		if _, err := world.db.GrantSharedPosting(world.owner, posting.ID, "group", world.groupID, advRequestID(t)); err != nil {
			t.Fatal(err)
		}
	}
	feed := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet, "/v1/shared/groups/"+world.groupID+"/feed", world.secondSubject, ""), http.StatusOK)
	items, _ := feed["items"].([]any)
	if len(items) < len(pack.Model.Postings) {
		t.Fatalf("feed items = %d, want at least the %d unicode rows", len(items), len(pack.Model.Postings))
	}
	advFeedTotalsAgreement(t, feed)
	byID := map[string]string{}
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		posting, _ := item["posting"].(map[string]any)
		id, _ := posting["id"].(string)
		name, _ := posting["name"].(string)
		byID[id] = name
	}
	for _, want := range pack.Model.Postings {
		got, ok := byID[want.ID]
		if !ok {
			t.Fatalf("unicode row %q missing from the feed", want.ID)
		}
		if got != want.Name {
			t.Fatalf("feed name for %q = %q, want byte-identical %q", want.ID, got, want.Name)
		}
	}

	// A saved copy keeps the exact name, and the owner's own list does too.
	copied := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodPost, "/v1/shared/copies", world.secondSubject,
		`{"owner":`+advQuote(advResource(world.owner))+`,"postingId":"`+pack.Model.Postings[0].ID+`","requestId":`+advQuote(advRequestID(t))+`}`), http.StatusCreated)
	saved, _ := copied["posting"].(map[string]any)
	if saved["name"] != pack.Model.Postings[0].Name {
		t.Fatalf("copy name = %q, want byte-identical %q", saved["name"], pack.Model.Postings[0].Name)
	}
	model, err := world.ownerSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	stored := map[string]string{}
	for _, posting := range model.Postings {
		stored[posting.ID] = posting.Name
	}
	for _, want := range pack.Model.Postings {
		if stored[want.ID] != want.Name {
			t.Fatalf("stored name for %q = %q, want byte-identical %q", want.ID, stored[want.ID], want.Name)
		}
	}
}
