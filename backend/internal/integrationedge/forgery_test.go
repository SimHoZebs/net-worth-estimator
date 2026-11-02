package integrationedge

import (
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Forged owner, posting, account, and group IDs on every cross-user route.
// Unknown and unauthorized reads must report absent (404), denied member
// actions must report forbidden (403), and nothing forged may leak row
// contents or write a row. Real SQLite store and real production routers over
// real HTTP; the only stand-in is identity (no OIDC round trip).
func TestIntegrationEdgeForgedIDs_RealSQLite_RealHTTP(t *testing.T) {
	world := advSetup(t)
	if world.groupID == "" {
		t.Skip("needs the group identity set")
	}
	day := int64(1781524800)
	forgeRow := advMustPosting(t, world.ownerSC, "Real row", "77.00", day)
	if _, err := world.db.GrantSharedPosting(world.owner, forgeRow, "group", world.groupID, advRequestID(t)); err != nil {
		t.Fatal(err)
	}
	forgedOwner := "user:" + strings.Repeat("0", 64)
	forgedPosting := "01900000-0000-7000-8000-0000000000ff"
	_ = forgedPosting
	forgedGroup := uuid.NewString()

	// Forged owner on the cross-user read path: absent, not forbidden,
	// so shared data is not enumerable.
	read := advServe(t, world.sharing.Routes(), http.MethodGet,
		"/v1/shared/postings/"+advResource(forgedOwner)+"/"+forgedPosting, world.secondSubject, "")
	if read.Code != http.StatusNotFound {
		t.Fatalf("forged-owner read status = %d, want 404: %s", read.Code, read.Body.String())
	}
	// Forged posting under the real owner: absent as well.
	readForgedPosting := advServe(t, world.sharing.Routes(), http.MethodGet,
		"/v1/shared/postings/"+advResource(world.owner)+"/"+forgedPosting, world.secondSubject, "")
	if readForgedPosting.Code != http.StatusNotFound {
		t.Fatalf("forged-posting read status = %d, want 404: %s", readForgedPosting.Code, readForgedPosting.Body.String())
	}
	// Forged owner on the copy path: no copy, nothing written.
	copy := advServe(t, world.sharing.Routes(), http.MethodPost, "/v1/shared/copies", world.secondSubject,
		`{"owner":`+advQuote(advResource(forgedOwner))+`,"postingId":`+advQuote(forgeRow)+`,"requestId":`+advQuote(advRequestID(t))+`}`)
	if copy.Code != http.StatusNotFound {
		t.Fatalf("forged-owner copy status = %d, want 404: %s", copy.Code, copy.Body.String())
	}
	// Forged group on the feed path: absent.
	feed := advServe(t, world.sharing.Routes(), http.MethodGet, "/v1/shared/groups/"+forgedGroup+"/feed", world.secondSubject, "")
	if feed.Code != http.StatusNotFound {
		t.Fatalf("forged-group feed status = %d, want 404: %s", feed.Code, feed.Body.String())
	}
	// The real group feed from a never-member: absent or empty, never rows.
	stranger := "adv-stranger-" + advRequestID(t)
	strangerFeed := advServe(t, world.sharing.Routes(), http.MethodGet, "/v1/shared/groups/"+world.groupID+"/feed", stranger, "")
	if strangerFeed.Code == http.StatusOK {
		decoded := advDecode(t, strangerFeed, http.StatusOK)
		if len(decoded["items"].([]any)) != 0 {
			t.Fatal("stranger listed group rows: leak")
		}
	} else if strangerFeed.Code != http.StatusNotFound {
		t.Fatalf("stranger feed status = %d, want 404 or empty 200: %s", strangerFeed.Code, strangerFeed.Body.String())
	}
	// Forged owner/posting on the inbox decision path: fail closed, no copy.
	accept := advServe(t, world.inbox.Routes(), http.MethodPost, "/v1/inbox/shares/accept", world.secondSubject,
		`{"owner":`+advQuote(advResource(forgedOwner))+`,"postingId":`+advQuote(forgedPosting)+`}`)
	if accept.Code != http.StatusNotFound && accept.Code != http.StatusConflict {
		t.Fatalf("forged inbox accept status = %d, want 404 or 409: %s", accept.Code, accept.Body.String())
	}
	// Granting for another owner's row: rejected, never recorded.
	foreign := advServe(t, world.sharing.Routes(), http.MethodPost, "/v1/shared/grants", world.secondSubject,
		`{"postingId":`+advQuote(forgeRow)+`,"audienceType":"group","audienceId":`+advQuote(world.groupID)+`,"requestId":`+advQuote(advRequestID(t))+`}`)
	if foreign.Code == http.StatusCreated {
		t.Fatal("member granted another owner's row: authorization bypass")
	}
	// Split reads by an outsider: denied or absent, never the obligation.
	outsider := world.guest
	if outsider == "" {
		outsider = forgedOwner
	}
	forgeSource := advMustPosting(t, world.ownerSC, "Split source", "100.00", day)
	if _, err := world.db.GrantSharedPosting(world.owner, forgeSource, "group", world.groupID, advRequestID(t)); err != nil {
		t.Fatal(err)
	}
	split, err := world.db.CreateSplit(world.owner, advSplitInput(world, forgeSource), advRequestID(t))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := world.db.GetSplit(outsider, split.ID); err == nil {
		t.Fatal("outsider read a split obligation: leak")
	}
	// Settlement recording is documented as opaque until split-membership
	// fencing lands: any provisioned user may record, but forged
	// (nonexistent) actors fail and the obligation itself stays unreadable.
	if world.guest != "" {
		if _, err := world.db.RecordSettlement(world.guest, settlementInput(split.ID, world.owner), advRequestID(t)); err != nil {
			t.Fatalf("provisioned outsider record rejected %v; contract says the split ID stays opaque until fencing", err)
		}
	}
	if _, err := world.db.RecordSettlement(forgedOwner, settlementInput(split.ID, world.owner), advRequestID(t)); err == nil {
		t.Fatal("nonexistent actor recorded a settlement: user-existence check bypassed")
	}
	// No forged attempt wrote anything: the recipient model stays empty.
	model, err := world.secondSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Postings) != 0 {
		t.Fatalf("recipient postings = %d after forged attempts, want none", len(model.Postings))
	}
}
