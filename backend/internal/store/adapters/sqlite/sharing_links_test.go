package sqlite

// Stable linked-transaction representation (FND-04): distinct source
// transaction ID, link ID, source revision, recipient owner, and
// sharing-grant identifiers; recipient edits surviving refresh and
// revocation; no duplicate bank postings from accepting shares.

import (
	"errors"
	"strings"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

const sharingBankPosting = "01900000-0000-7000-8000-0000000000b1"

func sharingLink(t *testing.T, d *Database, recipient, copyID string) store.SharingLink {
	t.Helper()
	link, err := d.GetSharingLink(recipient, copyID)
	if err != nil {
		t.Fatal(err)
	}
	return link
}

// The link binds every required identity, each distinct and stable: the
// source transaction (owner plus posting), the deterministic link ID, the
// source revision, the recipient owner (user plus copy), and the
// authorizing grant identifiers.
func TestSharingLinkIdentities(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	source := sharingPosting(t, storeA, sharingPostingA)

	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	copied, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	link := sharingLink(t, d, bob, copied.ID)

	wantLinkID := store.SharingLinkID(alice, sharingPostingA, bob)
	if link.LinkID != wantLinkID {
		t.Fatalf("link ID = %q, want deterministic %q", link.LinkID, wantLinkID)
	}
	if !strings.HasPrefix(link.LinkID, "link_") || len(link.LinkID) != len("link_")+64 {
		t.Fatalf("link ID shape = %q, want link_ plus 64 hex chars", link.LinkID)
	}
	if link.LinkID == source.ID || link.LinkID == copied.ID {
		t.Fatal("link ID collides with a row ID namespace")
	}
	if link.SourceOwnerID != alice || link.SourcePostingID != sharingPostingA {
		t.Fatalf("source identity = %q/%q, want %q/%q", link.SourceOwnerID, link.SourcePostingID, alice, sharingPostingA)
	}
	revision, err := store.SharingSourceRevision(source)
	if err != nil {
		t.Fatal(err)
	}
	if link.SourceRevision != revision || link.SourceRevision == "" {
		t.Fatalf("source revision = %q, want %q", link.SourceRevision, revision)
	}
	if link.RecipientUserID != bob || link.CopyPostingID != copied.ID {
		t.Fatalf("recipient identity = %q/%q, want %q/%q", link.RecipientUserID, link.CopyPostingID, bob, copied.ID)
	}
	if link.GrantAudience != store.SharingAudienceUser || link.GrantAudienceID != bob || link.GrantReason != "manual-user" {
		t.Fatalf("grant identity = %q/%q/%q, want user/%q/manual-user",
			link.GrantAudience, link.GrantAudienceID, link.GrantReason, bob)
	}
	if link.CopiedAt == 0 || link.RefreshedAt == 0 {
		t.Fatalf("link timestamps unset: %+v", link)
	}

	// Dependents holding link IDs (feeds, splits, audit) resolve the same
	// link without knowing the copy row ID.
	byID, err := d.GetSharingLinkByID(link.LinkID, bob)
	if err != nil {
		t.Fatal(err)
	}
	if byID != link {
		t.Fatalf("link by ID = %+v, want %+v", byID, link)
	}

	// Link memory is recipient-scoped and not enumerable: another
	// recipient, forged link IDs, and malformed IDs all fail closed.
	carol, _ := sharingUser(t, d, "carol")
	for name, tc := range map[string]struct {
		linkID, recipient string
		byID              bool
	}{
		"other recipient": {link.LinkID, carol, true},
		"forged link":     {"link_" + strings.Repeat("0", 64), bob, true},
		"malformed link":  {"not-a-link", bob, true},
	} {
		if _, err := d.GetSharingLinkByID(tc.linkID, tc.recipient); !errors.Is(err, store.ErrNotFound) {
			t.Fatalf("%s lookup = %v, want not-found", name, err)
		}
	}
	if _, err := d.GetSharingLink(carol, copied.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("cross-recipient copy lookup = %v, want not-found", err)
	}
	if _, err := d.GetSharingLink(bob, "not-a-uuid"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("malformed copy lookup = %v, want not-found", err)
	}
}

// Repeat accepts resolve to the same copy and the same link instead of
// minting duplicates: retry replays never manufacture extra rows.
func TestSharingCopyIdempotent(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, storeB := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)

	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	first, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	second, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Fatalf("repeat copy minted %q, want existing %q", second.ID, first.ID)
	}
	model, err := storeB.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Postings) != 1 {
		t.Fatalf("recipient postings = %d, want 1", len(model.Postings))
	}
	var provenance int
	if err := d.SQL().QueryRow(`SELECT COUNT(*) FROM sharing_copies WHERE recipient_user_id = ? AND source_owner_id = ? AND source_posting_id = ?`,
		bob, alice, sharingPostingA).Scan(&provenance); err != nil || provenance != 1 {
		t.Fatalf("link rows = %d, %v, want 1", provenance, err)
	}
	if link := sharingLink(t, d, bob, first.ID); link.LinkID != store.SharingLinkID(alice, sharingPostingA, bob) {
		t.Fatalf("link drifted across repeat accept: %q", link.LinkID)
	}
}

// Refresh never rewrites the recipient's copy: recipient edits survive an
// unchanged refresh, a source change only moves the recorded revision,
// and the copy keeps its own values throughout.
func TestSharingRefreshKeepsRecipientEdits(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, storeB := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)

	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	copied, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	edited, err := storeB.UpdatePosting(types.Posting{
		ID: copied.ID, Name: "Recipient budget", SourceAccountID: copied.SourceAccountID,
		Destinations: copied.Destinations,
		Amount:       types.PostingAmountResolution{Resolver: "expression", Config: map[string]any{"expression": "99"}, Inputs: map[string]types.AmountInputBinding{}},
		PostedTime:   copied.PostedTime, TransactionTime: copied.TransactionTime, Enabled: copied.Enabled,
	})
	if err != nil {
		t.Fatal(err)
	}

	refreshed, err := d.RefreshSharingLink(bob, copied.ID, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.Status != store.SharingLinkCurrent {
		t.Fatalf("refresh status = %q, want current", refreshed.Status)
	}
	model, err := storeB.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Postings) != 1 || model.Postings[0].Name != edited.Name {
		t.Fatalf("refresh rewrote the recipient copy: %+v", model.Postings)
	}

	// The source owner edits their original. Refresh reports the change
	// on the link while the recipient's edited copy stays untouched.
	source, err := d.ReadSharedPosting(alice, sharingPostingA, alice)
	if err != nil {
		t.Fatal(err)
	}
	source.Name = "Owner renamed"
	if _, err := storeA.UpdatePosting(source); err != nil {
		t.Fatal(err)
	}
	changed, err := d.RefreshSharingLink(bob, copied.ID, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if changed.Status != store.SharingLinkSourceChange {
		t.Fatalf("refresh status = %q, want source-changed", changed.Status)
	}
	if changed.CurrentSourceRevision == "" || changed.CurrentSourceRevision == refreshed.Link.SourceRevision {
		t.Fatalf("refresh did not advance the revision: %+v", changed)
	}
	model, err = storeB.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Postings) != 1 || model.Postings[0].Name != "Recipient budget" {
		t.Fatalf("source change overwrote the recipient copy: %+v", model.Postings)
	}
	if link := sharingLink(t, d, bob, copied.ID); link.SourceRevision != changed.CurrentSourceRevision {
		t.Fatalf("link revision = %q, want recorded %q", link.SourceRevision, changed.CurrentSourceRevision)
	}
	settled, err := d.RefreshSharingLink(bob, copied.ID, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if settled.Status != store.SharingLinkCurrent {
		t.Fatalf("second refresh status = %q, want current", settled.Status)
	}
}

// Revocation and re-grant keep the same link: the copy and its edits stay
// intact while unauthorized, and the link heals without a new identity.
func TestSharingRefreshAcrossRevocation(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, storeB := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)

	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	copied, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	before := sharingLink(t, d, bob, copied.ID)
	if _, err := storeB.UpdatePosting(types.Posting{
		ID: copied.ID, Name: "Recipient edited", SourceAccountID: copied.SourceAccountID,
		Destinations: copied.Destinations, Amount: copied.Amount,
		PostedTime: copied.PostedTime, TransactionTime: copied.TransactionTime, Enabled: copied.Enabled,
	}); err != nil {
		t.Fatal(err)
	}

	if err := d.RevokeSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	revoked, err := d.RefreshSharingLink(bob, copied.ID, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if revoked.Status != store.SharingLinkUnauthorized {
		t.Fatalf("refresh status = %q, want unauthorized", revoked.Status)
	}
	if revoked.CurrentSourceRevision != "" {
		t.Fatal("unauthorized refresh exposed the source revision")
	}
	if revoked.Link.LinkID != before.LinkID || revoked.Link.SourceRevision != before.SourceRevision {
		t.Fatalf("unauthorized refresh rewrote link identity: %+v", revoked.Link)
	}
	model, err := storeB.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Postings) != 1 || model.Postings[0].Name != "Recipient edited" {
		t.Fatalf("revocation touched the recipient copy: %+v", model.Postings)
	}

	// Re-grant heals the same link: no new identity, revision current.
	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	healed, err := d.RefreshSharingLink(bob, copied.ID, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if healed.Status != store.SharingLinkCurrent || healed.Link.LinkID != before.LinkID {
		t.Fatalf("re-grant did not heal the same link: %+v", healed)
	}
}

// Accepting a settled bank posting mints an owner-authored copy with no
// bank sync key: the share never manufactures a duplicate bank posting,
// and repeat accepts add no rows on either side.
func TestSharingCopyOfBankPostingMintsNoDuplicate(t *testing.T) {
	d := openSharingTestDB(t)
	alice, _ := sharingUser(t, d, "alice")
	bob, storeB := sharingUser(t, d, "bob")

	const amountJSON = `{"resolver":"expression","config":{"expression":"50"},"inputs":{}}`
	for _, stmt := range []string{
		`INSERT INTO postings (id, name, source_account_id, destination_account_ids, amount_resolution_json, posted_time, transaction_time, source, pending, void, user_id)
		 VALUES ('` + sharingBankPosting + `', 'Bank charge', 'checking', 'null', '` + amountJSON + `', 1782950400, 1782950400, 'simplefin', 0, 0, '` + alice + `')`,
		`INSERT INTO posting_sim (posting_id, position, enabled, execution_order, user_id) VALUES ('` + sharingBankPosting + `', 1, 1, 1, '` + alice + `')`,
		`INSERT INTO entity_ids (id, kind, user_id) VALUES ('` + sharingBankPosting + `', 'posting', '` + alice + `')`,
		`INSERT INTO posting_sync_keys (provider, bridge_account_id, transaction_id, posting_id, user_id) VALUES ('simplefin', 'bridge-prime', 'tx-bank-1', '` + sharingBankPosting + `', '` + alice + `')`,
	} {
		if _, err := d.SQL().Exec(stmt); err != nil {
			t.Fatalf("seed bank posting: %v", err)
		}
	}

	if _, err := d.GrantSharedPosting(alice, sharingBankPosting, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	copied, err := d.CopySharedPosting(alice, sharingBankPosting, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if copied.Source != SourceUser || copied.Pending || copied.Void {
		t.Fatalf("copy kept bank lifecycle: %+v", copied)
	}
	var keys int
	if err := d.SQL().QueryRow(`SELECT COUNT(*) FROM posting_sync_keys WHERE posting_id = ?`, copied.ID).Scan(&keys); err != nil || keys != 0 {
		t.Fatalf("copy sync keys = %d, %v, want 0", keys, err)
	}
	if again, err := d.CopySharedPosting(alice, sharingBankPosting, bob, sharingKey(t)); err != nil || again.ID != copied.ID {
		t.Fatalf("repeat bank accept = %q, %v, want existing %q", again.ID, err, copied.ID)
	}
	for name, tc := range map[string]struct {
		userID string
		want   int
	}{
		"source keeps one bank row": {alice, 1},
		"recipient keeps one copy":  {bob, 1},
	} {
		var postings int
		if err := d.SQL().QueryRow(`SELECT COUNT(*) FROM postings WHERE user_id = ?`, tc.userID).Scan(&postings); err != nil || postings != tc.want {
			t.Fatalf("%s: postings = %d, %v, want %d", name, postings, err, tc.want)
		}
	}
	model, err := storeB.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if model.Postings[0].Source != SourceUser {
		t.Fatalf("stored copy source = %q, want owner-authored", model.Postings[0].Source)
	}
}

// A group-audience grant records the concrete group as the authorizing
// grant identifier on the link.
func TestSharingLinkGroupGrantAudience(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, _ := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)
	groupID := sharingGroup(t, d, "alice", "roommates", "bob")

	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceGroup, groupID, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	copied, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	link := sharingLink(t, d, bob, copied.ID)
	if link.GrantAudience != store.SharingAudienceGroup || link.GrantAudienceID != groupID || link.GrantReason != "manual-group" {
		t.Fatalf("grant identity = %q/%q/%q, want group/%q/manual-group",
			link.GrantAudience, link.GrantAudienceID, link.GrantReason, groupID)
	}
}

// Deleting the source posting keeps the recipient's copy as an ordinary
// row while its link memory goes with the source consent: refresh then
// fails closed instead of addressing a withdrawn transaction.
func TestSharingRefreshAfterSourceDelete(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, storeB := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)

	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	copied, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := storeA.DeletePosting(sharingPostingA); err != nil {
		t.Fatal(err)
	}
	model, err := storeB.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Postings) != 1 || model.Postings[0].ID != copied.ID {
		t.Fatalf("source delete touched the recipient copy: %+v", model.Postings)
	}
	if _, err := d.GetSharingLink(bob, copied.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleted-source link lookup = %v, want not-found", err)
	}
	if _, err := d.RefreshSharingLink(bob, copied.ID, sharingKey(t)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleted-source refresh = %v, want not-found", err)
	}
}

// A link that outlives its source outside DeletePosting (which always
// drops links with consent) refreshes as source-gone: the copy stays
// intact, the link keeps its last recorded revision, and the status stays
// put on repeat refreshes.
func TestSharingRefreshSourceGoneOutOfBand(t *testing.T) {
	d := openSharingTestDB(t)
	alice, storeA := sharingUser(t, d, "alice")
	bob, storeB := sharingUser(t, d, "bob")
	sharingPosting(t, storeA, sharingPostingA)

	if _, err := d.GrantSharedPosting(alice, sharingPostingA, store.SharingAudienceUser, bob, sharingKey(t)); err != nil {
		t.Fatal(err)
	}
	copied, err := d.CopySharedPosting(alice, sharingPostingA, bob, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	before := sharingLink(t, d, bob, copied.ID)
	if _, err := d.SQL().Exec(`DELETE FROM postings WHERE user_id = ? AND id = ?`, alice, sharingPostingA); err != nil {
		t.Fatal(err)
	}
	gone, err := d.RefreshSharingLink(bob, copied.ID, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if gone.Status != store.SharingLinkSourceGone {
		t.Fatalf("refresh status = %q, want source-gone", gone.Status)
	}
	if gone.CurrentSourceRevision != "" {
		t.Fatal("source-gone refresh exposed a revision for a missing source")
	}
	if gone.Link.LinkID != before.LinkID || gone.Link.SourceRevision != before.SourceRevision {
		t.Fatalf("source-gone refresh rewrote the link: %+v", gone.Link)
	}
	model, err := storeB.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(model.Postings) != 1 || model.Postings[0].ID != copied.ID {
		t.Fatalf("source loss touched the recipient copy: %+v", model.Postings)
	}
	again, err := d.RefreshSharingLink(bob, copied.ID, sharingKey(t))
	if err != nil {
		t.Fatal(err)
	}
	if again.Status != store.SharingLinkSourceGone || again.Link.LinkID != before.LinkID {
		t.Fatalf("repeat source-gone refresh moved: %+v", again)
	}
}
