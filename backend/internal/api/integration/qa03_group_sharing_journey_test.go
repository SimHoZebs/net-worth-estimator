package integration

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/simhozebs/net-worth-estimator/backend/internal/groups"
	"github.com/simhozebs/net-worth-estimator/backend/internal/identity"
	authcontract "github.com/simhozebs/net-worth-estimator/backend/internal/identity/contracts"
	"github.com/simhozebs/net-worth-estimator/backend/internal/inbox"
	"github.com/simhozebs/net-worth-estimator/backend/internal/sharing"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store/adapters/sqlite"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// QA-03 journey 3: group sharing between two real users in one database.
//
// The owner and the recipient live in the same physical SQLite file with
// identical posting IDs, so row-level isolation is proven rather than
// assumed. Owner sets policy, recipient reads the feed with viewer totals,
// saves a copy, owner revokes, recipient is denied while the copy survives.
// A direct-share inbox leg (accept, decline, dismiss) rides the same two
// users. Every hop runs over production HTTP handlers with the same
// principal-in-context seam the browser harness uses; the only stand-in is
// identity itself (no OIDC round trip — real Google/Casdoor login is out of
// scope and covered up to the consent start elsewhere).

const qa03Issuer = "https://issuer.test"

const (
	qa03SharedGroceries = "01900000-0000-7000-8000-0000000000e1"
	qa03SharedFuel      = "01900000-0000-7000-8000-0000000000e2"
	qa03DirectGift      = "01900000-0000-7000-8000-0000000000e3"
	qa03DirectDeclined  = "01900000-0000-7000-8000-0000000000e4"
)

type qa03Social struct {
	db       store.Database
	groups   *groups.Handler
	sharing  *sharing.Handler
	inbox    *inbox.Handler
	owner    string
	ownerSC  store.Store
	member   string
	memberSC store.Store
}

func qa03RequestID(t *testing.T) string {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatal(err)
	}
	return id.String()
}

func qa03Principal(request *http.Request, subject string) *http.Request {
	return request.WithContext(identity.PrincipalContext(request.Context(),
		authcontract.Principal{Subject: subject, Name: subject}))
}

func qa03Serve(t *testing.T, handler http.Handler, method, target, subject, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if subject != "" {
		request = qa03Principal(request, subject)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func qa03Decode(t *testing.T, response *httptest.ResponseRecorder, want int) map[string]any {
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

func qa03Resource(user string) string {
	return "users/" + strings.TrimPrefix(user, "user:")
}

func qa03SocialSetup(t *testing.T) *qa03Social {
	t.Helper()
	db, err := sqlite.SetupDatabase(filepath.Join(t.TempDir(), "qa03-sharing.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	social := &qa03Social{
		db:      db,
		groups:  groups.New(db, qa03Issuer, groups.Config{}),
		sharing: sharing.New(db, qa03Issuer, sharing.Config{}),
		inbox:   inbox.New(db, qa03Issuer, inbox.Config{}),
	}
	for _, subject := range []string{"qa03-owner", "qa03-member"} {
		user, err := db.EnsureGroupUser(qa03Issuer, subject)
		if err != nil {
			t.Fatal(err)
		}
		scoped, err := db.EnsureUser(user, qa03Issuer, subject)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := scoped.CreateAccount(types.Account{ID: "checking", Name: "Checking", Enabled: true}); err != nil {
			t.Fatal(err)
		}
		if subject == "qa03-owner" {
			social.owner, social.ownerSC = user, scoped
		} else {
			social.member, social.memberSC = user, scoped
		}
	}
	return social
}

func qa03MustPosting(t *testing.T, scoped store.Store, id, name, amount string, day int64) {
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

func qa03Feed(t *testing.T, social *qa03Social, subject, target string) map[string]any {
	t.Helper()
	return qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodGet, target, subject, ""), http.StatusOK)
}

func TestQA03GroupSharingPolicyFeedCopyRevokeJourney(t *testing.T) {
	social := qa03SocialSetup(t)
	day := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC).Unix()

	// Both users hold a posting with the identical ID in the same file:
	// reads must stay row-scoped to the caller.
	qa03MustPosting(t, social.ownerSC, qa03SharedGroceries, "Groceries", "42.50", day)
	qa03MustPosting(t, social.ownerSC, qa03SharedFuel, "Fuel", "30.00", day)
	qa03MustPosting(t, social.memberSC, qa03SharedGroceries, "Member private row", "1.00", day)

	// Owner creates the group and the member joins through an invite code.
	created := qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups", "qa03-owner", `{"name":"Household"}`), http.StatusCreated)
	group, _ := created["group"].(map[string]any)
	groupID, _ := group["id"].(string)
	if groupID == "" {
		t.Fatalf("group = %+v, want an ID", created)
	}
	invite := qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/groups/"+groupID+"/invites", "qa03-owner", `{"maxUses":5}`), http.StatusCreated)
	code, _ := invite["code"].(string)
	if code == "" {
		t.Fatalf("invite = %+v, want a code", invite)
	}
	qa03Decode(t, qa03Serve(t, social.groups.Routes(), http.MethodPost, "/v1/invites/accept", "qa03-member", `{"code":`+qa03Quote(code)+`}`), http.StatusOK)

	// Owner sets the sharing policy: the consent surface the UI drives.
	policy := qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodPut, "/v1/shared/policies/"+groupID, "qa03-owner",
		`{"enabled":true,"accountIds":["checking"],"startDate":"2026-01-01","endDate":"2026-12-31"}`), http.StatusOK)
	if policy["policy"] == nil {
		t.Fatalf("policy = %+v", policy)
	}

	// Recipient sees the feed with viewer totals over exactly the listed set.
	feedTarget := "/v1/shared/groups/" + groupID + "/feed"
	feed := qa03Feed(t, social, "qa03-member", feedTarget)
	items, _ := feed["items"].([]any)
	totals, _ := feed["totals"].(map[string]any)
	if len(items) != 2 {
		t.Fatalf("feed items = %d, want the 2 policy-shared rows (never the member's own private row)", len(items))
	}
	if totals["count"] != float64(2) {
		t.Fatalf("feed totals = %+v, want count 2 over the listed set", totals)
	}
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		posting, _ := item["posting"].(map[string]any)
		if posting["id"] == qa03SharedGroceries {
			if posting["name"] == "Member private row" {
				t.Fatal("feed leaked the member's own same-ID private row")
			}
		}
		if item["sourceDisplayName"] == "" || item["audiences"] == nil {
			t.Fatalf("feed item = %+v, want named source with audiences", item)
		}
	}

	// Policy visibility is read-level: saving a copy requires an explicit
	// grant naming the group. The owner grants the first row, then the
	// recipient saves an independent copy into their own model.
	qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodPost, "/v1/shared/grants", "qa03-owner",
		`{"postingId":`+qa03Quote(qa03SharedGroceries)+`,"audienceType":"group","audienceId":`+qa03Quote(groupID)+`,"requestId":`+qa03Quote(qa03RequestID(t))+`}`), http.StatusCreated)
	copied := qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodPost, "/v1/shared/copies", "qa03-member",
		`{"owner":`+qa03Quote(qa03Resource(social.owner))+`,"postingId":`+qa03Quote(qa03SharedGroceries)+`,"requestId":`+qa03Quote(qa03RequestID(t))+`}`), http.StatusCreated)
	saved, _ := copied["posting"].(map[string]any)
	copyID, _ := saved["id"].(string)
	if copyID == "" || copyID == qa03SharedGroceries {
		t.Fatalf("copy = %+v, want a new recipient-owned row", copied)
	}

	// Owner excludes the second row: the feed and its totals narrow together.
	qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodPost, "/v1/shared/exclusions", "qa03-owner",
		`{"postingId":`+qa03Quote(qa03SharedFuel)+`,"audienceType":"group","audienceId":`+qa03Quote(groupID)+`,"requestId":`+qa03Quote(qa03RequestID(t))+`}`), http.StatusCreated)
	narrowed := qa03Feed(t, social, "qa03-member", feedTarget)
	if narrowed["totals"].(map[string]any)["count"] != float64(1) {
		t.Fatalf("narrowed totals = %+v, want count 1 after exclusion", narrowed["totals"])
	}

	// Owner revokes the grant and switches the policy off: the policy alone
	// would still authorize reads, so denial needs both. The recipient's
	// read is denied without existence leakage while the saved copy
	// survives as an editable private row.
	qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodDelete, "/v1/shared/grants", "qa03-owner",
		`{"postingId":`+qa03Quote(qa03SharedGroceries)+`,"audienceType":"group","audienceId":`+qa03Quote(groupID)+`,"requestId":`+qa03Quote(qa03RequestID(t))+`}`), http.StatusOK)
	qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodPut, "/v1/shared/policies/"+groupID, "qa03-owner",
		`{"enabled":false,"accountIds":["checking"],"startDate":"2026-01-01","endDate":"2026-12-31"}`), http.StatusOK)
	denied := qa03Serve(t, social.sharing.Routes(), http.MethodGet, "/v1/shared/postings/"+qa03Resource(social.owner)+"/"+qa03SharedGroceries, "qa03-member", "")
	if denied.Code != http.StatusNotFound {
		t.Fatalf("revoked read = %d, want 404 without existence leakage", denied.Code)
	}
	memberModel, err := social.memberSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	survives := false
	for _, posting := range memberModel.Postings {
		if posting.ID == copyID {
			survives = true
			posting.Name = "Renamed after revocation"
			if _, err := social.memberSC.UpdatePosting(posting); err != nil {
				t.Fatalf("copy not editable after revocation: %v", err)
			}
		}
	}
	if !survives {
		t.Fatalf("recipient model = %+v, want the saved copy to survive revocation", memberModel.Postings)
	}
	// The recipient's pre-existing same-ID private row is untouched.
	for _, posting := range memberModel.Postings {
		if posting.ID == qa03SharedGroceries && posting.Name != "Member private row" {
			t.Fatalf("member private row = %+v, want it untouched by the copy", posting)
		}
	}
	ownerModel, err := social.ownerSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(ownerModel.Postings) != 2 {
		t.Fatalf("owner postings = %d, want the journey to create no duplicate expenses", len(ownerModel.Postings))
	}
}

func TestQA03DirectShareInboxAcceptDeclineDismissJourney(t *testing.T) {
	social := qa03SocialSetup(t)
	day := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC).Unix()
	qa03MustPosting(t, social.ownerSC, qa03DirectGift, "Gift", "25.00", day)
	qa03MustPosting(t, social.ownerSC, qa03DirectDeclined, "Declined gift", "10.00", day)

	grant := func(postingID string) {
		t.Helper()
		qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodPost, "/v1/shared/grants", "qa03-owner",
			`{"postingId":`+qa03Quote(postingID)+`,"audienceType":"user","audienceId":`+qa03Quote(social.member)+`,"requestId":`+qa03Quote(qa03RequestID(t))+`}`), http.StatusCreated)
	}
	grant(qa03DirectGift)
	grant(qa03DirectDeclined)

	shareRef := func(postingID string) string {
		return `{"owner":` + qa03Quote(qa03Resource(social.owner)) + `,"postingId":` + qa03Quote(postingID) + `}`
	}

	// Both shares arrive pending.
	pending := qa03Decode(t, qa03Serve(t, social.inbox.Routes(), http.MethodGet, "/v1/inbox", "qa03-member", ""), http.StatusOK)
	if items, _ := pending["items"].([]any); len(items) != 2 {
		t.Fatalf("inbox items = %+v, want 2 pending", pending)
	}

	// Dismissing hides without deciding; unhiding restores to pending.
	dismissed := qa03Decode(t, qa03Serve(t, social.inbox.Routes(), http.MethodPost, "/v1/inbox/shares/dismiss", "qa03-member", shareRef(qa03DirectGift)), http.StatusOK)
	if dismissed["item"].(map[string]any)["dismissed"] != true {
		t.Fatalf("dismiss = %+v", dismissed)
	}
	hidden := qa03Decode(t, qa03Serve(t, social.inbox.Routes(), http.MethodGet, "/v1/inbox", "qa03-member", ""), http.StatusOK)
	if items, _ := hidden["items"].([]any); len(items) != 1 {
		t.Fatalf("dismissed still listed: %+v", hidden)
	}
	qa03Decode(t, qa03Serve(t, social.inbox.Routes(), http.MethodPost, "/v1/inbox/shares/dismiss", "qa03-member",
		`{"owner":`+qa03Quote(qa03Resource(social.owner))+`,"postingId":`+qa03Quote(qa03DirectGift)+`,"dismissed":false}`), http.StatusOK)
	restored := qa03Decode(t, qa03Serve(t, social.inbox.Routes(), http.MethodGet, "/v1/inbox", "qa03-member", ""), http.StatusOK)
	if items, _ := restored["items"].([]any); len(items) != 2 {
		t.Fatalf("unhidden = %+v, want both shares pending again", restored)
	}

	// Accepting saves an independent copy; retrying returns the same copy.
	accepted := qa03Decode(t, qa03Serve(t, social.inbox.Routes(), http.MethodPost, "/v1/inbox/shares/accept", "qa03-member", shareRef(qa03DirectGift)), http.StatusOK)
	acceptedItem, _ := accepted["item"].(map[string]any)
	firstCopy, _ := acceptedItem["copyPostingId"].(string)
	if firstCopy == "" {
		t.Fatalf("accept = %+v, want a saved copy", accepted)
	}
	retried := qa03Decode(t, qa03Serve(t, social.inbox.Routes(), http.MethodPost, "/v1/inbox/shares/accept", "qa03-member", shareRef(qa03DirectGift)), http.StatusOK)
	if retried["item"].(map[string]any)["copyPostingId"] != firstCopy {
		t.Fatalf("accept retry = %+v, want the same copy without duplicates", retried)
	}

	// Declining removes the grant without saving anything.
	declined := qa03Decode(t, qa03Serve(t, social.inbox.Routes(), http.MethodPost, "/v1/inbox/shares/decline", "qa03-member", shareRef(qa03DirectDeclined)), http.StatusOK)
	if declined["item"].(map[string]any)["status"] != "declined" {
		t.Fatalf("decline = %+v, want declined", declined)
	}
	grants, err := social.db.ListSharingGrants(social.owner)
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range grants {
		if g.PostingID == qa03DirectDeclined {
			t.Fatalf("grants = %+v, want the declined share gone", grants)
		}
	}
	memberModel, err := social.memberSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(memberModel.Postings) != 1 || memberModel.Postings[0].ID != firstCopy {
		t.Fatalf("member postings = %+v, want only the accepted copy", memberModel.Postings)
	}
}

func qa03Quote(s string) string {
	raw, _ := json.Marshal(s)
	return string(raw)
}
