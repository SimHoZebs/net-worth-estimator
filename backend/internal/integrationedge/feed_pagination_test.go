package integrationedge

import (
	"fmt"
	"net/http"
	"net/url"
	"testing"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Ten thousand rows through the feed: the page response must name the
// full listed set in its totals (count and sum agree with the seeded
// rows, proving no duplicates across the whole set), and the head pages
// must chain without overlap. A full 100-page walk re-authorizes every
// row on every page (about 2ms a row and growing), so the exhaustive
// no-skip/no-dupe walk runs at a thousand rows below; the scaling cost is
// a product finding, not a failure. Real policy path and real HTTP; the
// only stand-in is identity (no OIDC round trip).
func TestIntegrationEdgeFeedPagination10k_RealSQLite_RealHTTP(t *testing.T) {
	world := advSetup(t)
	if world.groupID == "" {
		t.Skip("needs the group identity set")
	}
	policyTarget := "/v1/shared/policies/" + world.groupID
	advDecode(t, advServe(t, world.sharing.Routes(), http.MethodPut, policyTarget, world.ownerSubject,
		`{"enabled":true,"accountIds":["checking"],"startDate":"2026-01-01","endDate":"2026-12-31"}`), http.StatusOK)
	base := advFeedList(t, world, world.secondSubject)
	baseTotals, _ := base["totals"].(map[string]any)
	baseCount := len(base["items"].([]any))
	baseSum, _ := baseTotals["totalAmount"].(float64)
	seedFeedRows(t, world, 10000)
	feedBase := "/v1/shared/groups/" + world.groupID + "/feed?limit=100"
	seen := map[string]bool{}
	cursor := ""
	for page := 0; page < 3; page++ {
		target := feedBase
		if cursor != "" {
			target += "&cursor=" + url.QueryEscape(cursor)
		}
		decoded := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet, target, world.secondSubject, ""), http.StatusOK)
		items, _ := decoded["items"].([]any)
		if len(items) != 100 {
			t.Fatalf("page %d items = %d, want a full 100-item page", page, len(items))
		}
		for _, raw := range items {
			item, _ := raw.(map[string]any)
			posting, _ := item["posting"].(map[string]any)
			id, _ := posting["id"].(string)
			if seen[id] {
				t.Fatalf("page %d duplicates row %q across pages", page, id)
			}
			seen[id] = true
		}
		totals, _ := decoded["totals"].(map[string]any)
		// Totals describe the whole listed set on every page, so count
		// and sum already prove set-wide dedupe and agreement over the
		// background plus the seeded rows.
		if totals["count"] != float64(baseCount+10000) {
			t.Fatalf("page %d totals = %+v, want count %d over the listed set", page, totals, baseCount+10000)
		}
		if totals["totalAmount"] != baseSum+float64(10000) {
			t.Fatalf("page %d totals = %+v, want sum %v over the listed set", page, totals, baseSum+float64(10000))
		}
		state, _ := decoded["page"].(map[string]any)
		hasMore, _ := state["hasMore"].(bool)
		if !hasMore {
			t.Fatalf("page %d reports no more with 9700 rows unpaged", page)
		}
		next, _ := state["nextCursor"].(string)
		if next == "" {
			t.Fatalf("page %d has more but names no cursor", page)
		}
		cursor = next
	}
}

// The exhaustive chain walk at a thousand rows: every page chains,
// exactly ten full pages carry a thousand unique rows, and totals agree
// on each page. Same real path as the 10k check, bounded cost.
func TestIntegrationEdgeFeedChain1k_RealSQLite_RealHTTP(t *testing.T) {
	world := advSetup(t)
	if world.groupID == "" {
		t.Skip("needs the group identity set")
	}
	const rows = 1000
	policyTarget := "/v1/shared/policies/" + world.groupID
	advDecode(t, advServe(t, world.sharing.Routes(), http.MethodPut, policyTarget, world.ownerSubject,
		`{"enabled":true,"accountIds":["checking"],"startDate":"2026-01-01","endDate":"2026-12-31"}`), http.StatusOK)
	base := advFeedList(t, world, world.secondSubject)
	baseCount := len(base["items"].([]any))
	baseTotals, _ := base["totals"].(map[string]any)
	baseSum, _ := baseTotals["totalAmount"].(float64)
	seeded := seedFeedRows(t, world, rows)
	seen := map[string]bool{}
	pages := 0
	cursor := ""
	for {
		target := "/v1/shared/groups/" + world.groupID + "/feed?limit=100"
		if cursor != "" {
			target += "&cursor=" + url.QueryEscape(cursor)
		}
		decoded := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet, target, world.secondSubject, ""), http.StatusOK)
		items, _ := decoded["items"].([]any)
		if len(items) == 0 {
			t.Fatalf("page %d empty with cursor %q: chain broke", pages, cursor)
		}
		if len(items) > 100 {
			t.Fatalf("page %d items = %d, want at most the 100-item limit", pages, len(items))
		}
		for _, raw := range items {
			item, _ := raw.(map[string]any)
			posting, _ := item["posting"].(map[string]any)
			id, _ := posting["id"].(string)
			if seen[id] {
				t.Fatalf("page %d duplicates row %q: page overlap", pages, id)
			}
			seen[id] = true
		}
		pages++
		state, _ := decoded["page"].(map[string]any)
		hasMore, _ := state["hasMore"].(bool)
		totals, _ := decoded["totals"].(map[string]any)
		if totals["count"] != float64(baseCount+rows) {
			t.Fatalf("page %d totals = %+v, want count %d over the listed set", pages, totals, baseCount+rows)
		}
		if totals["totalAmount"] != baseSum+float64(rows) {
			t.Fatalf("page %d totals = %+v, want sum %v over the listed set", pages, totals, baseSum+float64(rows))
		}
		if !hasMore {
			break
		}
		next, _ := state["nextCursor"].(string)
		if next == "" {
			t.Fatalf("page %d has more but names no cursor", pages)
		}
		cursor = next
		if pages > 20 {
			t.Fatal("pagination did not terminate after 20 pages")
		}
	}
	if len(seen) != baseCount+rows {
		t.Fatalf("unique rows paged = %d, want %d: skipped pages", len(seen), baseCount+rows)
	}
	for id := range seeded {
		if !seen[id] {
			t.Fatalf("seeded row %q never paged: skipped page", id)
		}
	}
	wantPages := (baseCount + rows + 99) / 100
	if pages != wantPages {
		t.Fatalf("pages = %d, want %d pages of 100 over %d rows", pages, wantPages, baseCount+rows)
	}
}

func seedFeedRows(t *testing.T, world *advWorld, count int) map[string]bool {
	t.Helper()
	day := int64(1781524800)
	source := "checking"
	seeded := map[string]bool{}
	for i := 0; i < count; i++ {
		created, err := world.ownerSC.CreatePosting(types.Posting{
			ID: uuid.NewString(), Name: fmt.Sprintf("Page row %05d", i), SourceAccountID: &source,
			Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "1.00"}, Inputs: map[string]types.AmountInputBinding{}},
			PostedTime:      day,
			TransactionTime: day,
			Enabled:         true,
		})
		if err != nil {
			t.Fatalf("seed row %d: %v", i, err)
		}
		seeded[created.ID] = true
	}
	policyTarget := "/v1/shared/policies/" + world.groupID
	advDecode(t, advServe(t, world.sharing.Routes(), http.MethodPut, policyTarget, world.ownerSubject,
		`{"enabled":true,"accountIds":["checking"],"startDate":"2026-01-01","endDate":"2026-12-31"}`), http.StatusOK)
	return seeded
}
