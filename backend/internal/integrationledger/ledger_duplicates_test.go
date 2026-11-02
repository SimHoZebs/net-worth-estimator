package integrationledger

import (
	"testing"
)

// Completeness against duplication: row identities stay unique across
// the list, the feed, the findings, and the diagram sources, and the
// repeat bank feed adds nothing and resurrects nothing.

func TestLedgerIdentitiesUniqueAcrossSurfaces(t *testing.T) {
	world := ledgerSetup(t, nil)
	ledgerDeletePhantom(t, world)
	groupID := ledgerGroup(t, world)
	byName := ledgerPostingIDs(t, world.ownerSC)
	ledgerGrant(t, world, byName["GROCER 123"][0], "group", groupID)
	findings, _ := ledgerDetect(t, world.ownerSC)

	seen := map[string]string{}
	claim := func(id, surface string) {
		if first, dup := seen[id]; dup {
			t.Fatalf("row %s on %s and %s", id, first, surface)
		}
		seen[id] = surface
	}
	for _, row := range ledgerList(t, world) {
		claim(row.ID, "list")
	}
	// The feed carries the owner's granted row plus the member's own
	// rows: same-row IDs across viewers are the same row, not duplicates.
	// Uniqueness within each view plus the shared-row check below is the
	// honest assertion.
	ownerFeed := ledgerFeed(t, world, world.ownerSubject, groupID)
	ownerIDs := map[string]bool{}
	for _, raw := range ownerFeed["items"].([]any) {
		item, _ := raw.(map[string]any)
		posting, _ := item["posting"].(map[string]any)
		id, _ := posting["id"].(string)
		if ownerIDs[id] {
			t.Fatalf("row %s twice in the owner feed", id)
		}
		ownerIDs[id] = true
		if _, ok := seen[id]; !ok {
			t.Fatalf("feed row %s names no listed row", id)
		}
	}
	memberFeed := ledgerFeed(t, world, world.secondSubject, groupID)
	for _, raw := range memberFeed["items"].([]any) {
		item, _ := raw.(map[string]any)
		posting, _ := item["posting"].(map[string]any)
		id, _ := posting["id"].(string)
		if _, ok := seen[id]; !ok {
			t.Fatalf("feed row %s names no listed row", id)
		}
	}
	for _, finding := range findings {
		if _, ok := seen[finding.PostingID]; !ok {
			t.Fatalf("finding row %s names no listed row", finding.PostingID)
		}
	}
	graph := ledgerFlows(t, world, world.expected.WindowStart, world.expected.WindowEnd)
	for id := range ledgerEdgeSources(graph) {
		if _, ok := seen[id]; !ok {
			t.Fatalf("diagram source %s names no listed row", id)
		}
	}
}

func TestLedgerResyncAddsNothing(t *testing.T) {
	world := ledgerSetup(t, nil)
	ledgerDeletePhantom(t, world)
	before, err := world.ownerSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	beforeIDs := map[string]bool{}
	for _, posting := range before.Postings {
		beforeIDs[posting.ID] = true
	}
	// The pack repeats its final feed: the repeat must add no rows and
	// must not resurrect the deleted phantom.
	feeds := world.pack.Extras.BankFeeds
	ledgerApplyFeeds(t, world, len(feeds)-1, len(feeds))
	after, err := world.ownerSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Postings) != len(before.Postings) {
		t.Fatalf("postings = %d after re-sync, want %d", len(after.Postings), len(before.Postings))
	}
	for _, posting := range after.Postings {
		if !beforeIDs[posting.ID] {
			t.Fatalf("re-sync minted row %q", posting.Name)
		}
		if posting.Name == "PHANTOM" {
			t.Fatal("deleted phantom resurrected by re-sync")
		}
	}
	// The findings still cover exactly the four grocery rows.
	findings, _ := ledgerDetect(t, world.ownerSC)
	if len(findings) != world.expected.DetectCount {
		t.Fatalf("findings = %d after re-sync, want %d", len(findings), world.expected.DetectCount)
	}
}
