package sharing_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/simhozebs/net-worth-estimator/backend/internal/sharing"
	"github.com/simhozebs/net-worth-estimator/backend/internal/store"
	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// grantAndAccept shares alice's transaction with bob and accepts it, returning
// the recipient-owned copy.
func grantAndAccept(t *testing.T, h *sharing.Handler, db store.Database, alice, bob string) types.Transaction {
	t.Helper()
	if w := do(t, h, "POST", "/v1/shared/grants", "alice", grantBody(t, sharedTransactionID, "user", bob)); w.Code != http.StatusCreated {
		t.Fatalf("grant = %d, want 201", w.Code)
	}
	w := do(t, h, "POST", "/v1/shared/copies", "bob", copyBody(t, resourceOf(alice), sharedTransactionID))
	if w.Code != http.StatusCreated {
		t.Fatalf("copy = %d (%s), want 201", w.Code, w.Body.String())
	}
	var copied struct {
		Transaction types.Transaction `json:"transaction"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &copied); err != nil {
		t.Fatal(err)
	}
	return copied.Transaction
}

func renameTransaction(t *testing.T, scoped store.Store, transaction types.Transaction, name string) {
	t.Helper()
	transaction.Name = name
	if _, err := scoped.UpdateTransaction(transaction); err != nil {
		t.Fatalf("rename to %q: %v", name, err)
	}
}

func loadTransaction(t *testing.T, scoped store.Store, id string) types.Transaction {
	t.Helper()
	model, err := scoped.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	for _, transaction := range model.Transactions {
		if transaction.ID == id {
			return transaction
		}
	}
	t.Fatalf("transaction %s not found in own model", id)
	return types.Transaction{}
}

// The link read returns the recipient's own provenance: the deterministic
// link ID, the source and recipient identities, the observed revision,
// and the authorizing grant.
func TestSharingHTTPLinkRead(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustUser(t, db, "bob")
	mustTransaction(t, storeA, sharedTransactionID)
	copied := grantAndAccept(t, h, db, alice, bob)

	w := do(t, h, "GET", "/v1/shared/copies/"+copied.ID+"/link", "bob", "")
	if w.Code != http.StatusOK {
		t.Fatalf("link = %d (%s), want 200", w.Code, w.Body.String())
	}
	var got struct {
		Link store.SharingLink `json:"link"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if want := store.SharingLinkID(alice, sharedTransactionID, bob); got.Link.LinkID != want {
		t.Fatalf("link ID = %q, want deterministic %q", got.Link.LinkID, want)
	}
	if got.Link.SourceOwnerID != alice || got.Link.SourceTransactionID != sharedTransactionID {
		t.Fatalf("link source = %v, want alice/%s", got.Link, sharedTransactionID)
	}
	if got.Link.RecipientUserID != bob || got.Link.CopyTransactionID != copied.ID {
		t.Fatalf("link recipient = %v, want bob/%s", got.Link, copied.ID)
	}
	source := loadTransaction(t, storeA, sharedTransactionID)
	revision, err := store.SharingSourceRevision(source)
	if err != nil {
		t.Fatal(err)
	}
	if got.Link.SourceRevision != revision {
		t.Fatalf("link revision = %q, want %q", got.Link.SourceRevision, revision)
	}
	if got.Link.GrantAudience != store.SharingAudienceUser || got.Link.GrantAudienceID != bob || got.Link.GrantReason != "manual-user" {
		t.Fatalf("link grant = %+v, want direct user grant to bob", got.Link)
	}
}

// Refresh reports current while authorized, then source-changed after the
// owner edits the original. Neither edit crosses the link: the recipient
// copy keeps its own edits and the source keeps its own.
func TestSharingHTTPRefreshSourceChanged(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	_, storeB := mustUser(t, db, "bob")
	mustTransaction(t, storeA, sharedTransactionID)
	copied := grantAndAccept(t, h, db, alice, bob)
	refreshTarget := "/v1/shared/copies/" + copied.ID + "/refresh"

	w := do(t, h, "POST", refreshTarget, "bob", "")
	if w.Code != http.StatusOK {
		t.Fatalf("refresh = %d (%s), want 200", w.Code, w.Body.String())
	}
	var refreshed store.SharingLinkRefresh
	if err := json.Unmarshal(w.Body.Bytes(), &refreshed); err != nil {
		t.Fatal(err)
	}
	if refreshed.Status != store.SharingLinkCurrent {
		t.Fatalf("refresh status = %q, want current", refreshed.Status)
	}

	renameTransaction(t, storeB, copied, "Recipient edited copy")
	renameTransaction(t, storeA, loadTransaction(t, storeA, sharedTransactionID), "Owner edited original")

	w = do(t, h, "POST", refreshTarget, "bob", "")
	if w.Code != http.StatusOK {
		t.Fatalf("refresh = %d (%s), want 200", w.Code, w.Body.String())
	}
	refreshed = store.SharingLinkRefresh{}
	if err := json.Unmarshal(w.Body.Bytes(), &refreshed); err != nil {
		t.Fatal(err)
	}
	if refreshed.Status != store.SharingLinkSourceChange {
		t.Fatalf("refresh status = %q, want source-changed", refreshed.Status)
	}
	if refreshed.CurrentSourceRevision == "" || refreshed.CurrentSourceRevision != refreshed.Link.SourceRevision {
		t.Fatalf("refresh revision = %+v, want recorded revision updated", refreshed)
	}
	if got := loadTransaction(t, storeB, copied.ID); got.Name != "Recipient edited copy" {
		t.Fatalf("recipient copy = %q, want recipient edits kept", got.Name)
	}
	if got := loadTransaction(t, storeA, sharedTransactionID); got.Name != "Owner edited original" {
		t.Fatalf("source original = %q, want owner edits kept", got.Name)
	}
}

// Revocation ends the shared read and marks the link unauthorized, but the
// recipient copy survives with its edits as an ordinary owner-authored
// row: no bank sync key, never pending or void, so the copy never claims
// independent bank verification.
func TestSharingHTTPRevocationKeepsEditableCopy(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	_, storeB := mustUser(t, db, "bob")
	mustTransaction(t, storeA, sharedTransactionID)
	copied := grantAndAccept(t, h, db, alice, bob)

	renameTransaction(t, storeB, copied, "Recipient edited copy")

	if w := do(t, h, "DELETE", "/v1/shared/grants", "alice", grantBody(t, sharedTransactionID, "user", bob)); w.Code != http.StatusOK {
		t.Fatalf("revoke = %d, want 200", w.Code)
	}
	readTarget := "/v1/shared/transactions/" + resourceOf(alice) + "/" + sharedTransactionID
	if w := do(t, h, "GET", readTarget, "bob", ""); w.Code != http.StatusNotFound {
		t.Fatalf("shared read after revoke = %d, want 404", w.Code)
	}

	w := do(t, h, "POST", "/v1/shared/copies/"+copied.ID+"/refresh", "bob", "")
	if w.Code != http.StatusOK {
		t.Fatalf("refresh = %d (%s), want 200", w.Code, w.Body.String())
	}
	var refreshed store.SharingLinkRefresh
	if err := json.Unmarshal(w.Body.Bytes(), &refreshed); err != nil {
		t.Fatal(err)
	}
	if refreshed.Status != store.SharingLinkUnauthorized {
		t.Fatalf("refresh status = %q, want unauthorized", refreshed.Status)
	}
	if refreshed.CurrentSourceRevision != "" {
		t.Fatalf("unauthorized refresh exposed source revision %q", refreshed.CurrentSourceRevision)
	}

	// The link stays readable as the recipient's own provenance even
	// though the source is no longer visible.
	if w := do(t, h, "GET", "/v1/shared/copies/"+copied.ID+"/link", "bob", ""); w.Code != http.StatusOK {
		t.Fatalf("link after revoke = %d, want 200", w.Code)
	}

	kept := loadTransaction(t, storeB, copied.ID)
	if kept.Name != "Recipient edited copy" {
		t.Fatalf("recipient copy = %q, want edits kept after revocation", kept.Name)
	}
	if kept.Source != store.SourceUser || kept.Pending || kept.Void {
		t.Fatalf("recipient copy lifecycle = %+v, want owner-authored with no bank verification", kept)
	}
}

// Link memory is never enumerable: foreign copies, unknown copies, and
// malformed IDs all report 404, and the link subpaths accept only their
// own methods.
func TestSharingHTTPLinkNotEnumerable(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustUser(t, db, "bob")
	mustUser(t, db, "carol")
	mustTransaction(t, storeA, sharedTransactionID)
	copied := grantAndAccept(t, h, db, alice, bob)

	if w := do(t, h, "GET", "/v1/shared/copies/"+copied.ID+"/link", "carol", ""); w.Code != http.StatusNotFound {
		t.Fatalf("foreign link read = %d, want 404", w.Code)
	}
	if w := do(t, h, "POST", "/v1/shared/copies/"+copied.ID+"/refresh", "carol", ""); w.Code != http.StatusNotFound {
		t.Fatalf("foreign link refresh = %d, want 404", w.Code)
	}
	for _, target := range []string{
		"/v1/shared/copies/not-a-uuid/link",
		"/v1/shared/copies/01900000-0000-7000-8000-0000000000ff/link",
		"/v1/shared/copies/" + copied.ID + "/unknown",
		"/v1/shared/copies/" + copied.ID,
	} {
		if w := do(t, h, "GET", target, "bob", ""); w.Code != http.StatusNotFound {
			t.Fatalf("GET %s = %d, want 404", target, w.Code)
		}
	}
	if w := do(t, h, "POST", "/v1/shared/copies/"+copied.ID+"/link", "bob", ""); w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST link = %d, want 405", w.Code)
	}
	if w := do(t, h, "GET", "/v1/shared/copies/"+copied.ID+"/refresh", "bob", ""); w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET refresh = %d, want 405", w.Code)
	}
}

// Refresh records on the link row, so it obeys the read-only kill switch
// like other sharing writes; the link read stays available.
func TestSharingHTTPLinkReadOnly(t *testing.T) {
	h, db := testHandler(t, false)
	alice, storeA := mustUser(t, db, "alice")
	bob := mustID(t, db, "bob")
	mustUser(t, db, "bob")
	mustTransaction(t, storeA, sharedTransactionID)
	copied := grantAndAccept(t, h, db, alice, bob)

	ro := sharing.New(db, testIssuer, sharing.Config{ReadOnly: true})
	if w := do(t, ro, "GET", "/v1/shared/copies/"+copied.ID+"/link", "bob", ""); w.Code != http.StatusOK {
		t.Fatalf("read-only link = %d, want 200", w.Code)
	}
	if w := do(t, ro, "POST", "/v1/shared/copies/"+copied.ID+"/refresh", "bob", ""); w.Code != http.StatusForbidden {
		t.Fatalf("read-only refresh = %d, want 403", w.Code)
	}
}
