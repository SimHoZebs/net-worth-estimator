// Package integrationedge is the integration edge-case suite: hostile cases
// across sharing, splits, settlements, invites, and feeds instead of
// walking the typical path.
//
// Every test crosses at least one real boundary on a throwaway SQLite
// database: the real store, and for handler tests the real production
// routers (sharing, groups, inbox) over real HTTP through httptest. The
// only stand-in is identity itself: tests inject the verified principal
// through the same principal-in-context seam the production middleware
// provides, with no provider round trip. Each test name states the real
// boundary crossed. This suite is integration-tier, one below the
// disposable provider-backed e2e gate: no Docker, no credentials, seconds
// per run. Real Casdoor login, real bank sync, and receipt OCR stay out of
// scope and are listed as uncovered in the companion integration-gates
// document, never faked green.
//
// Storm suites loop their attacks several times inside the test and are
// built for repeated full runs (go test -count=N -race): a green run means
// hostile and stable, not lucky.
package integrationedge

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/groups"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	authcontract "github.com/simhozebs/net-worth-estimator/backend/internal/identity/contracts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/inbox"
	"github.com/simhozebs/net-worth-estimator/backend/internal/integrationfixtures"
	"github.com/simhozebs/net-worth-estimator/backend/internal/sharing"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const advIssuer = "https://issuer.test"

// Identity sets select which synthetic users exist. The runner passes
// INTEGRATION_IDENTITY_SET; tests default to the full set. Subjects embed
// a per-test unique suffix, so runs never reuse identities in ways that
// leak state across databases.
const (
	advSetSolo = "solo" // owner only
	advSetDuo  = "duo"  // owner plus a second user
	advSetFull = "full" // owner, second user, provisioned guest, removed ex-member
)

func advIdentitySet() string {
	switch set := strings.TrimSpace(os.Getenv("INTEGRATION_IDENTITY_SET")); set {
	case advSetSolo, advSetDuo:
		return set
	default:
		return advSetFull
	}
}

func advPack() string {
	return strings.TrimSpace(os.Getenv("INTEGRATION_PACK"))
}

// advBulkSpec parses the optional additive bulk spec the matrix runner
// passes. Empty means the pack or default seed runs alone.
func advBulkSpec(t *testing.T) integrationfixtures.BulkSpec {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv("INTEGRATION_BULK"))
	if raw == "" {
		return integrationfixtures.BulkSpec{}
	}
	spec, err := integrationfixtures.ParseBulkSpec(raw)
	if err != nil {
		t.Fatalf("integration bulk %q: %v", raw, err)
	}
	return spec
}

// advWorld is one throwaway backend with synthetic users.
type advWorld struct {
	db      *sqlite.Database
	groups  *groups.Handler
	sharing *sharing.Handler
	inbox   *inbox.Handler

	ownerSubject   string
	secondSubject  string
	guestSubject   string
	removedSubject string

	owner   string
	second  string
	guest   string
	removed string

	ownerSC  store.Store
	secondSC store.Store
	guestSC  store.Store

	groupID string
}

func advRequestID(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	return id.String()
}

func advResource(user string) string {
	return "users/" + strings.TrimPrefix(user, "user:")
}

func advServe(t *testing.T, handler http.Handler, method, target, subject, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if subject != "" {
		request = request.WithContext(identity.PrincipalContext(request.Context(),
			authcontract.Principal{Subject: subject, Name: subject, Authenticated: true}))
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func advDecode(t *testing.T, response *httptest.ResponseRecorder, want int) map[string]any {
	t.Helper()
	if response.Code != want {
		t.Fatalf("status = %d, want %d: %s", response.Code, want, response.Body.String())
	}
	var decoded map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return decoded
}

func advQuote(value string) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

func advMustPosting(t *testing.T, scoped store.Store, name, amount string, day int64) string {
	t.Helper()
	source := "checking"
	created, err := scoped.CreatePosting(types.Posting{
		Name: name, SourceAccountID: &source,
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      day,
		TransactionTime: day,
		Enabled:         true,
	})
	if err != nil {
		t.Fatalf("create posting %q: %v", name, err)
	}
	return created.ID
}

// advMustPostingID creates one posting under a caller-chosen valid ID
// (fixture packs carry deterministic UUIDs) and fails the test otherwise.
func advMustPostingID(t *testing.T, scoped store.Store, id, name, amount string, day int64) {
	t.Helper()
	source := "checking"
	if _, err := scoped.CreatePosting(types.Posting{
		ID: id, Name: name, SourceAccountID: &source,
		Amount:          types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": amount}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:      day,
		TransactionTime: day,
		Enabled:         true,
	}); err != nil {
		t.Fatalf("create posting %s: %v", id, err)
	}
}

// advSetup builds the world: synthetic users per the selected identity set,
// the owner seeded from INTEGRATION_PACK when set, a group with the member
// and guest joined, and the removed user joined then removed.
func advSetup(t *testing.T) *advWorld {
	t.Helper()
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "integration-edge.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	world := &advWorld{
		db:      db,
		groups:  groups.New(db, advIssuer, groups.Config{}),
		sharing: sharing.New(db, advIssuer, sharing.Config{}),
		inbox:   inbox.New(db, advIssuer, inbox.Config{}),
	}
	tag, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	suffix := tag.String()
	world.ownerSubject = "adv-owner-" + suffix
	world.secondSubject = "adv-second-" + suffix
	world.guestSubject = "adv-guest-" + suffix
	world.removedSubject = "adv-removed-" + suffix

	subjects := []string{world.ownerSubject}
	switch advIdentitySet() {
	case advSetDuo:
		subjects = append(subjects, world.secondSubject)
	case advSetFull:
		subjects = append(subjects, world.secondSubject, world.guestSubject, world.removedSubject)
	}
	ids := map[string]string{}
	scoped := map[string]store.Store{}
	for _, subject := range subjects {
		user, err := db.EnsureGroupUser(advIssuer, subject)
		if err != nil {
			t.Fatal(err)
		}
		unit, err := db.EnsureUser(user, advIssuer, subject)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := unit.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
			t.Fatal(err)
		}
		ids[subject] = user
		scoped[subject] = unit
	}
	world.owner, world.ownerSC = ids[world.ownerSubject], scoped[world.ownerSubject]
	world.second, world.secondSC = ids[world.secondSubject], scoped[world.secondSubject]
	world.guest, world.guestSC = ids[world.guestSubject], scoped[world.guestSubject]
	world.removed = ids[world.removedSubject]

	if pack := advPack(); pack != "" {
		model, err := integrationfixtures.Model(pack)
		if err != nil {
			t.Fatalf("integration fixture pack %q: %v", pack, err)
		}
		if _, err := world.ownerSC.ImportModel(model); err != nil {
			t.Fatalf("seed pack %q: %v", pack, err)
		}
		seeded, err := world.ownerSC.LoadModel()
		if err != nil {
			t.Fatalf("read seeded pack %q: %v", pack, err)
		}
		hasChecking := false
		for _, account := range seeded.Accounts {
			if account.ID == "checking" {
				hasChecking = true
			}
		}
		if !hasChecking {
			if _, err := world.ownerSC.CreateAccount(types.Account{ID: "checking", Name: "Checking", Kind: types.AccountKindCash, Enabled: true}); err != nil {
				t.Fatalf("ensure checking for pack %q: %v", pack, err)
			}
		}
	}
	if bulk := advBulkSpec(t); bulk.Accounts > 0 {
		if _, err := integrationfixtures.InjectBulk(world.ownerSC, bulk); err != nil {
			t.Fatalf("seed bulk: %v", err)
		}
	}

	if advIdentitySet() == advSetSolo {
		return world
	}
	created := advDecode(t, advServe(t, world.groups.Routes(), http.MethodPost, "/v1/groups", world.ownerSubject, `{"name":"Household"}`), http.StatusCreated)
	group, _ := created["group"].(map[string]any)
	world.groupID, _ = group["id"].(string)
	if world.groupID == "" {
		t.Fatalf("group = %+v, want an ID", created)
	}
	join := func(subject string) {
		invite := advDecode(t, advServe(t, world.groups.Routes(), http.MethodPost, "/v1/groups/"+world.groupID+"/invites", world.ownerSubject, `{"maxUses":5}`), http.StatusCreated)
		code, _ := invite["code"].(string)
		if code == "" {
			t.Fatalf("invite = %+v, want a code", invite)
		}
		advDecode(t, advServe(t, world.groups.Routes(), http.MethodPost, "/v1/invites/accept", subject, `{"code":`+advQuote(code)+`}`), http.StatusOK)
	}
	join(world.secondSubject)
	if advIdentitySet() == advSetFull {
		join(world.guestSubject)
		join(world.removedSubject)
		if err := db.LeaveGroup(world.groupID, world.removed); err != nil {
			t.Fatalf("remove ex-member: %v", err)
		}
	}
	return world
}

// advFeedList returns the full decoded group feed for one subject.
func advFeedList(t *testing.T, world *advWorld, subject string) map[string]any {
	t.Helper()
	return advDecode(t, advServe(t, world.sharing.Routes(), http.MethodGet, "/v1/shared/groups/"+world.groupID+"/feed", subject, ""), http.StatusOK)
}

// advFeedIDs returns the posting IDs in the full feed.
func advFeedIDs(t *testing.T, world *advWorld, subject string) map[string]bool {
	t.Helper()
	ids := map[string]bool{}
	for _, raw := range advFeedList(t, world, subject)["items"].([]any) {
		item, _ := raw.(map[string]any)
		posting, _ := item["posting"].(map[string]any)
		id, _ := posting["id"].(string)
		ids[id] = true
	}
	return ids
}

// advFeedTotalsAgreement asserts the totals in one feed response describe
// exactly its listed set, whatever background the fixture pack seeded.
func advFeedTotalsAgreement(t *testing.T, decoded map[string]any) {
	t.Helper()
	totals, _ := decoded["totals"].(map[string]any)
	items, _ := decoded["items"].([]any)
	if totals["count"] != float64(len(items)) {
		t.Fatalf("feed totals = %+v over %d listed items: totals disagree with the listed set", totals, len(items))
	}
}

// advEnsurePostingID creates one row under a caller-chosen valid ID unless
// the fixture pack already seeded it, and fails the test otherwise.
func advEnsurePostingID(t *testing.T, scoped store.Store, id, name, amount string, day int64) {
	t.Helper()
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	for _, posting := range model.Postings {
		if posting.ID == id {
			return
		}
	}
	advMustPostingID(t, scoped, id, name, amount, day)
}

// advStorm runs workers concurrently and collects each result.
func advStorm(workers int, attack func(i int) any) []any {
	results := make([]any, workers)
	var group sync.WaitGroup
	for i := range results {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			results[i] = attack(i)
		}(i)
	}
	group.Wait()
	return results
}
