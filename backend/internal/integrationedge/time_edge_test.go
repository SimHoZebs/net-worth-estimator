package integrationedge

import (
	"net/http"
	"testing"
)

// Future-dated and timezone-edge postings against sharing intervals. The
// UTC day of the transaction time decides membership: a row one second
// before the interval start stays out, the midnight row is in, future
// rows past the end stay out, and leap-day rows behave like any other
// day. Interval queries are inclusive on both ends. Real SQLite policy, feed, and filter code behind the real router over real HTTP; the only stand-in is identity (no OIDC round trip).
func TestIntegrationEdgeTimeEdgeIntervals_RealSQLite_RealHTTP(t *testing.T) {
	world := advSetup(t)
	if world.groupID == "" {
		t.Skip("needs the group identity set")
	}
	rows := []struct {
		label  string
		amount string
		posted int64
		wantIn bool
	}{
		{"nye-minus1", "10.00", 1767225599, false}, // 2025-12-31T23:59:59Z
		{"midnight", "10.00", 1767225600, true},    // 2026-01-01T00:00:00Z
		{"plus1", "10.00", 1767225601, true},       // 2026-01-01T00:00:01Z
		{"future", "10.00", 1781524800, true},      // 2026-06-15, inside
		{"next-year", "10.00", 1798761600, false},  // 2027-01-01, past the end
	}
	ids := map[string]string{}
	for _, row := range rows {
		ids[row.label] = advMustPosting(t, world.ownerSC, "Time edge "+row.label, row.amount, row.posted)
	}
	policyTarget := "/v1/shared/policies/" + world.groupID
	advDecode(t, advServe(t, world.sharing.Routes(), http.MethodPut, policyTarget, world.ownerSubject,
		`{"enabled":true,"accountIds":["checking"],"startDate":"2026-01-01","endDate":"2026-12-31"}`), http.StatusOK)
	feedTarget := "/v1/shared/groups/" + world.groupID + "/feed"
	feed := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet, feedTarget, world.secondSubject, ""), http.StatusOK)
	seen := map[string]bool{}
	for _, raw := range feed["items"].([]any) {
		item, _ := raw.(map[string]any)
		posting, _ := item["posting"].(map[string]any)
		id, _ := posting["id"].(string)
		seen[id] = true
	}
	for _, row := range rows {
		id := ids[row.label]
		if seen[id] != row.wantIn {
			t.Fatalf("posting %q (time %d) listed = %v, want %v: interval edge mishandled",
				row.label, row.posted, seen[id], row.wantIn)
		}
	}
	totals, _ := feed["totals"].(map[string]any)
	if totals["count"] != float64(3) {
		t.Fatalf("totals = %+v, want count 3 over the in-interval set", totals)
	}
	// Feed date filters agree with the policy interval day for day.
	filtered := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet,
		feedTarget+"?startDate=2026-01-01&endDate=2026-01-01", world.secondSubject, ""), http.StatusOK)
	if len(filtered["items"].([]any)) != 2 {
		t.Fatalf("new-year-day filter items = %+v, want the two midnight rows", filtered)
	}
	// Leap-day rows behave like any other day under a covering interval.
	leapRow := advMustPosting(t, world.ownerSC, "Leap lunch", "29.00", 1709208000)
	advDecode(t, advServe(t, world.sharing.Routes(), http.MethodPut, policyTarget, world.ownerSubject,
		`{"enabled":true,"accountIds":["checking"],"startDate":"2024-02-29","endDate":"2024-02-29"}`), http.StatusOK)
	leap := advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet, feedTarget, world.secondSubject, ""), http.StatusOK)
	found := false
	for _, raw := range leap["items"].([]any) {
		item, _ := raw.(map[string]any)
		posting, _ := item["posting"].(map[string]any)
		if posting["id"] == leapRow {
			found = true
		}
	}
	if !found {
		t.Fatalf("leap-day row missing under its covering interval: %+v", leap)
	}
}
