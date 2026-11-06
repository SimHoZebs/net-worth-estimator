package integration

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/simhozebs/net-worth-estimator/backend/internal/types"
)

// Shared helpers for the QA-03 follow-up matrix (part 1 defines the feed
// and policy helpers reused here).

func qa03ResourceMemberID(t *testing.T, social *qa03Social) string {
	t.Helper()
	return social.member
}

func qa03ResourceOwnerID(t *testing.T, social *qa03Social) string {
	t.Helper()
	return social.owner
}

func qa03Grant(t *testing.T, social *qa03Social, subject, transactionID, audienceType, audienceID string) {
	t.Helper()
	qa03Decode(t, qa03Serve(t, social.sharing.Routes(), http.MethodPost, "/v1/shared/grants", subject,
		`{"transactionId":`+qa03Quote(transactionID)+`,"audienceType":`+qa03Quote(audienceType)+`,"audienceId":`+qa03Quote(audienceID)+`,"requestId":`+qa03Quote(qa03RequestID(t))+`}`), http.StatusCreated)
}

func qa03OwnerTransaction(t *testing.T, social *qa03Social, id string) types.Transaction {
	t.Helper()
	model, err := social.ownerSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	for _, transaction := range model.Transactions {
		if transaction.ID == id {
			return transaction
		}
	}
	t.Fatalf("owner transaction %s not found", id)
	return types.Transaction{}
}

func qa03MemberTransaction(t *testing.T, social *qa03Social, id string) types.Transaction {
	t.Helper()
	model, err := social.memberSC.LoadModel()
	if err != nil {
		t.Fatal(err)
	}
	for _, transaction := range model.Transactions {
		if transaction.ID == id {
			return transaction
		}
	}
	t.Fatalf("member transaction %s not found", id)
	return types.Transaction{}
}

func qa03Stranger(t *testing.T, social *qa03Social) string {
	t.Helper()
	user, err := social.db.EnsureGroupUser(qa03Issuer, "qa03-stranger")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := social.db.EnsureUser(user, qa03Issuer, "qa03-stranger"); err != nil {
		t.Fatal(err)
	}
	return user
}

// expireInviteForMatrix backdates one invite past expiry through the
// database handle. The clock step is setup-only: the accept under test
// runs the production HTTP path and must deny. The concrete database is
// available in this test package; production code never takes this path.
func expireInviteForMatrix(t *testing.T, social *qa03Social, invite map[string]any) {
	t.Helper()
	inner, _ := invite["invite"].(map[string]any)
	id, _ := inner["id"].(string)
	if id == "" {
		t.Fatalf("invite = %+v, want an ID", invite)
	}
	concrete, ok := social.db.(interface{ SQL() *sql.DB })
	if !ok {
		t.Fatal("database handle has no SQL escape hatch")
	}
	if _, err := concrete.SQL().Exec(`UPDATE group_invites SET expires_at = ? WHERE id = ?`, time.Now().Add(-time.Hour).Unix(), id); err != nil {
		t.Fatal(err)
	}
}

func qa03DecodeJSON(raw []byte, value any) error {
	return json.Unmarshal(raw, value)
}
